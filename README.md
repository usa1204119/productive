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

Sessions are opaque tokens in an httpOnly cookie (30 days); only their SHA-256
hash is stored. Drive scope is **not** requested here — it comes later,
incrementally, when the user first opens Documents.
