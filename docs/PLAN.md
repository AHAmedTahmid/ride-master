# Ride Master — Build Plan

Task breakdown per build phase. Source of truth for scope; `docs/ROADMAP.md` for product; `docs/DECISIONS.md` for engineering assumptions. A phase is finished only when its acceptance check passes.

## Phase 1 — Foundation (current)

- [x] Monorepo scaffold (pnpm workspaces, turbo, tsconfig, prettier) — pre-existing
- [x] MySQL migrations 001–007 (raw SQL: spatial, generated columns, CHECKs) — pre-existing
- [x] Migration runner rewrite (comment-safe, `USE`-safe, test-DB safe)
- [x] Bug fixes in 002/003 migrations (mislabeled constraints)
- [x] `docs/PLAN.md`, `docs/DECISIONS.md`, `docs/DATABASE.md`
- [x] Prisma schema mapped 1:1 to migrations (no generated columns mapped)
- [x] API foundation: request-id, consistent error envelope, global validation, health module
- [x] Auth: OTP request/verify (arg​on2), admin login (password + TOTP), refresh rotation with reuse detection, logout, `me`, role switch
- [x] Session rules: single active session for drivers, refresh in httpOnly cookie
- [x] Guards: `JwtAuthGuard`, `RolesGuard`, `AdminLevelGuard`; policy layer (`PolicyService`) for company scoping and ownership
- [x] Audit logging module (write + superadmin read)
- [x] Settings module (platform_settings read/write, super only)
- [x] Notifications module (DB-backed in-app notifications)
- [x] Providers with dev mocks: SMS (console), Map (haversine), Storage (MinIO/local)
- [x] Rate limiting: strict per-phone on OTP, per-email/IP on admin login
- [x] Seed script: 5 areas (polygons), 3 vehicle types, 4 demo companies (1 individual), 12 drivers, 4 superadmins (one per level), 3 riders, suggested fares, demo flag on every row
- [x] Reset script (drop, migrate, seed)
- [x] Web app: Next.js App Router, Tailwind, next-intl (en + dv, RTL), PWA manifest + service worker, design system (Button, Card, Input, Badge, EmptyState, Spinner)
- [x] Web: OTP login, admin login (password + TOTP step), four empty role dashboards, role switcher, language switcher, offline banner
- [x] Tests: unit (money/phone/ulid/totp/otp/policy/state machine), API integration against real MySQL (auth flow, session rotation, rate limits), permission matrix incl. negative cases
- [x] CI: GitHub Actions (lint, typecheck, build, unit + integration with MySQL/Redis services)
- [x] Husky + lint-staged; ESLint flat configs
- [x] docker-compose gains `api` and `web` services (infra services pre-existing)

**Acceptance:** a user can sign in per role, each role sees its empty dashboard, permission tests pass, CI is green.

## Phase 2 — Supply side

- Company signup wizard (company + individual) with document upload (StorageProvider → MinIO)
- Superadmin approval queue (verifier level), document viewer with signed URLs
- Vehicles CRUD (individual limit check), drivers CRUD (company assigns user account), driver–vehicle assignment
- Areas, vehicle types, suggested fares admin CRUD; fares + surcharges company CRUD with fare_history + audit
- Admin levels enforced on all approval endpoints
- Isolation proof tests: company A cannot read/write company B (403/404 matrix)

**Acceptance:** an individual driver and a company can onboard, get approved, and have fares live; isolation tests prove no cross-company access.

## Phase 3 — Driver real-time

- Driver status module: online/offline, location pings (Redis GEO mirror + MySQL last position), wake-lock guidance
- Socket.IO gateway authenticated with the same JWT; rooms per user/company/booking
- Fan-out: request to company's online idle drivers nearest-first (configurable broadcast), 60s timeout job (BullMQ), `ride.taken` to losers
- Atomic accept (conditional UPDATE, one winner), decline, trip actions via transition table
- Concurrency test: two drivers race, exactly one wins; offline drivers get nothing

**Acceptance:** simulated driver race resolved to a single winner; offline drivers receive no offers.

## Phase 4 — Rider flow

- Search endpoint (companies × fares × online drivers × seats → sorted options with ETA) + search UI
- Booking create with idempotency key, re-check availability, clear fallback error
- Live tracking (driver location to rider during active ride only), cancel, history
- Ratings after ride, SOS button (support contact), share-trip link
- Playwright e2e: three contexts (rider, driver, company) complete a ride

**Acceptance:** end-to-end booking passes in Playwright with three browser contexts.

## Phase 5 — Money and ops

- Commission engine on completion (company override → global rule), stored on booking
- Cash flow: company_ledger charge, starting credit, balance-limit pause on search
- Settlement statements (generate, issue, CSV + PDF export), refunds (finance level)
- Complaints/disputes workflow; document expiry job (warn T-30d, pause on expiry)
- Notifications: web push + SMS fallback with budget alert
- KPI dashboard; Dhivehi translation pass (native text supplied by founder)

**Acceptance:** ledger reconciles to booking totals; low balance pauses a company; statements export to PDF and CSV.

## Phase 6 — Hardening and launch prep

- Security review (headers, CSRF, rate limits, secrets, dependency audit)
- Load test against targets (search < 800 ms p95 @ 200 drivers; request delivery < 2 s)
- Accessibility audit (WCAG AA), PWA install verification
- Backup/restore drill, demo script, final docs

**Acceptance:** every checklist item in ROADMAP §13 passes.
