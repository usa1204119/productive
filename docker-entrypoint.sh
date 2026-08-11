#!/bin/sh
set -eu

npx prisma migrate deploy --schema apps/server/prisma/schema.prisma
exec node apps/server/dist/index.js
