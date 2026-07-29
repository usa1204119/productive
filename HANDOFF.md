# Handoff — Swift Productive

Whiteboard → tasks → documents workspace app. This file is the fast on-ramp for a
new developer/agent.

## Live system
- **App:** https://productive-kel1.onrender.com
- **Repo:** https://github.com/usa1204119/productive (public, branch `master`)
- **Host:** Render — free Docker web service `srv-d9i5fnfavr4c73a6jrn0`. **Auto-deploys on push to `master`.** Container runs `prisma db push` then starts.
- **DB:** Neon Postgres (direct, non-`-pooler` URL for Prisma).
- **Auth:** Google OAuth 2.0. Consent screen is in **Testing** → only listed **Test users** can sign in.

## Access checklist — what to give the new dev
| Access | Why it's needed | Already covered? |
|---|---|---|
| **Render** (dashboard/CLI/API) | deploy, env vars, logs | ✅ provided |
| **GitHub** push on `usa1204119/productive` | commit → triggers deploy (repo is public to read) | add as collaborator or provide a repo-scoped token |
| **Google Cloud Console** (the OAuth client project) | add/edit redirect URIs, add Test users, publish, manage scopes | ❌ **provide GCP project access** — Render does *not* cover this |
| **Neon** dashboard | DB inspect / branch / reset (the connection string is already in Render env) | optional |

## Secrets / env
`apps/server/.env` is **gitignored**. The production values already live in **Render → Environment** (readable with Render access). Template + docs: `.env.example`. Keys:
`DATABASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, GOOGLE_DRIVE_REDIRECT_URI, ENCRYPTION_KEY, SESSION_COOKIE_SECURE, SERVER_URL, WEB_URL`.

> **Rotate before handoff:** the Google **client secret** and the Neon **password** were shared in a prior chat. Rotate both, then update Render + local `.env`. (Also revoke any temporary Render API key / Supabase token if still active.)

## Read first (in the repo)
- **`productive-build-prompt.md`** — the product spec and non-negotiables. Source of truth.
- **`README.md`** — endpoints, architecture, testing.
- **`DEPLOY.md`** — Render + Neon + Google setup steps.

## Run locally
```
npm install
npm run prisma:generate
npm run db:push --workspace apps/server        # create/sync tables on Neon
npm run dev:server                              # :4000
npm run dev:web                                 # :5173 (proxies /auth, /workspaces… to :4000)
```
Zero-setup alternative: set `USE_PGLITE=true` in `apps/server/.env` to run against an in-memory Postgres (data resets on restart) — good for UI work without Neon/Google.

## Verify (do this before every push)
```
npm run typecheck                       # all workspaces, strict
npm run smoke --workspace apps/server   # 150 DB checks against in-process PGlite
npm run test  --workspace apps/web      # Vitest (autosave controller)
npm run build                           # shared + server + web
```

## Deploy
Push to `master` → Render auto-builds the Dockerfile and redeploys. Env-var changes require a redeploy. Full steps in `DEPLOY.md`.

## Guardrails — do NOT break these
- **Google Drive scope = `drive.file` ONLY.** Never request a broader scope (legal + paid-assessment reason). Asserted by a test.
- **Ownership:** every workspace-scoped query is user-scoped via the shared `requireWorkspace` middleware. No unscoped `findMany`. Non-owner == 404.
- **Guest → Google conversion** is one transaction with a duplicate-link guard — a guest must never lose work.
- **Board scene is stored VERBATIM** in Postgres `json` (`@db.Json`, *not* jsonb). Do not "optimize" to jsonb — it reorders keys and breaks round-trips.
- **Excalidraw specifics:** strip `appState.collaborators` on load/save (it's a Map; persisted as an object it crashes restore); images live in `Board.files` (data URLs); the `process` shim in `main.tsx` is required for the prod bundle; autosave is gated on `getSceneVersion` (debounced, single-flight, latest-wins, offline-retry).
- **Board → tasks bridge is one-way.** The Tasks module has zero Excalidraw awareness; the only swap point is `getBoardSelectionProcessor()` (server `lib/bridge/`).
- **Time:** all datetime columns are `timestamptz`; due dates exchanged as UTC ISO, converted to local only in the UI.
- **Prod is single-origin** (Express serves the web build *and* the API from one URL → first-party cookies, no CORS). `SESSION_COOKIE_SECURE=true`, `trust proxy` on. Don't split frontend/backend onto different domains (breaks the session cookie).
- **Runtime:** prod starts via `tsx` (the `shared` package exports TS source). Schema is applied with `prisma db push` on deploy — **no migration files yet**; adopt `prisma migrate` + committed migrations before the schema gets busy.
- **API shape:** every error is `{ "success": false, "error": { "code", "message" } }` via the central error middleware. Structured `pino` logs, no stray `console.log`. Strict TS, no `any`.

## Known follow-ups / tech debt
- Whiteboard image data URLs are stored in Postgres — fine for light use, but move image blobs to object storage (or the Drive integration) before heavy use (Neon free tier ≈ 0.5 GB).
- Adopt Prisma migrations (replace `db push`).
- Live Google OAuth round-trip and real Drive I/O are only verified by hand + the fake-Drive test suite; there's no browser E2E harness yet (Playwright would be the add).
- Custom domain (nicer URL than `*.onrender.com`) is unconfigured.
