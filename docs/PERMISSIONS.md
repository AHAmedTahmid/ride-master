# Permissions — Ride Master

Enforcement layers (all must pass):

1. **JwtAuthGuard** (global) — builds `AuthContext` from the access token
   (user, session, roles, `activeRole`, `adminLevel`, `companyId` from the
   session's role row — never from the request).
2. **RolesGuard** — `@Roles(...)` on the route.
3. **AdminLevelGuard** — `@AdminLevels(...)` for superadmin-only surfaces.
4. **PolicyService** — record-level: company scope, self-only, superadmin.

A user may hold multiple roles; the session's `activeRole` decides which face
is presented. Switching roles re-issues the token and can never grant a role
the user doesn't hold.

## Roles and levels

| Role            | Who                                                | Admin level                                                                     |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `superadmin`    | Ride Master staff                                  | `super` (full), `verifier` (approvals), `support` (disputes), `finance` (money) |
| `company_owner` | Taxi company or individual operator (≤ 3 vehicles) | —                                                                               |
| `driver`        | Company employee or the individual owner           | —                                                                               |
| `rider`         | Customer                                           | —                                                                               |

## Route matrix (Phase 1)

| Route                           | rider          | company_owner  | driver         | super/verifier | superadmin super |
| ------------------------------- | -------------- | -------------- | -------------- | -------------- | ---------------- |
| `POST /auth/*` (public entry)   | ✔              | ✔              | ✔              | ✔              | ✔                |
| `GET /me`, `PATCH /me/language` | ✔              | ✔              | ✔              | ✔              | ✔                |
| `POST /me/switch-role`          | own roles only | own roles only | own roles only | own roles only | own roles only   |
| `GET /me/notifications`         | own rows       | own rows       | own rows       | own rows       | own rows         |
| `GET /settings`                 | ✔              | ✔              | ✔              | ✔              | ✔                |
| `GET /admin/audit-logs`         | ✘              | ✘              | ✘              | ✔              | ✔                |
| `PUT /admin/settings`           | ✘              | ✘              | ✘              | ✘              | ✔                |
| `GET /health`                   | public         | public         | public         | public         | public           |

Negative cases are first-class tests: wrong role → 403, missing company link →
403, other company's records → 403, another user's notification → 404/403,
suspended account → 401 on the next request (`apps/api/src/common/guards/auth.guards.spec.ts`,
`policy.service.spec.ts`, `src/modules/permissions.e2e-spec.ts`).

## Record-level rules (policy layer)

- **Company scope:** `requireCompanyScope` — owners/drivers act only inside
  `auth.companyPublicId`; superadmins anywhere. The company id for queries comes
  from `resolveCompanyId` (session) or an explicit superadmin pick — never from
  a request body.
- **Self:** `requireSelf` — a user may always act on their own records;
  superadmins exempt.
- **Superadmin-only mutations:** settings writes, admin management, refunds
  (Phase 3+).

## Rules that apply everywhere

- Suspended/deleted users fail authentication (401) on every protected route.
- Drivers have a single active session (D004) — a second login replaces the
  first.
- Audit rows expose actor **public** ids only; internal ids never leak.
- Every privileged mutation writes an audit row with before/after values.

## Admin levels (future surfaces, enforced today by the guard)

| Capability                | super | verifier | support | finance |
| ------------------------- | ----- | -------- | ------- | ------- |
| Platform settings         | ✔     | ✘        | ✘       | ✘       |
| Company/document approval | ✔     | ✔        | ✘       | ✘       |
| Dispute handling          | ✔     | ✘        | ✔       | ✘       |
| Refunds/payouts           | ✔     | ✘        | ✘       | ✔       |

Add routes with `@Roles('superadmin')` + `@AdminLevels('verifier', …)` as those
endpoints land (Phases 2–4); the matrix above is extended in the same commit.
