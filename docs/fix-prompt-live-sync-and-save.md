# Fix Prompt — Live-sync editor model + "changes vanish on tab switch"

## Symptoms (reported)
1. **Content not durably saved.** Edits look saved ("Saved" chip), but switching the
   internal tab (Whiteboard/Tasks/Documents) or switching slides makes the changes
   **vanish instantly**; re-selecting the slide (sometimes a double-click) brings them
   back — inconsistently.
2. **Live sync is asymmetric / unreliable.** Real-time co-editing works better on the
   owner's side than the editor's (member's) side.

Both trace to the **save-leader model** added in the live-sync work (commit `8a83145`)
plus a **stale query-cache** bug. This document is an implementation brief to fix them.

---

## Root causes (verified in code)

### RC1 — Followers never persist their own edits (data loss)
`apps/web/src/components/WhiteboardTab.tsx` (BoardCanvas `onChange`):
```ts
live.broadcastScene(elements, files);
if (live.shouldPersist()) saver.schedule(scene);   // ← gated
```
`shouldPersist()` in `apps/web/src/lib/boardSync.ts` is `!subscribed || isLeader`. The
server (`apps/server/src/collaboration/server.ts`) elects the **first editor to
subscribe** as the board's leader. So when the owner and a member are both on a board,
the **owner is the leader and the member is a follower** → for the member,
`shouldPersist()` is `false` → `saver.schedule()` is **never called** → the member's
edits are only broadcast live, never written to the DB by the member. On unmount,
`useSceneSaver`'s cleanup calls `saver.flushNow()`, but there is nothing pending
(`!this.latest`), so it's a no-op. **The member's edits are lost** the moment they leave
the board, unless the leader happened to persist them — which is fragile (requires the
leader to have the exact board open, reconcile correctly, and not have left).

This is exactly why the **owner side "is a bit up to mark"** (owner = leader = persists)
and the **editor side loses content**.

### RC2 — The board scene cache is never updated after an edit/save (stale on remount)
`useBoard` (`apps/web/src/lib/boards.ts`) caches `["board", ws, boardId]`. `BoardCanvas`
is keyed by `boardId`, and its Excalidraw `initialData` comes from that cached
`board.elements`. But:
- `saveBoardScene` returns a **summary only** (`name/order/revision/updatedAt`, no scene),
  and the save success handler does **not** write the edited scene back into the cache.
- Nothing updates `["board", ws, boardId]` as the user edits.

So the cache still holds the scene **as first loaded** (pre-edit). When the component
remounts after a tab/slide switch, React Query serves that stale cached scene first
("changes vanish instantly"), then a background refetch eventually returns the saved
scene ("reappears"). If the save hadn't completed (RC1, or a flush race), the refetch
returns the pre-edit scene and the edits are **gone for good**.

### RC3 — Whole-board `revision` replace clobbers concurrent saves
`saveScene` (`apps/server/src/lib/boards.ts`) does a whole-row replace guarded by
`revision`. Two editors saving concurrently → one gets `BOARD_CONFLICT` (dialog), or the
last write **replaces** the other's elements rather than merging them. This fights live
co-editing, where per-element merge (not whole-board last-writer-wins) is required.

---

## The fix — decouple persistence from leadership; merge on the server

The save-leader idea (one writer to avoid `revision` fights) is the wrong trade: it makes
non-leaders lose data. Replace it with: **every editor persists its own edits, and the
server merges by element version** — the same reconciliation rule the live plane already
uses. This is robust (no data loss), conflict-free (no dialog), and simpler (no leader
election for persistence).

### Change 1 — Server `saveScene` merges instead of replaces (`apps/server/src/lib/boards.ts`)
Reconcile the incoming elements against the stored elements by `version`/`versionNonce`
(reuse the same rule as the client `reconcileElements` — extract a shared helper into
`packages/shared` so both sides use ONE implementation), then write the merged result:
- Read the stored board (`elements`, `revision`) in a transaction.
- `merged = reconcile(stored.elements, incoming.elements)` (higher version wins; keep
  elements only one side has; honour `isDeleted` tombstones).
- Write `merged`, `appState` (see Change 4), `files` (union), `revision: increment`.
- **Do not throw `BOARD_CONFLICT` for live editors.** Because merging is order-independent
  and idempotent, concurrent saves converge. Keep `revision` only as a monotonic version
  for the DTO / debug; drop the `where: { revision: baseRevision }` gate (or keep it and,
  on mismatch, **re-read + merge + retry once** server-side instead of erroring).
- Guard payload size (element count cap, consistent with `MAX_LIVE_ELEMENTS`).

This makes saving safe for N concurrent editors with zero lost elements.

### Change 2 — Every editor persists (`WhiteboardTab.tsx` + `boardSync.ts`)
- In `BoardCanvas.onChange`, **remove the `shouldPersist()` gate** — always
  `saver.schedule(scene)` for an editor (`canEdit`). Keep `live.broadcastScene(...)` for
  instant visibility.
- Delete the save-leader concept from persistence: remove `shouldPersist`, the
  `board:role` / leader election on the server, `boardEditors`/`boardLeaders`, and the
  `isLeader` state. (Leaving live broadcast + cursors intact.) The server no longer needs
  a leader because merge-on-save handles concurrency.
- Keep the existing debounce/single-flight/offline-retry in `SceneSaver`.

### Change 3 — Keep the board scene cache current (fixes RC2, the vanish)
So a remount never shows a pre-edit scene:
- On **every** `onChange` (after prime), optimistically write the current
  `elements/appState/files` into the `["board", ws, boardId]` query cache
  (`queryClient.setQueryData`), so if `BoardCanvas` remounts, `initialData` already has the
  latest scene. (Throttle this to ~200ms to avoid churn.)
- On **save success**, update the cached `revision` from the returned summary (so the next
  save uses the right base) and reconcile the cached scene with the server's merged result
  if you fetch it back.
- On applying a **remote** live update (`onUpdate`), also update the cache so a remount
  reflects peers' edits.
- Result: switching tabs/slides and back reads the current scene from cache instantly; the
  background refetch just confirms. No vanish, no double-click.

### Change 4 — appState handling (viewport/selection stay local)
- Continue to **strip `collaborators`** before persisting (existing `sanitizeAppState`).
- Persist a **sanitized appState** but do **not** apply a remote peer's `appState`
  (scroll/zoom/selection) to the local canvas — the live plane must only sync `elements`
  and `files`, never viewport. (Already the intent; verify `onUpdate` never passes
  `appState`/`collaborators` into `updateScene` for the local user.) When merging on save,
  prefer the saver's own appState (last-writer for viewport-less fields is fine, since
  viewport isn't shared).

### Change 5 — Reliable flush on unmount / board switch (`useSceneSaver.ts`)
- On board change / unmount, `await saver.flushNow()` **before** the new board's data is
  shown, or ensure the optimistic cache (Change 3) already holds the latest so a race can't
  surface stale data. Confirm `flushNow()` actually flushes a `dirty` state (it does) and
  that switching boards can't drop an in-flight save.
- Make sure switching slides quickly (before the debounce fires) still persists — the
  optimistic cache + flush-on-unmount cover this.

### Change 6 — Fix the live-sync asymmetry (symptom 2)
With the leader removed, both sides are symmetric: each editor broadcasts deltas and
persists. Verify:
- Both directions reconcile identically (shared `reconcile` helper).
- Echo suppression via `lastVersions` still prevents rebroadcast loops.
- A late joiner: fetch snapshot → prime → subscribe; buffer any deltas that arrive during
  the fetch and reconcile them on top (avoids a missed-delta gap).
- Cursors: confirm peer cursors render for BOTH owner and member (the `collaborators` Map
  fed only to the live API), and clear on `board:cursor-gone`.
- VIEWERs: still receive live updates + cursors, still cannot emit `board:update` (server
  rejects), and now also cannot save (client `canEdit` gate + server EDITOR gate on the
  scene route — verify `PUT /boards/:id/scene` requires EDITOR).

---

## Edge cases to verify
- Solo editor (no peers): edits persist and survive reload (regression-safe).
- Two editors, different elements: both survive after both reload.
- Two editors, same element: last-writer-per-element; no crash, no dialog.
- Rapid slide switching mid-edit: nothing lost.
- Offline blip during edit: `SceneSaver` retry persists when back online; live plane
  resubscribes and reconciles.
- Deleting an element propagates (tombstone `isDeleted` survives merge).
- Images (files): appear for peers and survive reload.

## Testing
- **Server:** extend `smoke-boards`/add a smoke for `saveScene` merge — concurrent saves
  of overlapping/disjoint element sets converge with no lost elements; higher `version`
  wins; deletions survive. Reuse the shared `reconcile` in the assertion.
- **Shared unit:** move `reconcileElements` to `packages/shared`, keep its unit tests
  (`apps/web/src/lib/reconcile.test.ts`) and add server-side coverage.
- **HTTP authz:** `smoke-authz` already covers member read; add that a member can `PUT`
  the scene (EDITOR) and a VIEWER cannot.
- **E2E (two contexts):** owner + member both draw; each switches tabs/slides and reloads;
  assert **no edit from either side is ever lost**, and both see each other live.

## Acceptance criteria
1. A member's edits **persist** and survive tab/slide switches and reloads — identical to
   the owner. No "vanish on switch," no double-click needed.
2. Two editors co-edit with sub-150ms live updates, no conflict dialog, and after both
   reload **every element from both is present** (merged).
3. Viewport/selection never jump from a peer's action.
4. Viewers see live edits + cursors but cannot edit or save.
5. Solo editing is unchanged and reliable.
6. `npm run build` clean; reconcile unit + `smoke-boards` merge + `smoke-authz` + two-client
   e2e all green.

## Rollout
- Land Change 1 (server merge) + Change 2/3 (every editor persists + cache) together behind
  the existing live path; they are the reliability core.
- Remove the leader machinery in the same change (it becomes dead code).
- Keep a feature flag only if you want to A/B; otherwise ship — the new model strictly
  dominates the old one on correctness.

## Files
- `packages/shared/src/reconcile.ts` (new; move from web) + export.
- `apps/server/src/lib/boards.ts` — `saveScene` merge-on-write.
- `apps/server/src/collaboration/server.ts` — remove leader election / `board:role`.
- `apps/web/src/lib/boardSync.ts` — remove `shouldPersist`/leader; keep broadcast/apply/cursors.
- `apps/web/src/components/WhiteboardTab.tsx` — always persist; optimistic cache update in
  `onChange` and on remote apply.
- `apps/web/src/lib/useSceneSaver.ts` — ensure flush-on-switch reliability.
- Tests: `apps/web/src/lib/reconcile.test.ts`, `apps/server/scripts/smoke-boards.ts`,
  `apps/server/scripts/smoke-authz.ts`, `apps/e2e/…`.
