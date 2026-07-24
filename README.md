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
   redirect URIs from `.env.example`, enable the Google Drive API, and keep both
   OAuth flows on the same Web client. Sign-in requests only `openid email profile`;
   Drive is requested separately and only as `drive.file`.
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

## Google Drive / Documents (Step 6)

Drive permission is incremental: opening Documents explains the access first,
and the user explicitly connects it. Identity sign-in never requests a Drive
scope. The Drive OAuth URL is regression-tested to request exactly:

```
https://www.googleapis.com/auth/drive.file
```

Refresh tokens are encrypted with AES-256-GCM and `ENCRYPTION_KEY`. The Google
client refreshes access tokens automatically; `invalid_grant` marks the
connection disconnected and returns a reconnect state instead of a raw error.
Folders are lazy: no Drive folder is created during sign-in or consent. The first
successful upload creates `Plane and Curves` plus the workspace subfolder.
Drive `appProperties`, stored IDs, and a single-flight lock make creation
idempotent and recover a folder that was deleted directly in Drive.

- `GET  /auth/google/drive` — begin incremental Drive consent.
- `GET  /auth/google/drive/callback` — exchange and encrypt the refresh token.
- `POST /auth/google/drive/disconnect` — revoke and remove the credential.
- `GET  /workspaces/:workspaceId/documents` — list records and flag Drive-deleted
  files as `missing`.
- `POST /workspaces/:workspaceId/documents` — stream one raw file (100 MB max).
- `GET  /workspaces/:workspaceId/documents/uploads/:uploadId/events` — ordered
  server-to-Drive upload progress (SSE).
- `PATCH /workspaces/:workspaceId/documents/:documentId` — attach/detach a task.
- `DELETE /workspaces/:workspaceId/documents/:documentId` — remove the record;
  `?deleteFromDrive=true` is a separate explicit opt-in.

Files are streamed through the API and never stored in the database. Files at
least 5 MB use Drive's resumable protocol in 8 MiB chunks (a valid 256 KiB
multiple), with retry/status recovery for transient failures. A database record
is created only after Drive completes; failed/cancelled uploads leave no partial
row, and a failed database write triggers compensating Drive cleanup.

### DB smoke tests

```
npm run smoke --workspace apps/server
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
- `smoke:documents` — exact OAuth scope, encrypted/upserted credentials,
  invalid-token reconnect state, folder idempotency/recovery, missing files,
  cancellation cleanup, progress ordering, and multi-chunk resumable upload.
- `smoke:qa` — name validation, Unicode round-trip, and concurrent deletion.

The autosave controller has its own unit tests (latest-wins, single-flight,
offline retry):

```
npm run test --workspace apps/web
```

The live Google OAuth/Drive round-trip still requires real Google credentials
and is not part of the offline suite. Google-facing behavior is exercised
through the Drive port and a protocol-level fake; the real adapter is verified
for resumable request shape without external network access.

### Notes

Sessions are opaque tokens in an httpOnly cookie (30 days); only their SHA-256
hash is stored. Drive scope is **not** requested during sign-in — it is requested
incrementally from the Documents connect prompt.

**`GoogleCredential` represents a Drive connection, not a Google login.** A row
exists only after the user completes incremental `drive.file` authorization.
Users authenticated for identity only (OpenID sign-in) have no `GoogleCredential`
record — sign-in uses `access_type=online` and returns no refresh token, so
there is nothing to store until Drive is connected.
