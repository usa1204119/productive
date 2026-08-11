#!/bin/sh
set -u

# Apply pending migrations, but never let a slow or pooled DB connection hang the
# container. `prisma migrate deploy` acquires a Postgres advisory lock, which
# stalls indefinitely over a transaction pooler (e.g. Neon's "-pooler" host) —
# and a hung entrypoint means the server never starts, so the deploy health
# check times out. Time-box it and start the server regardless: normal deploys
# have no pending migrations, so proceeding after a timeout is safe.
#
# For actual schema changes, point DATABASE_URL at Neon's DIRECT (non-pooler)
# URL so migrations can acquire the lock and this completes cleanly.
if timeout 120 npx prisma migrate deploy --schema apps/server/prisma/schema.prisma; then
  echo "entrypoint: prisma migrate deploy completed"
else
  echo "entrypoint: WARN prisma migrate deploy did not complete (timeout/error); starting server anyway"
fi

exec node apps/server/dist/index.js
