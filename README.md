<div align="center">

# OpenSEO

**Open-source, self-hostable SEO &amp; GEO auditing platform.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![Node 24 LTS](https://img.shields.io/badge/Node-24%20LTS-5FA04E.svg)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED.svg)](./Dockerfile)

Run your own instance in a few minutes — on Coolify, on a bare VPS, or on your laptop.

</div>

---

## Contents

- [What's in the box](#whats-in-the-box)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Deploy on Coolify](#deploy-on-coolify)
- [Deploy without Coolify](#deploy-without-coolify)
- [Environment variables](#environment-variables)
- [Architecture](#architecture)
- [Development](#development)
- [Upgrading](#upgrading)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## What's in the box

Two application containers, both built from the same `Dockerfile`:

| Service | Build target | Purpose |
|---|---|---|
| `app` | `--target runner` | Next.js 16 web app, port `3000` |
| `worker` | `--target worker` | BullMQ consumer for crawls &amp; audits |

**OpenSEO does not ship a database.** Postgres and Redis are supplied by you through `DATABASE_URL` and `REDIS_URL` — a managed service, a separate server, or another resource in your orchestrator. This keeps backups, tuning, and upgrades under your control instead of hidden in an application volume.

If you *don't* have separate database servers, an optional overlay runs them alongside the app — see [Quick start](#quick-start).

**Stack:** Next.js 16 (App Router, standalone output) · React 19 · TypeScript · Tailwind CSS 4 · Drizzle ORM · BullMQ · Node 24 LTS on Alpine.

### Why Node 24 and not Node 26?

Node 24 (“Krypton”) is the current **Active LTS** line. Node 26 is newer but does not enter LTS until **October 2026**, so it is not the right default for something you leave running. The version is a build argument, so bumping is a one-liner:

```bash
docker build --build-arg NODE_VERSION=26 --target runner -t openseo:app .
```

---

## Requirements

- Docker with Compose v2
- **PostgreSQL 14+** reachable from the containers
- **Redis 6+** reachable from the containers

MongoDB is not used by OpenSEO — Postgres is the only datastore.

---

## Quick start

```bash
git clone https://github.com/raviroygit/OpenSEO.git
cd OpenSEO
cp .env.example .env
```

### If you already run Postgres and Redis

Edit `.env` and point the two URLs at your servers:

```bash
DATABASE_URL=postgres://user:password@db.example.com:5432/openseo?sslmode=require
REDIS_URL=redis://:password@redis.example.com:6379
```

Then start the app and run the migrations once:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
docker compose exec worker node dist/scripts/migrate.js
```

> Most managed Postgres providers require TLS — append `?sslmode=require` to the URL. For a TLS-enabled Redis endpoint use the `rediss://` scheme (two `s`).

### If you don't have separate database servers

Add the bundled overlay, which runs Postgres 18 and Redis 8 next to the app with persistent volumes:

```bash
# In .env, point the URLs at the compose service names:
#   DATABASE_URL=postgres://openseo:change-me@postgres:5432/openseo
#   REDIS_URL=redis://redis:6379
#   POSTGRES_PASSWORD=change-me

docker compose -f docker-compose.yml -f docker-compose.bundled.yml -f docker-compose.local.yml up -d --build
docker compose exec worker node dist/scripts/migrate.js
```

Then open <http://localhost:3000>. Health check:

```bash
curl http://localhost:3000/api/health            # liveness only
curl "http://localhost:3000/api/health?deep=1"   # also pings Postgres + Redis
```

`docker-compose.local.yml` exists purely to publish ports to your host. **Never deploy that overlay to a server** — see the Coolify section for why.

---

## Deploy on Coolify

These steps deploy the app and worker as a single Coolify resource, reachable at your own domain, talking to your existing databases.

### 1. Point DNS at your server

Create an `A` record for the subdomain you want, pointing at your Coolify server's public IP:

```
openseo.example.com.   A   203.0.113.10
```

Let it propagate before continuing — Coolify needs to resolve the name to issue a TLS certificate.

### 2. Create the resource

In Coolify: **Project → + New → Docker Compose**, and select this Git repository. When asked for the compose file, use:

```
docker-compose.yml
```

Leave the other compose files out. Coolify puts its own reverse proxy in front of your containers and terminates TLS there, so the stack deliberately publishes **no host ports** — it only `expose`s port 3000 on the internal network. Publishing ports on a Coolify host is how you collide with other applications on the same box.

### 3. Set the domain

Open the `app` service and set its **Domain** to your subdomain, including the scheme:

```
https://openseo.example.com
```

Coolify provisions a Let's Encrypt certificate automatically and injects the value into the `SERVICE_FQDN_APP_3000` variable the compose file already declares.

### 4. Set environment variables

Paste these into the resource's **Environment Variables** tab.

| Variable | Value |
|---|---|
| `DATABASE_URL` | **secret** — `postgres://user:pass@db-host:5432/openseo?sslmode=require` |
| `REDIS_URL` | **secret** — `redis://:pass@redis-host:6379` |
| `APP_URL` | `https://openseo.example.com` |
| `NEXT_PUBLIC_APP_URL` | `https://openseo.example.com` |
| `ALLOWED_ORIGINS` | `openseo.example.com` |
| `WORKER_CONCURRENCY` | `4` |

Make sure your database and Redis servers accept connections from the Coolify host's IP — a firewall or `pg_hba.conf` rule is the usual reason a first deploy hangs.

> `NEXT_PUBLIC_APP_URL` is read at **build** time, not run time — Next.js inlines `NEXT_PUBLIC_*` values into the client bundle. Changing it requires a rebuild, not just a restart. The compose file already forwards it as a build argument.

> `ALLOWED_ORIGINS` must contain your domain. Behind a reverse proxy, Next.js rejects Server Action requests from origins it has not been told to trust, which shows up as forms silently failing.

### 5. Deploy

Hit **Deploy**. Coolify builds both targets from the one `Dockerfile` and starts `app` and `worker`.

### 6. Run the database migrations

Migrations are **not** run automatically on boot — an app container that migrates at startup races itself the moment you run more than one replica. Run them once, from the **`worker`** container's terminal in Coolify:

```bash
node dist/scripts/migrate.js
```

The migration runner is built on `drizzle-orm`'s migrator, not the `drizzle-kit` CLI. `drizzle-kit` is a devDependency and is deliberately absent from the runtime images, so `npx drizzle-kit migrate` will not work inside a deployed container. The SQL files in `drizzle/` are shipped in the worker image.

### 7. Verify

```bash
curl https://openseo.example.com/api/health?deep=1
```

Expect `{"status":"ok","checks":{"postgres":"ok","redis":"ok"}}`. In Coolify's log view, the worker should print:

```
[worker] listening on queue "openseo-audits" (concurrency 4)
```

---

## Deploy without Coolify

Any Docker host works. Put a TLS-terminating reverse proxy (Caddy, Traefik, nginx) in front of the app container, then:

```bash
git clone https://github.com/raviroygit/OpenSEO.git
cd OpenSEO
cp .env.example .env   # set DATABASE_URL, REDIS_URL, APP_URL, ALLOWED_ORIGINS

docker compose up -d --build
docker compose exec worker node dist/scripts/migrate.js
```

To scale audit throughput, add worker containers — they are stateless and coordinate through Redis:

```bash
docker compose up -d --scale worker=3
```

Raise `DATABASE_POOL_MAX` only if your database's connection limit allows it: total connections are roughly `(app replicas + worker replicas) × DATABASE_POOL_MAX`.

---

## Environment variables

Full reference; see [`.env.example`](./.env.example) for the annotated version.

| Variable | Required | Default | Used by | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | ✅ | — | app, worker | Postgres connection string. Add `?sslmode=require` for managed providers. |
| `REDIS_URL` | ✅ | — | app, worker | Redis connection string. Use `rediss://` for TLS. |
| `APP_URL` | — | `http://localhost:3000` | app | Public URL of the instance. |
| `NEXT_PUBLIC_APP_URL` | — | `http://localhost:3000` | app (**build time**) | Inlined into the client bundle. |
| `ALLOWED_ORIGINS` | — | — | app | Comma-separated origins permitted to call Server Actions. |
| `QUEUE_NAME` | — | `openseo-audits` | app, worker | Must match across both services. Cannot contain `:` — BullMQ reserves it as the Redis key separator. |
| `WORKER_CONCURRENCY` | — | `4` | worker | Jobs processed in parallel per container. |
| `DATABASE_POOL_MAX` | — | `10` | app, worker | Postgres connections per process. |
| `DATABASE_CONNECT_TIMEOUT_MS` | — | `5000` | app, worker | Connection attempt timeout, so an unreachable host fails fast. |
| `PORT` | — | `3000` | app | |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | — | `openseo` / — / `openseo` | bundled overlay only | Ignored unless you run `docker-compose.bundled.yml`. |

Both services validate `DATABASE_URL` and `REDIS_URL` at boot and exit immediately with a named error if either is missing, rather than failing later with an opaque stack trace.

---

## Architecture

```
                      ┌───────────────────────┐
     HTTPS            │  Coolify proxy        │
    ─────────────────▶│  (TLS termination)    │
                      └───────────┬───────────┘
                                  │ internal network, port 3000
                      ┌───────────▼───────────┐
                      │  app                  │   Next.js 16, standalone
                      │  node server.js       │   non-root (uid 1001)
                      └─────┬───────────┬─────┘
                            │           │
                    enqueue │           │ read/write
                            │           │
   ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│╌╌╌╌╌╌╌╌╌╌╌│╌╌╌╌╌╌╌╌╌╌  your infrastructure
                      ┌─────▼─────┐ ┌───▼────────┐
                      │  Redis    │ │  Postgres  │   external servers
                      │  BullMQ   │ │  Drizzle   │   (managed or self-run)
                      └─────▲─────┘ └───▲────────┘
   ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│╌╌╌╌╌╌╌╌╌╌╌│╌╌╌╌╌╌╌╌╌╌
                            │           │
                     consume│           │
                      ┌─────┴───────────┴─────┐
                      │  worker               │   BullMQ consumer
                      │  node dist/worker     │   drains on SIGTERM
                      └───────────────────────┘
```

**Image design.** One `Dockerfile`, two final targets. `runner` ships the Next.js standalone bundle, which contains only the `node_modules` the app actually reaches. `worker` gets a production-only dependency tree with the web framework pruned in a dedicated stage — pruning in a later layer would not shrink the image, since the bytes still live in the layer they were copied from. Both run as an unprivileged `nodejs` user (uid 1001).

**Shutdown.** Coolify sends `SIGTERM` on every redeploy. The worker traps it, stops accepting new jobs, finishes in-flight ones, and closes its Redis and Postgres handles — so a deploy never strands an audit in `running`.

**Health checks.** `/api/health` is a pure liveness probe and touches no dependencies, so a brief database hiccup cannot cause the orchestrator to kill a healthy web container. `/api/health?deep=1` is the dependency check, for humans and uptime monitors; each probe is bounded by a 5s timeout and reports `degraded` with HTTP 503 rather than hanging when a database is unreachable.

---

## Development

Node 24+ is required on the host for local development (the containerised path needs only Docker).

```bash
npm install
cp .env.example .env

npm run db:push     # sync the schema in development
npm run dev         # http://localhost:3000
npm run worker:dev  # in a second terminal
```

Point `DATABASE_URL` and `REDIS_URL` at whichever servers you develop against. To run throwaway ones locally:

```bash
docker compose -f docker-compose.yml -f docker-compose.bundled.yml -f docker-compose.local.yml up -d postgres redis
```

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build (standalone output) |
| `npm run build:worker` | Compile the worker to `dist/` |
| `npm run worker` | Run the compiled worker |
| `npm run worker:dev` | Run the worker from source with watch mode |
| `npm run typecheck` | Type-check without emitting |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations via drizzle-kit (local dev) |
| `npm run migrate` | Apply pending migrations from the built image (production) |
| `npm run db:push` | Push schema directly (development only) |
| `npm run db:studio` | Drizzle Studio |

### Project layout

```
src/
├── app/                  Next.js App Router
│   ├── api/health/       liveness + dependency probes
│   ├── layout.tsx
│   └── page.tsx
├── db/                   Drizzle schema and connection pool
├── lib/
│   ├── env.ts            fail-fast env validation
│   ├── redis.ts          Redis connection factory
│   └── queue.ts          BullMQ producer-side queue
├── scripts/
│   └── migrate.ts        production migration runner
└── worker/               BullMQ consumer entry point

drizzle/                  generated SQL migrations (committed)
```

---

## Upgrading

```bash
git pull
docker compose up -d --build
docker compose exec worker node dist/scripts/migrate.js
```

Your databases live outside the application containers, so rebuilds never touch your data. On Coolify, pushing to the tracked branch triggers the same sequence; run migrations afterwards from the worker container's terminal.

---

## Troubleshooting

**Compose fails with `DATABASE_URL is required`.**
The compose file uses `${DATABASE_URL:?...}`, which fails loudly rather than silently starting against nothing. Set it in `.env` or in Coolify's environment tab.

**App or worker exits with “Missing required environment variable(s)”.**
`DATABASE_URL` or `REDIS_URL` did not reach the container. Confirm with `docker compose exec app env | grep -E 'DATABASE|REDIS'`.

**Deploy hangs, or `?deep=1` reports a connection timeout.**
The database is not reachable from the Docker host. Check the firewall or security group, and that Postgres accepts the host's IP in `pg_hba.conf`. Note that `localhost` inside a container is the *container*, not your server — use the real host or IP.

**Postgres reports `SSL required` or the connection is rejected.**
Append `?sslmode=require` to `DATABASE_URL`. For Redis over TLS, use `rediss://`.

**`too many connections` from Postgres.**
Total connections are roughly `(app replicas + worker replicas) × DATABASE_POOL_MAX`. Lower `DATABASE_POOL_MAX` or raise the server's limit.

**Coolify shows the app as unhealthy.**
The health check runs *inside* the container against `127.0.0.1:3000`. If it fails, the Next.js server did not bind — check that `HOSTNAME=0.0.0.0` has not been overridden, since binding to `localhost` makes the container unreachable from the proxy.

**Forms or Server Actions fail silently in production.**
`ALLOWED_ORIGINS` is missing your domain. Add it and redeploy.

**The domain resolves but shows a certificate error.**
DNS was still propagating when Coolify tried to issue the certificate. Confirm the `A` record resolves, then redeploy.

**Worker exits with `Queue name cannot contain :`.**
BullMQ reserves `:` as its Redis key separator. Use a separator like `-` in `QUEUE_NAME`.

**Worker is idle and logs nothing.**
`QUEUE_NAME` differs between `app` and `worker`. Both read the same variable — set it once at the resource level, not per service.

**Bundled overlay: Postgres refuses to start after an image upgrade.**
Postgres 18+ images store data in a version-specific subdirectory and expect the volume mounted at `/var/lib/postgresql`, not `/var/lib/postgresql/data`. A volume created by Postgres 17 or older will not be picked up. Dump and restore into the new version, or run `pg_upgrade`.

---

## Contributing

Issues and pull requests are welcome. Please run `npm run typecheck` and `npm run build` before opening a PR, and keep changes focused.

## License

[MIT](./LICENSE) — use it, fork it, host it, sell services on top of it.
