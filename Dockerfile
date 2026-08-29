# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# OpenSEO — production image
#
# Two final targets are built from this one file:
#   --target runner   the Next.js web app   (default)
#   --target worker   the BullMQ background worker
#
# Node 24 "Krypton" is the current Active LTS and the right default for a
# self-hosted deployment. Node 26 is newer but does not enter LTS until
# October 2026 — bump NODE_VERSION once you want it.
# ---------------------------------------------------------------------------
ARG NODE_VERSION=24
ARG ALPINE_VERSION=3.24


# --- base -------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base
# libc6-compat: some native/prebuilt Node addons expect glibc symbols on Alpine.
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1


# --- deps: full dependency tree, cached on lockfile only --------------------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi


# --- prod-deps: runtime-only tree, used by the worker image -----------------
FROM base AS prod-deps
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi


# --- worker-deps: prod tree with the web-only packages removed --------------
# The worker never imports the web framework, but `npm ci` installs it anyway
# because it is a production dependency of the app. Pruning must happen in its
# own stage: deleting files in a later layer does not shrink the image, since
# the bytes still live in the layer they were copied from.
FROM prod-deps AS worker-deps
RUN rm -rf \
      node_modules/next \
      node_modules/@next \
      node_modules/react \
      node_modules/react-dom \
      node_modules/@img \
      node_modules/sharp \
      node_modules/styled-jsx \
      node_modules/caniuse-lite \
      node_modules/@swc


# --- builder: compiles the Next app and the worker --------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Public NEXT_PUBLIC_* values are inlined at build time, so they must be
# present here rather than only at runtime.
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NODE_ENV=production

RUN npm run build && npm run build:worker


# --- runner: the Next.js web app -------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder /app/public ./public

# `standalone` already contains server.js plus the traced node_modules.
# Static assets and public/ are not included in it and must be copied over.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]


# --- worker: the BullMQ background worker -----------------------------------
FROM base AS worker
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 --ingroup nodejs nextjs

COPY --from=worker-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder     --chown=nextjs:nodejs /app/dist ./dist
COPY --chown=nextjs:nodejs package.json ./

# SQL migrations are applied from this image via `node dist/scripts/migrate.js`.
COPY --chown=nextjs:nodejs drizzle ./drizzle

USER nextjs

# No port and no HTTP surface — liveness is the process itself. The worker
# traps SIGTERM and drains in-flight jobs before exiting.
CMD ["node", "dist/worker/index.js"]
