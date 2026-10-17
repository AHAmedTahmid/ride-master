# Ride Master — Engineering Decisions and Assumptions

Every deviation, default and environment quirk is recorded here. Format: decision, why, consequence.

## D001 — Local dev runs against native MySQL/Redis, Docker optional

This machine has MySQL 8.4.9 and Redis 6.2 running natively (no Docker daemon). `docker-compose.yml` still defines the full stack (MySQL, Redis, MinIO, MailHog, api, web) for machines that have Docker and for staging/production parity, but day-to-day dev on this machine points `DATABASE_URL` at `localhost:3306` native MySQL (`ride_master`) and `REDIS_URL` at `localhost:6379`. CI uses service containers (same images as compose), so behaviour matches.

## D002 — Prisma is used for normal queries; raw SQL owns schema and spatial data

Migrations are raw SQL (`apps/api/src/database/migrations`), applied by our own runner (`migrate.ts`). Prisma's schema maps the same tables for CRUD. Tables/columns Prisma cannot express (generated columns, `GEOMETRY`) are simply not mapped — Prisma never selects or writes them. Spatial queries (area lookup by point) go through `$queryRaw`. Migration files are authoritative; if Prisma drift, fix Prisma.

## D003 — BIGINT ids are Prisma `BigInt`; APIs never expose them

Internal ids are `BIGINT UNSIGNED`. Prisma returns JS `BigInt` which JSON cannot serialise. Rule: controllers/services map to DTOs containing only `public_id` (ULID) before responding. `Number()` conversion of internal ids happens only inside services where the value is known small (dev-scale) or when passed back into parameterised SQL. Consequence: no endpoint ever leaks auto-increment ids.

## D004 — One active session for drivers, multiple for everyone else

"A driver has one active session; a new login signs out the old device" (ROADMAP §7, §12). Implemented per-role: when a user logs in with the `driver` role, all other non-revoked sessions for that user are revoked. Company owners, riders and superadmins may hold several concurrent sessions (desktop + phone is normal for owners reviewing statements). Session fixation: refresh tokens are rotated on every refresh; presenting an already-rotated token revokes the whole session (reuse detection).

## D005 — Admin (superadmin) always signs in with password + TOTP

Superadmin accounts have email + argon2 password + TOTP. Login is two calls: `POST /auth/admin/login` (password) returns a short-lived (5 min) `preAuthToken`; `POST /auth/admin/login/totp` exchanges it plus the 6-digit TOTP for the normal access/refresh pair. Seeded demo admins use fixed TOTP secrets printed by the seed script (dev only, marked `is_demo`). No admin can exist without TOTP — provisioning always emits a secret.

## D006 — OTP delivery is a provider interface; console in dev

`SmsProvider` interface with a `ConsoleSmsProvider` (logs the code — dev only, guarded by `NODE_ENV !== 'production'` guard at construction). Production adapter (Dhiraagu/Ooredoo route or an aggregator) plugs in later without touching auth code. OTP codes are argon2-hashed at rest, single-use, 5 attempts, 5-minute TTL, rate-limited per phone number (Redis counters, `OTP_RATE_LIMIT_PER_HOUR`).

## D007 — Access token lives in memory on the web app, refresh token in httpOnly cookie

Access JWT (15 min) is held in JS memory (never localStorage — XSS cannot exfiltrate it). Refresh token is an opaque random string in an httpOnly, SameSite=Lax, Secure(in prod) cookie scoped to `/api/v1/auth`. The web client silently calls `/auth/refresh` on 401. CSRF on the refresh endpoint is mitigated by SameSite=Lax + strict CORS origin allowlist; state-changing endpoints additionally require the `Authorization` header (not cookie), so classic CSRF cannot trigger them.

## D008 — Money is integer laari; percentages are basis points

1 MVR = 100 laari. Commission 10% = 1000 bps. Helpers in `apps/api/src/common/utils/money.ts` and `@ride-master/shared` constants. No floats touch money anywhere; DB columns are BIGINT.

## D009 — Timezone: store UTC, display Indian/Maldives

All `DATETIME(3)` columns are UTC (server `default-time-zone=+00:00`). Formatting to Maldives time happens in the web app (Intl with `Indian/Maldives`). Business windows (e.g. night surcharge) are evaluated against Maldives local time converted to UTC.

## D010 — Statuses are VARCHAR + CHECK, never ENUM

Per ROADMAP §6. Values live in `packages/shared` types so API and web share one definition. Changing a status later is a data migration, not an ENUM alter.

## D011 — Booking lifecycle is a shared transition table

`BOOKING_TRANSITIONS` in `packages/shared` defines every legal `from → to` and who may trigger it. The bookings service (Phase 3/4) enforces it inside a transaction and writes `booking_status_history`. Any unlisted transition → 422 `INVALID_TRANSITION`.

## D012 — i18n: English complete, Dhivehi scaffolded with best-effort strings

MVP ships `en` and `dv` locales via next-intl. Dhivehi strings for core navigation/auth were written as a first pass; product copy needs a native review before launch (founder will supply final text per build prompt §14). Missing keys fall back to English (`fallbackLocale: 'en'`). RTL is driven by `dir="rtl"` on `<html>` for `dv` using Tailwind logical properties.

## D013 — Web PWA without a framework plugin

Service worker + manifest are hand-written (`public/sw.js`, `public/manifest.webmanifest`) and registered in the root layout. Keeps the bundle small and avoids lock-in to `next-pwa` (which lags Next majors). Offline: static-asset cache-first, network-first for API GETs with offline banner.

## D014 — Tests run against a real MySQL test database

Unit tests are pure; integration/API tests (auth, sessions, policy/permission matrix) run against `ride_master_test` on the same MySQL instance, migrated fresh per CI job, tables truncated between tests. No mocked database for anything touching business rules — a fake DB would let constraint bugs (unique keys, generated columns) slip through.

## D015 — Idempotency and race safety designed in from Phase 1 schema

`bookings.idempotency_key` UNIQUE; `driver_status.on_trip_key` generated-column UNIQUE (one trip per driver); `company_ledger (company_id, booking_id, type)` UNIQUE (no double commission). Accept-ride in Phase 3 will be a single conditional `UPDATE ... WHERE status='offered' AND driver_id IS NULL` checking affected rows. Phase 1 only lays the constraints and tests the generated-column behaviour.

## D016 — Validation is zod-first, shared package is the contract

Request DTOs are validated with zod schemas exported from `@ride-master/shared` (via a small `ZodValidationPipe`). NestJS `class-validator` is a dependency of the scaffold but new code does not use it — one validation library, shared between client and server, prevents drift.

## D017 — Audit log writes are fire-and-forget within the request

`AuditService.log()` is awaited inside the same request (not a queue) so an approval cannot succeed without its audit row. Volume is low (sensitive actions only). If it ever becomes hot, swap the transport to BullMQ behind the same interface.

## D018 — Demo seed data is flagged and removable

Every seeded row carries `is_demo = 1` where the column exists (companies, drivers, vehicles, vehicle types, areas) or a `DEMO` marker in the name (users). `pnpm db:reset` drops, re-migrates and re-seeds. A production deploy never runs the seed.

## D019 — GST defaults to 0 until legal advice

`gst_rate_bps` platform setting exists and `bookings.tax_laari` is stored, but the rate is 0 until an accountant confirms treatment (ROADMAP §12 open questions). The plumbing is ready; no code change needed when the rate is set.

## D020 — Individual operator vehicle limit is a platform setting

`individual_vehicle_limit` (default 3) read from `platform_settings`, enforced in Phase 2 company/fleet endpoints, surfaced in shared constants as the dev fallback.
