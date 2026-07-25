# Single-image build: builds the web app and runs the Express server, which
# serves BOTH the web app and the API from one origin. Railway/any Docker host.
FROM node:20-slim

# Prisma engines need openssl.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (better layer caching). Dev deps are needed at runtime:
# the server runs via tsx and applies the schema with the Prisma CLI.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci

COPY . .

# Generate the Prisma client and build the web app.
RUN npx prisma generate --schema apps/server/prisma/schema.prisma
RUN npm run build --workspace apps/web

ENV NODE_ENV=production
# Railway injects PORT; the server reads it.
EXPOSE 4000

# Sync the schema to the database, then start. (For migration history instead,
# swap `db push` for `db:deploy` once you have committed migrations.)
CMD ["sh", "-c", "npx prisma db push --schema apps/server/prisma/schema.prisma && npm run start --workspace apps/server"]
