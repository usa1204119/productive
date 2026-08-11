# Fix Prompt — images don't appear for peers during live co-editing

## Symptom
When one editor adds/pastes an image on the whiteboard, peers see the image
**element** in the right place (correct size/position, selectable) but the image
itself is a **gray broken-image placeholder** — the binary never arrives. It
usually shows up only after a full reload.

## Root cause (verified in code)
Live sync moves elements and files on two different messages:
- `board:update` carries the changed Excalidraw **elements**. An image element is
  tiny — it only references a `fileId` — so it syncs instantly (hence the
  placeholder appears at the right spot).
- `board:files` carries the actual image binary as a base64 **data URL**
  (`apps/web/src/lib/boardSync.ts` → `socket.emit("board:files", …)`; relayed by
  `apps/server/src/collaboration/server.ts`).

The socket is created with **`maxHttpBufferSize: 64 * 1024`** (64 KB) in
`collaboration/server.ts`. A pasted screenshot / photo data URL is routinely
100 KB–2 MB, so the `board:files` frame **exceeds the buffer limit and is
dropped** by socket.io (oversized frames are rejected and can even disconnect the
socket). The peer therefore never receives the file → broken placeholder.

Two secondary problems make it worse:
1. `boardSync.ts` marks a file as sent (`knownFiles.add(id)`) **before/regardless
   of** whether the emit succeeded, so an oversized file is never retried.
2. The durable fallback doesn't repair the live canvas. The editor's debounced
   save DOES persist `files` to the DB (`saveScene` merges files), and the
   `board.updated` socket event invalidates the peer's board query — but that
   refetch only updates the **React Query cache**, not the mounted `<Excalidraw>`
   (its `initialData`/files are read once at mount). So the image only appears
   after a remount/reload.

## The fix — move image binaries through the DURABLE store, not the socket

Images are large and immutable once added; they don't belong on the low-latency
socket at all. Sync the small element live (instant placeholder), and pull the
binary from the server (which already persists it on save), then inject it into
the live canvas. This removes the 64 KB cliff and the bandwidth blow-up entirely.

### Change 1 — a lean endpoint to fetch a board's files
Add `GET /workspaces/:workspaceId/boards/:boardId/files` (EDITOR/VIEWER access,
same guard as board read) returning `{ [fileId]: BinaryFileData }` from the
stored board. (Or accept `?ids=` to fetch only specific files.) Reuse the
existing board read authorization. The board is already persisted with its files
via `saveScene`, so this just returns `board.files`.

### Change 2 — peers fetch missing files and inject them live
In `boardSync.ts` (`onUpdate`, after reconciling elements):
- Compute the set of `fileId`s referenced by image elements in the merged scene.
- Diff against the files the local Excalidraw already has
  (`excalidrawAPI.getFiles()`), and against `knownFiles`.
- For any **missing** fileId, fetch the board's files from Change 1 and
  `excalidrawAPI.addFiles([...])` for the ones now available; mark them known.
- **Retry with backoff** (e.g. 3–5 tries over ~1–8 s): the adder's save is
  debounced (~1 s), so the file may not be in the DB the instant the element
  arrives. Stop once all referenced files are present.
- This makes the placeholder fill in within ~1–2 s of the element arriving.

### Change 3 — stop trying to push binaries over the socket
- Remove (or hard-cap) the `board:files` socket path. If you keep a fast path for
  *small* inline files, only emit when the payload is well under the socket limit
  (e.g. total < 32 KB) and raise `maxHttpBufferSize` only modestly (e.g. 256 KB).
  Otherwise rely entirely on Change 2. Do **not** raise `maxHttpBufferSize` to
  multiple MB just to force big images through the socket — it broadcasts the
  full binary to every peer and widens the DoS surface.
- Fix the bookkeeping: only add a fileId to `knownFiles` once it's actually been
  delivered/persisted, so failures are retried (mostly moot once Change 2 owns
  file transfer).

### Change 4 — make sure the adder actually persists the file promptly
The image only becomes fetchable once the adder's `saveScene` lands. Confirm that
adding an image triggers `onChange` → `saver.schedule` (it does) and that
`saveScene` stores `files` (it merges them). Optionally flush the save a bit
sooner when new files are detected so peers can fetch without a long wait.

## Edge cases
- Large image (1–2 MB): appears for peers within ~1–2 s (durable fetch), never
  dropped.
- Multiple images pasted quickly: all fetched (diff by fileId; batch the fetch).
- Image element arrives before the file is saved: retry/backoff covers the gap.
- Peer reloads: board GET already returns files (unchanged) — still works.
- Reconnect mid-add: on resubscribe, re-run the missing-file check for the
  current scene.
- VIEWER: can fetch/display files (read access) but still can't edit.
- Deletion of an image: element tombstone syncs; no file fetch needed.

## Testing
- **Two-client (Playwright):** editor pastes an image; assert the peer's canvas
  shows the image (not the placeholder) within a few seconds, and that it
  survives a reload. Test a >64 KB image specifically (the old failure).
- **Server smoke:** `GET …/boards/:id/files` returns the stored files for a
  member; respects workspace access (stranger 404, anon 401).
- Keep `smoke-boards` (files persist/merge) and `smoke-authz` green.

## Acceptance criteria
1. An image added by one editor appears (fully rendered) for all peers within a
   couple of seconds, including images well over 64 KB.
2. No socket frame is ever dropped for image size; the socket stays connected.
3. Images survive reload for every participant (durable).
4. No multi-MB binaries are broadcast over the socket to every peer.
5. Co-editing, cursors, merge-on-save, and persistence are unaffected.

## Files
- `apps/server/src/routes/boards.ts` + `apps/server/src/lib/boards.ts` — add the
  files endpoint (`getBoardFiles`).
- `apps/web/src/lib/boardSync.ts` — fetch missing files on `onUpdate` + backoff;
  retire/cap the `board:files` push; fix `knownFiles` bookkeeping.
- `apps/server/src/collaboration/server.ts` — remove/cap `board:files` relay;
  leave `maxHttpBufferSize` small (or modestly raised only for a small-file path).
- `apps/web/src/components/WhiteboardTab.tsx` — ensure `excalidrawAPI.addFiles`
  is used for injected files (it is, via the hook).
- Tests: `apps/e2e/…`, `apps/server/scripts/smoke-boards.ts` /
  `smoke-authz.ts`.
