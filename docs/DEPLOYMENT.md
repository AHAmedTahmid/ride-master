# Deployment — Ride Master

## Artefacts

| Image / artifact | Built from            | Runs                                                       |
| ---------------- | --------------------- | ---------------------------------------------------------- |
| `apps/api` image | `apps/api/Dockerfile` | NestJS on `:3001`, serves `/api/v1` (+ `/api/docs` in dev) |
| `apps/web` image | `apps/web/Dockerfile` | Next.js standalone on `:3000`                              |

Both are multi-stage; `.dockerignore` keeps `.env` and build junk out of the
context.

## Configuration

Everything is environment-driven (`.env.example` is the contract):

- **Required:** `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`
  (64-byte hex each: `openssl rand -hex 64`).
- **Providers:** `SMS_PROVIDER=console` is dev-only — production must implement
  and select a real provider before OTP login works for end users.
  `STORAGE_PROVIDER=minio` points at MinIO or an S3-compatible bucket.
- **Web:** `NEXT_PUBLIC_API_URL` is baked at **build time** — pass it as a
  build arg when building the web image.
- `CORS_ORIGINS` must list the exact web origin (comma-separated).

## Database

1. Provision MySQL 8.4 with `utf8mb4` / `utf8mb4_0900_ai_ci` (see
   `infrastructure/docker/mysql` for the dev reference config).
2. Run migrations before rolling new API code:

```bash
docker compose run --rm api pnpm --filter api db:migrate
```

3. Migrations are forward-only raw SQL (`apps/api/migrations`); the runner
   records applied files in `schema_migrations`. Back up before deploying;
   `docs/DATABASE.md` documents each change.
4. Seed (`pnpm db:seed`) is for **demo environments only** — it refuses to run
   against production (`SEED_ALLOW_PRODUCTION` guard in the script).

## Docker Compose (full stack)

```bash
cp .env.example .env    # set secrets
docker compose up -d --build
docker compose run --rm api pnpm --filter api db:migrate   # once
# optional demo data:
docker compose run --rm api pnpm --filter api db:seed
```

- `web` → http://localhost:3000
- `api` → http://localhost:3001/api/v1 (Swagger at `/api/docs`)

## Production checklist

- [ ] `NODE_ENV=production` (enables secure cookies, disables Swagger).
- [ ] TLS terminated at the proxy; forward `X-Forwarded-For` (API trusts the
      proxy chain for rate limiting and audit IPs).
- [ ] Real SMS provider implemented and selected; daily SMS budget set in
      platform settings.
- [ ] MySQL/Redis managed with backups + monitoring; InnoDB + utf8mb4.
- [ ] MinIO/S3 bucket private; uploads via short-lived signed URLs only.
- [ ] `CORS_ORIGINS` restricted to the real web origin.
- [ ] Log shipping includes `requestId` (every error envelope and audit row
      carries it).
- [ ] Run migrations as a release step, not on container start (the default
      API command is `node dist/main`).
- [ ] Health checks hit `GET /api/v1/health` (DB + Redis).

## Scaling notes

- API is stateless (JWTs + Redis) — scale horizontally behind a load balancer.
- Socket.IO (Phase 3) needs the Redis adapter for multi-instance fan-out.
- The web image is Next standalone; serve it as-is or front it with a CDN for
  `/en`, `/dv` and static assets.

## Windows note

`output: 'standalone'` needs symlink privileges; on dev machines without
Developer Mode build the web app with `NEXT_OUTPUT=off` (CI and Docker builds
keep the default).
