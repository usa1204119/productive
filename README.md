# Plane and Curves

Whiteboard → Tasks → Documents workspace app. Monorepo (npm workspaces).

```
apps/
  web/        # React + Vite + TypeScript + Tailwind
  server/     # Express + TypeScript
packages/
  shared/     # Zod schemas & shared types
```

## Setup

1. Install dependencies (from the repo root):
   ```
   npm install
   ```
2. Copy the environment template and fill it in:
   ```
   cp .env.example apps/server/.env
   ```
   Generate an encryption key:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Create a Google Cloud OAuth 2.0 **Web application** client and register the
   redirect URIs from `.env.example`. Sign-in requests only `openid email profile`.
3. Create the database schema:
   ```
   npm run prisma:migrate --workspace apps/server
   ```

## Run (dev)

```
npm run dev:server   # http://localhost:4000
npm run dev:web      # http://localhost:5173  (proxies /auth to the server)
```

## Auth flow (Step 2)

- `POST /auth/guest` — one-click guest account (+ starter workspace).
- `GET  /auth/google` — Google Sign-In (identity scopes only).
- `GET  /auth/google/link` — guest → Google conversion (one transaction).
- `GET  /auth/google/callback` — shared OAuth callback.
- `POST /auth/logout` — end session.
- `GET  /auth/me` — current user.

## Workspaces (Step 3)

All routes require a session and are scoped to the authenticated user.

- `GET    /workspaces` — list the user's workspaces.
- `POST   /workspaces` — create (max 50 per user, enforced atomically).
- `PATCH  /workspaces/:workspaceId` — rename.
- `DELETE /workspaces/:workspaceId` — delete (cascades to boards/tasks/document
  records; never touches Google Drive files).

Ownership is enforced by shared `requireWorkspace` middleware using a single
user-scoped query — a workspace the user doesn't own is indistinguishable from a
missing one (404 `WORKSPACE_NOT_FOUND`).

## Boards / Whiteboard (Step 4)

Nested under a workspace and guarded by the same ownership middleware.

- `GET    /workspaces/:workspaceId/boards` — list summaries (no scene JSON).
- `POST   /workspaces/:workspaceId/boards` — create an empty board.
- `GET    /workspaces/:workspaceId/boards/:boardId` — full board (scene included).
- `PATCH  /workspaces/:workspaceId/boards/:boardId` — rename.
- `PUT    /workspaces/:workspaceId/boards/:boardId/scene` — autosave the scene.
- `DELETE /workspaces/:workspaceId/boards/:boardId` — delete (does not delete
  tasks; clears their `sourceBoardId`/`sourceElementId` back-links).

The scene is a **transparent store**: `Board.elements`/`appState` use Postgres
`json` (not `jsonb`) so the Excalidraw scene is persisted verbatim — no key
reordering, no field stripping. The client autosaves via a debounced,
single-flight, latest-wins controller ([sceneSaver.ts](apps/web/src/lib/sceneSaver.ts))
that gates on `getSceneVersion`, retries on failure (offline-safe), and drives a
`Saving… / Saved / Save failed — Retry` chip.

## Tasks (Step 5)

Nested under a workspace, same ownership guard.

- `GET    /workspaces/:workspaceId/tasks` — list, in order.
- `POST   /workspaces/:workspaceId/tasks` — add (appended at `max(order)+1000`).
- `PATCH  /workspaces/:workspaceId/tasks/:taskId` — edit title/description/dueAt,
  or toggle `completed` (server sets/clears `completedAt` on the transition only).
- `POST   /workspaces/:workspaceId/tasks/:taskId/reorder` — `{ prevId, nextId }`;
  the server averages neighbour orders and **rebalances** the workspace's tasks
  to clean 1000-multiples (one transaction) when the gap drops below `0.0001`.
- `DELETE /workspaces/:workspaceId/tasks/:taskId` — delete; **detaches** its
  documents (sets `Document.taskId` to null) rather than deleting them.

Due dates are UTC (`timestamptz`) exchanged as ISO strings; the UI converts to
local. The Tasks tab uses optimistic mutations (toggle/reorder/delete roll back
on error), `@dnd-kit` for drag-reorder, a collapsible **Done** section (state
remembered per workspace), a keyboard-first **add** input (Enter creates, keeps
focus), and a right-hand side panel (Escape closes). The "View on board"
back-link passes only IDs — the Tasks module has no Excalidraw awareness.

### DB smoke tests

```
npm run smoke --workspace apps/server    # auth + workspaces
```

Runs the real code paths against an in-process PGlite database (Postgres
compiled to WASM) — no server or Docker needed:

- `smoke:auth` — guest-create + guest→Google conversion: transactions execute, a
  starter workspace is created, converted work stays attached to the same user
  row, and the duplicate-link / email-clash guards roll their transaction back.
- `smoke:workspaces` — ownership scoping (non-owners get `WORKSPACE_NOT_FOUND`),
  the atomic per-user 50-limit, and delete cascade to boards/tasks.
- `smoke:boards` — board CRUD, summaries omit the scene, the scene round-trips
  verbatim (unknown fields preserved), and delete clears task back-links.
- `smoke:tasks` — append ordering, insert-average, rebalance below 0.0001,
  completedAt transitions, delete-detaches-documents, and scoping.
- `smoke:qa` — name validation, Unicode round-trip, and concurrent deletion.

The autosave controller has its own unit tests (latest-wins, single-flight,
offline retry):

```
npm run test --workspace apps/web
```

The live Google OAuth round-trip still requires real credentials and is not
covered here. Excalidraw canvas rendering is verified only by a production build
(it needs a browser to exercise fully).

### Notes

Sessions are opaque tokens in an httpOnly cookie (30 days); only their SHA-256
hash is stored. Drive scope is **not** requested here — it comes later,
incrementally, when the user first opens Documents.

**`GoogleCredential` represents a Drive connection, not a Google login.** A row
exists only after the user completes incremental `drive.file` authorization.
Users authenticated for identity only (OpenID sign-in) have no `GoogleCredential`
record — sign-in uses `access_type=online` and returns no refresh token, so
there is nothing to store until Drive is connected.
