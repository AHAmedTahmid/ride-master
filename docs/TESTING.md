# Testing — Ride Master API

Two suites, both on **vitest**.

## Unit suite

```bash
pnpm --filter api test          # vitest run --coverage
pnpm --filter api test:watch
```

- Location: `apps/api/src/**/*.spec.ts` (colocated with the code under test).
- No network, no database: external services (Prisma, Redis, SMS, S3, JWT)
  are replaced with hand-rolled mocks; low-entropy crypto (argon2, TOTP) runs
  for real.
- Coverage thresholds (v8): **80% lines/statements/functions, 75% branches**,
  enforced in `vitest.config.ts`. The suite currently sits above all four.
- The booking state machine (`BOOKING_TRANSITIONS` in `@ride-master/shared`)
  is locked down by `src/common/booking/booking-fsm.spec.ts` before the
  Phase 3/4 services start enforcing it.
- Permission rules are tested at two layers:
  - `guards/auth.guards.spec.ts` + `policy/policy.service.spec.ts` — full
    role/level matrices including negative cases (wrong role, wrong company,
    missing company link, cross-user access).
  - e2e suite below re-asserts the same matrices over HTTP with real tokens.

## E2E suite

```bash
pnpm --filter api db:migrate:test   # once, against ride_master_test
pnpm --filter api test:e2e          # vitest run --config vitest.e2e.config.ts
```

- Location: `apps/api/src/**/*.e2e-spec.ts`.
- Boots the real `AppModule` in-process (supertest, no port binding) against
  the **`ride_master_test` MySQL database and the dev Redis**. Never point it
  at `ride_master`.
- Every spec file starts with `resetAndSeed()` (`src/test/fixtures.ts`):
  drops all tables, re-applies migrations, and inserts a fixed world —
  four superadmins (password + TOTP with a known secret), one rider, one
  approved company with an owner and a driver.
- The SMS provider is replaced by `TestSmsProvider` (`src/test/test-app.ts`),
  which records messages so specs can extract OTP codes without parsing logs.
- Login helpers live in `src/test/login-helpers.ts`.
- Files run **serially** (`fileParallelism: false`) because they share one
  database.

## Vitest/SWC note

Vitest transpiles with esbuild, which cannot emit `emitDecoratorMetadata`.
NestJS DI would receive `undefined` constructor arguments, so both vitest
configs load `unplugin-swc` with `decoratorMetadata: true`. Do not remove it.

## Conventions

- Business rules live in services and are unit-tested there; controllers are
  thin and verified with mocked services plus the e2e suite.
- Every deny path gets a test (negative case), not just the happy path.
- Error-envelope assertions always check `statusCode`, `error` and `message`
  so a regression in `AllExceptionsFilter` fails loudly.
- Money is integer laari everywhere; money tests assert exact integers.
