# Feature Prompt — Real-Time Live Sync (0-latency collaborative workspace)

## One-line goal
When two or more people are in the same workspace, **anything one person creates or
types — a slide, a shape, a stroke, a rename, a reorder, a task, a document — appears
on everyone else's screen within ~100 ms, smoothly, without anyone having to reload
and without clobbering an in-progress edit.**

This document is an implementation brief for an engineer (human or Codex). It assumes
the existing "Swift Productive" monorepo (`apps/web`, `apps/server`, `packages/shared`)
and the **partially-built** socket.io collaboration layer described in "Current state"
below. Do **not** rebuild that layer — extend it.

---

## Current state (what already exists — read before touching anything)

### Server
- `apps/server/src/collaboration/server.ts` — `createCollaborationServer(httpServer)`:
  a `socket.io` server on path `/socket.io`, CORS `origin: env.WEB_URL, credentials: true`,
  `maxHttpBufferSize: 64 KB`, transports `["websocket","polling"]`, optional Redis adapter
  via `env.REDIS_URL`. Authenticates the socket from the **session cookie** (`getUserFromSessionToken`),
  authorizes workspace membership with `getWorkspaceAccess`, tracks **presence** in an
  in-memory `Map<workspaceId, Map<userId, PresenceEntry>>`, joins room `workspace:${workspaceId}`,
  and emits `workspace:presence` on join/leave.
- `apps/server/src/collaboration/hub.ts` — `emitWorkspaceEvent(workspaceId, {type, entityId,
  revision, actorUserId})` broadcasts `"workspace:event"` to the workspace room;
  `disconnectWorkspaceUser` force-evicts a revoked user.
- Routes emit **coarse** events today: `apps/server/src/routes/boards.ts` emits
  `board.created / board.updated / board.deleted / board.reordered`; tasks and documents
  routes emit their equivalents. **These events carry no payload beyond `entityId` +
  `revision`** — they are "something changed, go refetch" signals.

### Client
- `apps/web/src/lib/collaboration.ts` — `useWorkspaceCollaboration(workspaceId, activeSection)`:
  one module-level `io({path:"/socket.io", autoConnect:false, withCredentials:true})`,
  joins on connect, and on `"workspace:event"` **invalidates React Query keys**
  (`["boards", ws]`, `["board", ws, id]`, `["tasks", ws]`, `["documents", ws]`, …).
  Returns `PresenceEntry[]`.
- `apps/web/src/components/WhiteboardTab.tsx` — `BoardCanvas` primes the Excalidraw scene
  once (`saver.prime(elements, revision)`), autosaves via a debounced `SceneSaver`
  (`saver.schedule(...)`) that POSTs the **whole scene** to
  `POST /workspaces/:ws/boards/:id/scene`, and reconciles remote saves via revision
  (`saver.acceptLatest`, `ConflictDialog` on `BOARD_CONFLICT`).

### Why it isn't "live" today
1. **Whiteboard latency is bounded by the autosave debounce**, not the network. A stroke
   isn't broadcast until it's been saved (seconds), and then peers **refetch the entire
   board** and call `updateScene` — coarse, laggy, and it can stomp the local user's
   in-flight edits.
2. **Whole-board `revision` is a pessimistic lock.** Two simultaneous editors generate
   `BOARD_CONFLICT` against each other instead of merging. That is fine for "last save
   wins across sessions" but wrong for live co-editing.
3. **Lists (slides/tasks/docs) already sync via invalidation**, but only if the socket is
   actually connected in production (see Phase 0). If the socket handshake fails, a
   collaborator only sees what was present at initial page load and never refreshes —
   which is the likely cause of the reported **"No slides yet" while the owner has 3
   slides"** symptom.

---

## Non-goals (explicitly out of scope)
- Full CRDT/OT text co-authoring inside a single Excalidraw text element (two people typing
  in the *same* text box, character-merged). We use Excalidraw's **element-level**
  reconciliation, which is what upstream Excalidraw collaboration itself uses. Two people
  editing *different* elements is fully live; two people editing the *same* text element
  resolves last-writer-wins per element (acceptable, and matches excalidraw.com).
- Offline CRDT convergence / long offline edits merging. Keep the existing offline autosave
  retry; live sync requires a live socket.
- Changing the Google Drive scope (`drive.file` only — unchanged).

---

## Architecture decision (read this before coding)

Split "sync" into **two planes** with different guarantees:

| Plane | What | Transport | Latency target | Persistence |
|------|------|-----------|----------------|-------------|
| **Ephemeral / live** | in-progress whiteboard element updates, cursors, selection, presence | socket.io broadcast, room `board:${boardId}` and `workspace:${ws}` | 30–100 ms | none directly; a debounced authoritative save persists |
| **Durable / authoritative** | the saved scene, slide order, task/doc rows | HTTP + Prisma (existing routes), still emits `workspace:event` | seconds | Postgres |

The live plane makes it *feel* instant; the durable plane makes it *correct* and reload-safe.
A late joiner loads the durable snapshot over HTTP, then subscribes to the live plane.

---

## Phase 0 — FIRST: fix "content not loaded" (the empty-slides bug)

Before adding anything, make the **existing** event-driven sync provably work in production.
The symptom (a collaborator sees "No slides yet" while the owner sees 3 slides in the *same*
workspace room — presence shows both avatars) means one of:

**H1 — the socket never connects in prod, so no invalidation ever fires.**
- Check `env.WEB_URL` on the deployed server. In single-origin prod the browser origin is
  `https://productive-kel1.onrender.com`; the socket CORS `origin` must match that exactly.
  If `WEB_URL` is `http://localhost:5173` or a trailing-slash mismatch, the handshake is
  rejected and the client silently falls back to nothing.
- Verify the client connects: in the browser console on the live site,
  `network → WS` should show a `101 Switching Protocols` to `/socket.io`. Add a
  `socket.on("connect_error", e => console.warn(e))` temporarily.
- **Fix:** make CORS accept the actual prod origin. In single-origin serving, prefer
  `cors: { origin: true, credentials: true }` (reflect request origin) **or** derive origin
  from `env.SERVER_URL`/request host rather than a possibly-stale `WEB_URL`.

**H2 — the durable list query genuinely returns `[]` for the member.**
- Reproduce: as the collaborator, hit `GET /workspaces/:ws/boards` directly (devtools →
  Network) and inspect the JSON. If it's `[]`, the bug is server-side scoping, not sync.
- Audit `listBoards`/`toBoardSummaryDto` and `requireWorkspaceAccess`: confirm the list is
  **not** filtered by `ownerUserId`/`createdBy`. A member must see **all** boards in the
  workspace. Confirm `getWorkspaceAccess` returns non-null for the member (it should, since
  presence worked).
- Confirm the two "Plane and Curves" workspaces are the **same `workspaceId`**, not two
  different workspaces that happen to share a name (log the id in the sidebar during repro).

**H3 — the client fetched once (empty) before acceptance and never re-fetched.**
- After accepting an invite, `["boards", ws]` may have been cached empty. Ensure
  `useWorkspaceCollaboration` invalidates boards on `connect` (not only on events), and that
  switching into a workspace always triggers a fresh fetch (`refetchOnMount`, or invalidate
  on workspace change).

**Deliverable for Phase 0:** a written root cause (H1/H2/H3) + the fix, verified by two real
browser sessions (owner + collaborator) where a slide the owner creates appears for the
collaborator without reload. Add a smoke/e2e that asserts a member's `GET …/boards` returns
the owner's boards.

---

## Phase 1 — Harden list sync (slides, tasks, documents)

Goal: create/rename/delete/reorder of slides, tasks, and documents by any editor appears for
all viewers within ~1 s, reliably.

1. **Keep the invalidation model** (it's the right amount of consistency for lists) but make
   it robust:
   - On socket `connect` **and** `reconnect`, re-invalidate the active workspace's list
     queries (a reconnect means we may have missed events).
   - Ignore self-authored events for *optimistic* mutations to avoid a refetch flash: the
     acting client already applied the change optimistically; compare `event.actorUserId`
     to the current user id and skip the invalidate if equal **and** the local mutation is
     still settling. (Low priority — only if flicker is observed.)
2. **Make presence show live section** ("Alice is on Whiteboard") — already modeled in
   `PresenceEntry.activeSection`; ensure `activeSection` updates when the user switches tabs
   (emit `workspace:join` again or a lightweight `workspace:section` event).
3. **Reorder race:** two people reordering slides — the float-ordering `reorderBoard` already
   converges; just ensure the losing client re-syncs from the emitted `board.reordered`
   event (invalidate `["boards", ws]`).

**Acceptance:** with owner + collaborator side by side, creating/renaming/deleting/reordering
a slide (or task/doc) on one reflects on the other within ~1 s, no reload.

---

## Phase 2 — Live whiteboard co-editing (the core of the request)

This is the hard part and where "0-latency" is won. Use **Excalidraw's element-level
reconciliation** model (the same approach excalidraw.com uses).

### 2.1 Rooms & subscription
- When `BoardCanvas` mounts for `boardId`, emit `board:subscribe { workspaceId, boardId }`.
  Server joins the socket to room `board:${boardId}` **after** re-checking
  `getWorkspaceAccess` (defense in depth) and role.
- On unmount / board switch, emit `board:unsubscribe`.

### 2.2 Broadcasting local edits (throttled, element-level)
- Keep Excalidraw's `onChange(elements, appState, files)`.
- Maintain a **dirty set** of element ids whose `version`/`versionNonce` changed since the
  last broadcast. On a throttled tick (**~50 ms**, trailing), emit
  `board:update { boardId, elements: changedElementsOnly, senderId }`.
  - Send only changed elements, not the whole scene. Respect `maxHttpBufferSize` (64 KB) —
    if a batch exceeds it, chunk it.
  - Include newly-added and deleted elements. Deletions in Excalidraw are represented as
    elements with `isDeleted: true` (keep them, don't drop — reconciliation needs the
    tombstone).
- **Files (images):** when `onChange` yields new file ids (image data URLs), emit
  `board:files { boardId, files: {id → BinaryFileData} }` once per new file (dedupe by id).
  Peers call `excalidrawAPI.addFiles([...])` before/with the element update so images render.

### 2.3 Applying remote edits (reconciliation, non-destructive)
- On `board:update`, **do not** call `updateScene` with the payload verbatim. Reconcile:
  1. Read local elements via `excalidrawAPI.getSceneElementsIncludingDeleted()`.
  2. Merge: for each incoming element, keep whichever has the higher `version`
     (tie-break on `versionNonce`) — this is Excalidraw's `reconcileElements` rule. Preserve
     local elements not present in the payload.
  3. Call `excalidrawAPI.updateScene({ elements: merged })`.
  - **Never** overwrite `appState` from a peer (that would fight the local user's viewport,
    zoom, and selection). Only sync elements + files live. (Per-user viewport stays local.)
- Guard against **echo**: ignore updates where `senderId === mySocketId`.
- Guard against **feedback loops:** applying a remote `updateScene` triggers a local
  `onChange`; those elements are already at the reconciled version, so the dirty-set diff is
  empty and nothing rebroadcasts. Verify this holds (compare versions, not object identity).

### 2.4 Live cursors & selection (presence on canvas)
- On pointer move (throttled ~60 ms) emit `board:pointer { boardId, x, y, selectedIds }`
  in **scene coordinates**. Server relays to the room.
- Render peers' cursors as an overlay (name label + color derived from userId). Excalidraw
  exposes `excalidrawAPI.updateScene({ collaborators })` — you may render via the built-in
  collaborators Map (note: `appState.collaborators` must be a **Map**; the codebase already
  strips it before persisting — keep that, only feed collaborators to the live API, never to
  the saver).
- Color per user: stable hash of userId → palette.

### 2.5 Persistence (durable plane) with a "save leader"
Live broadcast makes it *look* saved; you still must persist so reloads/late-joiners are
correct — but **N editors must not each POST the full scene N times** and fight `revision`.
- Elect a **save leader** per board room: the socket with the lowest id (or first joiner)
  the server designates via a `board:role { isLeader }` message. Only the leader runs the
  existing debounced `SceneSaver` → `POST …/scene`. Followers **do not** POST.
- If the leader leaves, the server promotes the next socket and notifies it (`board:role`).
- The authoritative save still bumps `revision` and emits `board.updated`; **followers ignore
  `board.updated` for a board they are live-subscribed to** (they already have newer state
  from the live plane). Late-joiners (not subscribed) still refetch — that's correct.
- Result: exactly one writer, no `BOARD_CONFLICT` between live collaborators. `revision`
  reverts to its original job — guarding against *stale full-scene overwrites across
  disconnected sessions*, not against live peers.

### 2.6 Late joiner / initial state
- A user opening a board that others are already editing: load the durable snapshot via
  `GET …/boards/:id` (existing), `prime`, then `board:subscribe`. To avoid a stale gap
  between snapshot fetch and subscribe, subscribe first, buffer incoming `board:update`s,
  fetch snapshot, reconcile buffer on top. (Simpler acceptable v1: fetch → prime →
  subscribe; a ~50 ms window of missed edits self-heals on the next broadcast because
  reconciliation is idempotent by version.)

### 2.7 Role gating
- VIEWERs may `board:subscribe`, receive `board:update`/`board:pointer`, and send
  `board:pointer` (so their cursor shows) but the server **must reject** `board:update`
  from a non-EDITOR socket. Mirror the HTTP `requireWorkspaceRole("EDITOR")` check on the
  socket handler. The client already sets `viewModeEnabled={!canEdit}`.

**Acceptance for Phase 2:**
- Two editors on the same board: a shape/stroke drawn by one appears for the other in
  < ~150 ms without reload; images appear; deletes propagate.
- Editing *different* elements never conflicts; both survive.
- No `ConflictDialog` appears during normal live co-editing.
- Reload by either user shows the merged, persisted scene (nothing lost).
- A VIEWER sees live edits and cursors but cannot modify; their attempted `board:update`
  is server-rejected.

---

## Protocol summary (add to `packages/shared/src/collaboration.ts`, Zod-validated both ends)

Client → server:
- `board:subscribe { workspaceId, boardId }`
- `board:unsubscribe { boardId }`
- `board:update { boardId, elements: ExcalidrawElement[], senderId }`  *(editors only)*
- `board:files { boardId, files: Record<fileId, BinaryFileData> }`  *(editors only)*
- `board:pointer { boardId, x, y, selectedIds: string[] }`
- `workspace:section { workspaceId, activeSection }`  *(presence tab update)*

Server → client:
- `board:update { boardId, elements, senderId }` (relayed)
- `board:files { boardId, files }` (relayed)
- `board:pointer { boardId, userId, x, y, selectedIds }` (relayed, server stamps userId)
- `board:role { boardId, isLeader: boolean }`
- `workspace:presence PresenceEntry[]` (existing)
- `workspace:event WorkspaceEvent` (existing; still used for lists + late joiners)
- `workspace:access-revoked { workspaceId }` (existing)

Validate every inbound socket payload with a Zod schema; drop malformed messages. Never
trust `senderId`/`userId` from the client for authorization — the server knows the socket's
`userId` from the session.

---

## Performance budget
- Element-update broadcast: trailing throttle **~50 ms**, changed elements only, chunked
  under 64 KB.
- Pointer broadcast: throttle **~60 ms**, dropped-frame (no queue buildup).
- Reconciliation on receive must be O(changed), using a `Map<id, element>` merge — never
  re-diff the whole scene per message.
- Cursor overlay uses `requestAnimationFrame`, not React state per mousemove.

## Scaling / infra
- Single Render instance: in-memory presence + rooms are fine; **no Redis required**.
- Multi-instance: the `@socket.io/redis-adapter` path already exists — room broadcasts fan
  out across instances via `REDIS_URL`. Presence map would then need to move to Redis (out
  of scope until you actually scale to >1 instance).
- Keep `maxHttpBufferSize` bounded; keep websocket + polling fallback.

## Security
- Socket auth from session cookie (exists). Re-check `getWorkspaceAccess` on **every**
  `board:subscribe` and reject non-members.
- Enforce EDITOR role on `board:update`/`board:files` server-side.
- `disconnectWorkspaceUser` on member removal/role downgrade must also evict from
  `board:*` rooms.
- Never broadcast a workspace's live edits outside its room.

## Testing
- **Server smoke** (`apps/server/scripts/smoke-collaboration.ts`, PGlite + a socket.io test
  client or direct handler unit tests): subscribe authz (member ok / stranger rejected /
  viewer cannot update), leader election + failover, reconciliation merge picks higher
  `version`, access-revoked evicts from board room.
- **Reconciliation unit test** (Vitest, pure function): given local + remote element arrays
  with mixed versions, assert the merge result — no server needed.
- **E2E** (`apps/e2e`, Playwright, two browser contexts): owner + collaborator; owner draws
  → collaborator sees it; collaborator (editor) draws → owner sees it; viewer cannot draw;
  reload preserves merged scene; slide create/rename/reorder reflects live.

## Rollout / flags
- Gate the live whiteboard plane behind an env flag (e.g. `LIVE_SYNC_ENABLED`, default on in
  dev) so it can be disabled without redeploying code paths if a regression appears. Lists
  sync (Phase 1) is safe to always-on.
- Ship Phase 0 + Phase 1 first (fixes the reported bug, low risk), then Phase 2 behind the
  flag, then flip the flag once the two-client e2e passes.

## Acceptance criteria (definition of done)
1. Reported bug gone: a collaborator never sees "No slides yet" for a workspace that has
   slides; new slides appear live.
2. Two editors co-draw on one board with sub-150 ms visible latency, live cursors, images,
   and deletes propagating; no conflict dialog during normal use; reload loses nothing.
3. Viewers see everything live but cannot edit.
4. Tasks and documents create/update/delete reflect across clients within ~1 s.
5. Works in production single-origin on `productive-kel1.onrender.com` (socket connects,
   CORS correct) with no Redis.
6. Smoke + reconciliation unit + two-client e2e all green; `npm run build` clean.

---

## Suggested file-by-file task list
- `packages/shared/src/collaboration.ts` — add board live-sync event schemas (subscribe,
  update, files, pointer, role, section) + types. `npm run build -w packages/shared`.
- `apps/server/src/collaboration/server.ts` — handle `board:subscribe/unsubscribe/update/
  files/pointer`, room `board:${boardId}`, per-board leader election + `board:role`,
  role/access checks, evict-on-revoke into board rooms.
- `apps/server/src/collaboration/hub.ts` — helper to relay board messages / manage leader map.
- `apps/server/src/env.ts` — `LIVE_SYNC_ENABLED` (default true dev, configurable prod);
  audit `WEB_URL`/CORS for Phase 0.
- `apps/web/src/lib/collaboration.ts` — reconnect re-invalidation; export a `useBoardLiveSync`
  hook (subscribe, throttled broadcast, reconcile, cursors, leader-aware saving).
- `apps/web/src/components/WhiteboardTab.tsx` (`BoardCanvas`) — wire `useBoardLiveSync`:
  broadcast changed elements + files, apply reconciled remote elements (never remote
  appState), render peer cursors, only the leader runs `SceneSaver`.
- `apps/web/src/lib/reconcile.ts` (new, pure) — `reconcileElements(local, remote)` by
  version/versionNonce; unit-tested.
- `apps/e2e/…` — two-context live-sync spec.
- `apps/server/scripts/smoke-collaboration.ts` (new) — authz + leader + reconcile + evict.

---

## Risks / watch-outs (learned from this codebase)
- `appState.collaborators` must stay a **Map** and must **never** reach the persisted scene
  or the JSON saver (past crash: "forEach is not a function"). Feed collaborators only to the
  live Excalidraw API.
- Store the scene **verbatim** on persist (`@db.Json`, not jsonb; preserve unknown fields) —
  do not let live reconciliation strip element fields you don't recognize.
- The `process` shim in `main.tsx` and the chunk-load auto-reload ErrorBoundary must remain.
- Don't let the leader's full-scene save and live element broadcasts double-count into
  `BOARD_CONFLICT` — followers must ignore `board.updated` for boards they're live-subscribed
  to.
- Keep `drive.file` scope. Keep `.env` gitignored.
