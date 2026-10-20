# Architecture — Ride Master

## Overview

```
┌────────────┐   HTTPS/JSON + refresh cookie   ┌────────────┐
│  apps/web  │ ──────────────────────────────► │  apps/api  │
│  Next.js   │ ◄────── Socket.IO (Phase 3) ─── │  NestJS    │
└────────────┘                                 └─────┬──────┘
                                                     │
                            ┌────────────────────────┼──────────────────┐
                            ▼                        ▼                  ▼
                      MySQL 8.4 (InnoDB)         Redis 7         MinIO / S3
                      Prisma + raw SQL         cache/OTP/        documents
                      (spatial, CHECKs)        rate limits       (Phase 2)
```

One Next.js app serves all four roles; the server-side session's `activeRole`
selects the interface. One NestJS API serves everything; guards + a policy
layer enforce who may touch what (`docs/PERMISSIONS.md`).

## apps/api (NestJS)

| Layer                 | Responsibility                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `modules/*`           | Feature slices (auth, users, settings, audit, notifications; fleet/booking/companies in later phases)               |
| `common/guards`       | `JwtAuthGuard` (global), `RolesGuard`, `AdminLevelGuard`                                                            |
| `common/policy`       | `PolicyService` — the only place that answers "may this actor touch this record?" (company scope, self, superadmin) |
| `common/filters`      | One error envelope for every failure: `{ statusCode, error, message, requestId, fields? }`                          |
| `common/interceptors` | `RequestIdInterceptor` — accepts/generates `X-Request-Id`, echoes it, stores it in AsyncLocalStorage for audit rows |
| `common/pipes`        | `ZodValidationPipe` — zod-first validation, 400 with per-field messages                                             |
| `providers/*`         | Swappable SMS / Map / Storage adapters; dev defaults are console, haversine, MinIO                                  |
| `database`            | `PrismaService`, migration runner (raw SQL), seed/reset CLIs                                                        |

### Request lifecycle

1. Helmet, compression, cookie-parser.
2. `RequestIdInterceptor` establishes the request id.
3. Global `JwtAuthGuard` — unless `@Public()` — builds an `AuthContext`
   (user, session, roles, activeRole, adminLevel, companyId) from the JWT.
4. `RolesGuard` / `AdminLevelGuard` check route metadata.
5. `ZodValidationPipe` validates the body.
6. Controller → service. Company-scoped writes go through `PolicyService`.
7. Failures flow through `AllExceptionsFilter` into the single envelope.

### Auth model

- **Riders:** phone + 6-digit OTP (argon2-hashed, single-use, 5 attempts).
- **Admins:** email + password (argon2) then TOTP (encrypted at rest).
- **Sessions:** refresh token in httpOnly cookie `rm_refresh`
  (path `/api/v1/auth`, SameSite=Lax), rotating on every refresh; reuse of an
  old token revokes the whole session family. Access tokens live 15 minutes.
- Drivers get exactly one active session (single-session rule, D004).

### Data access

Prisma for everything expressible in the schema; raw SQL only where Prisma
cannot go — GEOMETRY columns, generated columns, CHECK-constrained tables.
Prisma's schema maps 1:1 to migration output but never maps those generated
fields (`docs/DATABASE.md`).

### Realtime (Phase 3)

Socket.IO rides the same JWT auth. Channels: driver offer push, booking state
broadcast, admin watch. Redis backs cross-instance pub/sub.

## apps/web (Next.js 14)

- App Router, one route tree per locale (`/en/...`, `/dv/...`), `dir="rtl"`
  for Dhivehi via next-intl.
- Client `AuthProvider` restores the session with one silent
  `POST /auth/refresh` on load; access token stays in memory only.
- `lib/api.ts` is the single HTTP client (envelope-aware errors, one retry
  after refresh on 401).
- AppShell guards every authenticated page and renders role-aware nav.
- PWA: manifest + service worker; static shell cached, API always network-only.
- Dark mode via `class` strategy; persisted in localStorage.

## packages/shared

Zod schemas (auth, booking, company), domain types, and the booking state
machine (`BOOKING_TRANSITIONS`) imported by both apps. Consumed as TS source
by the API (ts-node) and transpiled by Next for the web app.

## Money

Integer laari everywhere (1 MVR = 100 laari). Formatting happens only at the
edge (`formatLaari` in web; never floats in services, SQL, or tests).

## Idempotency & audit

- Booking-affecting POSTs accept `X-Idempotency-Key` (Phase 3 surfaces).
- Every privileged action writes an `audit_logs` row (actor public id, entity,
  before/after, IP, request id). Audit writes are synchronous best-effort: a
  failure is logged and swallowed so it can never mask the original response.
