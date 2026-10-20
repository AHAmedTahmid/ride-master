# Ride Master

A web-based taxi marketplace for the Maldives. One platform, many licensed taxi
companies and independent owner-drivers — the rider picks from live prices and
the chosen company fulfils the ride. Ride Master earns a commission per ride.

**Status: Phase 1 (foundation) complete.** Monorepo, database, API, auth,
permissions, tests, CI, and the web shell (login + role dashboards) are in
place. Booking and fleet features land in Phases 2–4 (`docs/ROADMAP.md`).

## Repository layout

| Path              | What it is                                                                              |
| ----------------- | --------------------------------------------------------------------------------------- |
| `apps/api`        | NestJS REST API + Socket.IO, Prisma (MySQL), Redis                                      |
| `apps/web`        | Next.js 14 App Router web app (PWA, en + dv with RTL)                                   |
| `packages/shared` | Zod schemas, domain types, constants shared by both                                     |
| `docs/`           | PLAN, ROADMAP, DECISIONS, DATABASE, ARCHITECTURE, API, PERMISSIONS, TESTING, DEPLOYMENT |
| `infrastructure/` | Docker configs for MySQL and Redis                                                      |

## Quick start (local, no Docker for the apps)

Prereqs: Node ≥ 20, pnpm ≥ 9, MySQL 8.4, Redis 7.

```bash
pnpm install
cp .env.example .env                      # fill JWT secrets (openssl rand -hex 64)
docker compose up -d mysql redis          # or use your local MySQL/Redis
mysql -u root -p -e 'CREATE DATABASE ride_master CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;'
mysql -u root -p -e 'CREATE DATABASE ride_master_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;'
pnpm --filter @ride-master/shared build
pnpm --filter api exec prisma generate
pnpm db:migrate && pnpm db:seed
pnpm dev                                  # api :3001, web :3000
```

Demo login (from the seed):

- Superadmin: `super@ridemaster.mv` / `RideMaster#2026` + TOTP — the seed prints
  each admin's TOTP secret/otpauth URL to the console, or OTP-login as rider
  `+9607712345` with the code printed to the API console (`SMS_PROVIDER=console`).

## Commands

| Command                                    | Effect                                                |
| ------------------------------------------ | ----------------------------------------------------- |
| `pnpm dev`                                 | Run API + web in watch mode (turbo)                   |
| `pnpm build`                               | Build everything                                      |
| `pnpm lint` / `pnpm typecheck`             | ESLint 9 flat config / tsc across workspaces          |
| `pnpm test`                                | API unit suite (coverage thresholds) + web unit tests |
| `pnpm --filter api test:e2e`               | API e2e against `ride_master_test`                    |
| `pnpm db:migrate` / `db:seed` / `db:reset` | Schema / demo data / drop+migrate+seed                |

## Docs map

- **Build order & acceptance gates:** `docs/PLAN.md`
- **Product roadmap:** `docs/ROADMAP.md`
- **Engineering decisions (ADRs):** `docs/DECISIONS.md`
- **Database design:** `docs/DATABASE.md`
- **Architecture:** `docs/ARCHITECTURE.md`
- **HTTP API reference:** `docs/API.md`
- **Roles & permission matrix:** `docs/PERMISSIONS.md`
- **Testing guide:** `docs/TESTING.md`
- **Deployment:** `docs/DEPLOYMENT.md`

## Non-negotiables encoded in this repo

- Money is integer **laari** end-to-end (1 MVR = 100 laari).
- Ids exposed to clients are ULID `public_id`s — internal BigInt ids never
  cross the API boundary.
- Booking status changes must follow `BOOKING_TRANSITIONS`; anything else is a 422.
- Cross-company access is denied by the policy layer, not ad-hoc checks.
- `.env` is never committed; `.env.example` documents every variable.

## License

Private / unlicensed — all rights reserved by the project owner.
