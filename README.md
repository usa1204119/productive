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

The live Google OAuth round-trip still requires real credentials and is not
covered here.

### Notes

Sessions are opaque tokens in an httpOnly cookie (30 days); only their SHA-256
hash is stored. Drive scope is **not** requested here — it comes later,
incrementally, when the user first opens Documents.

**`GoogleCredential` represents a Drive connection, not a Google login.** A row
exists only after the user completes incremental `drive.file` authorization.
Users authenticated for identity only (OpenID sign-in) have no `GoogleCredential`
record — sign-in uses `access_type=online` and returns no refresh token, so
there is nothing to store until Drive is connected.
