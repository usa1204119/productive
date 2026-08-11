# Fix Prompt — edits lost when switching tabs (Whiteboard ↔ Tasks/Documents)

## Symptom
Type/draw on the Whiteboard, switch the top tab to **To do tasks** (or Documents),
switch back to **Whiteboard** — the just-made edits are **gone**. The "Saved" chip may
even have shown. Sometimes re-selecting the slide brings it back, sometimes not.

This is distinct from (and survives) the save-leader/merge fix. It is a
**mount/unmount + Excalidraw `initialData` race**, not a persistence-authorization bug.

## Root cause (verified in code)
1. `apps/web/src/components/WorkspaceView.tsx` renders the active section conditionally:
   `{tab === "whiteboard" && <WhiteboardTab/>}`. Switching tabs **unmounts** `WhiteboardTab`
   → `BoardCanvas` → the `<Excalidraw>` instance entirely.
2. `apps/web/src/lib/useSceneSaver.ts` cleanup does
   `void saver.flushNow().finally(() => saver.dispose())`. `flushNow()` is **async and not
   awaited** — React unmounts synchronously while the save is still in flight (and on
   Render's free tier a cold server makes the save slow).
3. `<Excalidraw initialData={…}>` in `BoardCanvas` reads `initialData` **only at mount**.
   On return, the remounted canvas seeds from `useBoard().data`.
4. `useBoard` (`apps/web/src/lib/boards.ts`) sets no `staleTime`, so it serves the **cached**
   board first, then background-refetches. If the unmount-flush hasn't completed, the cache
   still holds the **pre-edit** scene → the canvas mounts stale. Because `initialData` is
   mount-only, it **never corrects** on that mount even after the cache updates. Worse, the
   background refetch can return the not-yet-persisted server scene and **overwrite** the
   cache, so a second switch loses the edits again.

Net: the in-progress scene lives only inside the (unmounting) Excalidraw component and a
debounced async saver; nothing durable and synchronous survives the tab switch to seed the
next mount.

## Fix

### Fix 1 (primary) — keep the Whiteboard mounted across tab switches
Stop unmounting the canvas when the user visits Tasks/Documents. Render the Whiteboard
persistently and just **hide** it when it isn't the active tab, so Excalidraw retains its
full in-memory scene and there is no remount, no `initialData` re-read, and no flush race.

- In `WorkspaceView.tsx`, once the Whiteboard has been opened for a workspace, keep it
  mounted and toggle visibility with `hidden` / `display:none` (do NOT unmount on tab
  change). Tasks/Documents can stay lazy/conditionally-mounted; only the Whiteboard needs
  to persist (it's the stateful, heavy one).
- Excalidraw measures its container; when re-shown from `display:none` it may need a nudge
  to re-fit — call `excalidrawAPI.refresh()` on becoming visible.
- Keep it scoped per workspace: unmount when the **workspace** changes (so memory doesn't
  grow), but not when the **tab** changes.

This alone eliminates the reported tab-switch loss.

### Fix 2 — keep the board cache current on every EDIT (not just on save)
So slide switches (which legitimately remount `BoardCanvas`, keyed by `boardId`) and full
reloads also seed from the latest scene:
- In `BoardCanvas.onChange` (after `primed`), throttle (~300ms) a
  `queryClient.setQueryData(boardKey(ws, boardId), prev => ({...prev, elements, appState,
  files}))`. Now the cache reflects the latest **edit**, independent of async save timing,
  so a remount's `initialData` is current immediately.
- This replaces relying solely on the save-success cache update (which races the remount).

### Fix 3 — don't let a background refetch clobber unsaved local edits
`useBoard`'s refetch-on-mount can return a server scene that is **older** than what the user
just typed (save still in flight). Prevent regressions:
- Give `useBoard` a small `staleTime` (e.g. 30s) so a quick remount does **not** immediately
  refetch and overwrite the fresh local cache. The live socket + explicit invalidation
  already keep it fresh when it matters.
- OR: in the query, merge server data with local via `reconcileElements` on receipt so a
  stale server response can never drop newer local elements. (Reuse the shared
  `reconcileElements`.)
- Ensure the unmount flush is robust: `flushNow()` already flushes `dirty`/`error`; verify a
  fast unmount can't drop an in-flight change (it shouldn't, given Fix 1 removes the tab-case
  unmount entirely).

### Fix 4 — commit in-progress text before it can be lost (sync completeness)
While a text element is being edited (the "Press Escape or Ctrl+Enter to finish editing"
state), Excalidraw may not bump the element `version` until editing ends, so the in-progress
text isn't broadcast or saved. With Fix 1 the local user no longer loses it on tab switch,
but peers won't see it until commit. Optionally, on tab/slide switch or blur, programmatically
finish text editing (e.g. `excalidrawAPI`/blur) so the element commits, broadcasts, and
saves. Low priority vs. Fixes 1–3.

## Also verify
- Confirm the previous fix (`9e64986` — every editor persists + server merge) is **actually
  deployed**. If Render didn't auto-deploy it, followers still don't save and edits are lost
  independently of this bug. Check Render → Events for a deploy of `9e64986`+; redeploy if
  missing.

## Edge cases
- Switch tab mid-text-edit, return → text present (Fix 1).
- Switch tab immediately after a stroke (before debounce), return → stroke present.
- Switch slides mid-edit, return → present (Fix 2), and durable after reload.
- Slow/cold server: edits never vanish locally (Fixes 1–2 are client-side and synchronous);
  they persist to the server when the save lands.
- Two editors: peer still sees your committed edits live; your own view never regresses.

## Testing
- **E2E (Playwright):** open a slide, type text, switch to Tasks, switch back → assert the
  text is still on the canvas (Fix 1). Repeat switching slides (Fix 2) and after a full page
  reload (durability).
- **Unit:** a small test that the `onChange` cache update writes the latest scene into
  `boardKey`, and that `useBoard` with `staleTime` doesn't refetch on immediate remount.
- Keep `smoke-boards` merge and `smoke-authz` green.

## Acceptance criteria
1. Type on the Whiteboard, switch to Tasks/Documents and back → **edits are still there**,
   every time, including mid-text-edit and on a cold server.
2. Switch slides mid-edit and reload → edits present.
3. No background refetch ever drops a newer local edit.
4. Peers see committed edits live; no regressions to co-editing, cursors, or merge-on-save.

## Files
- `apps/web/src/components/WorkspaceView.tsx` — keep Whiteboard mounted, toggle visibility.
- `apps/web/src/components/WhiteboardTab.tsx` — `refresh()` on show; throttled cache-on-edit
  in `onChange`; optional commit-text-on-switch.
- `apps/web/src/lib/boards.ts` — `useBoard` `staleTime` (and/or reconcile server responses).
- Tests: `apps/e2e/…`, plus a small web unit test.
