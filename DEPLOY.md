# Deploying to Railway

The app deploys as **one service**: the Docker image builds the web app and runs
the Express server, which serves the web app **and** the API from a single
origin. That keeps session cookies first-party (no CORS, no cross-site issues).

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
