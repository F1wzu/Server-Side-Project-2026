# The app as a container image: the same Node version and packages on every
# computer and on the host. The database is not in here; the app reaches it
# through DATABASE_URL like anywhere else.
#
#   docker build -t painaidee .
#   docker compose --profile app up -d --build     app + local PostgreSQL
#
# Debian "slim" rather than Alpine: sharp and bcrypt ship ready-made binaries
# for it, so nothing has to be compiled during the build.

# ---- Shared base: Node plus the one system library Prisma needs ----
FROM node:24-bookworm-slim AS base
# Prisma's migration tool links against OpenSSL, which the slim image leaves
# out. The package list is deleted again so it does not bloat the image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# ---- Stage 1: install the packages ----
FROM base AS deps
WORKDIR /app
# Only the files npm needs come first, so Docker reuses this layer (and skips
# the slow install) until the package list or the database schema changes.
COPY package.json package-lock.json prisma.config.js ./
COPY prisma ./prisma
# Installs exactly what package-lock.json lists, then `prisma generate` runs
# as the postinstall script. The Prisma command-line tool stays in the image
# on purpose: the container uses it to apply migrations (see docker-compose.yaml).
RUN npm ci

# ---- Stage 2: the image that runs ----
FROM base
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.js ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY public ./public
COPY src ./src
# Photos land here when STORAGE_DRIVER=local. The folder belongs to the
# unprivileged user the app runs as; a volume mounted on it keeps the photos
# when the container is replaced.
RUN mkdir -p storage/uploads && chown -R node:node storage
# Not root: a bug in the app cannot change the image's own files.
USER node
EXPOSE 3000
# Docker marks the container unhealthy when the app cannot reach its database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# node is started directly (not through npm) so it receives the stop signal
# and shuts down cleanly (src/server.js).
CMD ["node", "src/server.js"]
