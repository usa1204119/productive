# Deploying

The app deploys as **one service**: the Docker image builds the web app and runs
the Express server, which serves the web app **and** the API from a single
origin. That keeps session cookies first-party (no CORS, no cross-site issues).
Do **not** split the frontend and backend onto different domains — the session
cookie would become cross-site (third-party), which browsers increasingly block.

Two hosts are covered: **Render (free)** and **Railway**. The database is
external (Supabase or Neon) either way.

---

# Option A — Render (free) + Supabase

## 1. Supabase database
- Create a project at supabase.com. Set a database password.
- **Settings → Database → Connection string → "Session pooler"** (port **5432**,
  host `…pooler.supabase.com`). Use THIS as `DATABASE_URL`.
  - Why the session pooler: it's IPv4 (Render's outbound is IPv4; Supabase's
    *direct* connection is IPv6-only) **and** it supports Prisma's schema
    push/migrations. Do **not** use the *transaction* pooler (port 6543) — it
    breaks Prisma migrations.
  - Replace `[YOUR-PASSWORD]`, and append `?sslmode=require` if it's not there.

## 2. Render service
- Push this repo (done). Render → **New → Blueprint** → pick the repo. It reads
  [`render.yaml`](render.yaml) and creates a free Docker web service.
  (Or **New → Web Service → Docker** and select the repo manually.)
- Render assigns a URL like `https://<your-app>.onrender.com`.

## 3. Environment variables (Render → the service → Environment)
`PORT` is injected by Render automatically. Set the rest (same as the table
below), using your `onrender.com` URL for `SERVER_URL` / `WEB_URL` / the two
redirect URIs, and the Supabase session-pooler string for `DATABASE_URL`.

## 4. Google Console + deploy
Add the `onrender.com` redirect URIs / origin (see the Google section below),
then trigger a deploy. Note: the free instance **sleeps after ~15 min idle** and
takes ~30–60s to wake on the first request — expected on the free tier.

---

# Option B — Railway

The app deploys as **one service** (same single-origin model).

## 1. Push to GitHub
Railway deploys from a GitHub repo. Push this repo, then in Railway:
**New Project → Deploy from GitHub repo →** pick it. Railway detects the
`Dockerfile` and builds it.

## 2. Database (Neon)
Use your Neon connection string as `DATABASE_URL`. Two tips for Prisma:
- Prefer the **direct** connection string (host **without** `-pooler`). Neon's
  pooled endpoint can trip up Prisma's schema push/migrations.
- Keep `?sslmode=require`. If you hit a channel-binding error, drop
  `&channel_binding=require`.

The container runs `prisma db push` on start, so tables are created
automatically on first deploy.

## 3. Environment variables (Railway → Variables)
`PORT` is injected by Railway automatically. Set the rest:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `SERVER_URL` | `https://<your-app>.up.railway.app` |
| `WEB_URL` | `https://<your-app>.up.railway.app` (same origin) |
| `DATABASE_URL` | your Neon direct URL (`…?sslmode=require`) |
| `SESSION_COOKIE_SECURE` | `true` |
| `ENCRYPTION_KEY` | 64 hex chars (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `GOOGLE_CLIENT_ID` | from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | from Google Cloud Console |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://<your-app>.up.railway.app/auth/google/callback` |
| `GOOGLE_DRIVE_REDIRECT_URI` | `https://<your-app>.up.railway.app/auth/google/drive/callback` |

> Order of operations: create the Railway service first so you know the
> `*.up.railway.app` domain, fill these in (using that domain), then continue to
> step 4 and redeploy.

## 4. Google Cloud Console (OAuth client)
On your existing OAuth 2.0 **Web** client, add:

**Authorized redirect URIs**
- `https://<your-app>.up.railway.app/auth/google/callback`
- `https://<your-app>.up.railway.app/auth/google/drive/callback`
- `http://localhost:4000/auth/google/callback` (local dev)
- `http://localhost:4000/auth/google/drive/callback` (local dev)

**Authorized JavaScript origins**
- `https://<your-app>.up.railway.app`
- `http://localhost:5173` (local dev)

While the OAuth consent screen is in **Testing**, add your Google account under
**Test users** (or **Publish** the app). The requested scopes are only
`openid email profile` (sign-in) and `drive.file` (Documents) — no verification
needed for these to work with test users.

## 5. Deploy & verify
Trigger a redeploy after setting the variables. Then open the Railway URL and use
**Sign in with Google**. Check the deploy logs for `Server listening` and
`Serving web build from …`.

## Local run with real Google sign-in
Fill `apps/server/.env` (gitignored) with the same values but localhost URLs, set
`USE_PGLITE` **off**, then:

```
npm install
npm run prisma:generate
npm run db:push --workspace apps/server     # create tables in Neon
npm run dev:server                          # :4000
npm run dev:web                             # :5173
```

Open http://localhost:5173 → Sign in with Google.
