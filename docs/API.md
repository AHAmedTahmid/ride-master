# HTTP API Reference — v1

Base URL: `http://<host>:3001/api/v1` (Swagger UI at `/api/docs` in dev).

## Conventions

- **Ids:** ULID `public_id` strings (26 chars). Internal BigInt ids never
  appear in responses.
- **Money:** integer laari (1 MVR = 100 laari).
- **Auth:** `Authorization: Bearer <accessToken>` plus the httpOnly refresh
  cookie `rm_refresh` (scoped to `/api/v1/auth`) for session endpoints.
- **Errors:** one envelope for every failure:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "requestId": "…",
  "fields": [{ "field": "phone", "message": "…" }]
}
```

- **Request id:** every response carries `X-Request-Id`; send your own to
  correlate client logs with audit rows.
- **Pagination** (where present): `?page=1&limit=50` → `{ data, meta: { page,
limit, total, totalPages } }`.

## Health (public)

| Method | Path      | Notes                                                         |
| ------ | --------- | ------------------------------------------------------------- |
| GET    | `/health` | `{ status: "ok" \| "degraded", checks: { database, redis } }` |

## Auth (public unless noted)

| Method | Path                     | Body                                  | Response                                                                                       |
| ------ | ------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| POST   | `/auth/otp/request`      | `{ phone, purpose: login\|register }` | `{ expiresInSeconds }` — 5/min per IP, strict per-phone hourly cap                             |
| POST   | `/auth/otp/verify`       | `{ phone, code, purpose }`            | `{ accessToken, user: { publicId, activeRole } }` + refresh cookie; `register` creates a rider |
| POST   | `/auth/admin/login`      | `{ email, password }`                 | `{ preAuthToken }` (short-lived, binds to the email)                                           |
| POST   | `/auth/admin/login/totp` | `{ email, totpToken, preAuthToken }`  | `{ accessToken, user }` + refresh cookie                                                       |
| POST   | `/auth/refresh`          | — (cookie)                            | `{ accessToken, user }`, rotates cookie; reuse of an old token revokes the session             |
| POST   | `/auth/logout`           | Bearer                                | 204, revokes session, clears cookie                                                            |

Rules: phone numbers normalize to `+960XXXXXXX`; OTP codes are 6 digits,
single-use, 5 attempts, TTL 5 minutes; admin passwords ≥ 8 chars; wrong
password/TOTP/login are audited.

## Me (authenticated)

| Method | Path                               | Notes                                                                                                               |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GET    | `/me`                              | Profile, `activeRole`, `adminLevel`, roles with company scope                                                       |
| POST   | `/me/switch-role`                  | `{ role, companyId? }` → new access token; `companyId` required for owner/driver, taken from the caller's role link |
| PATCH  | `/me/language`                     | `{ language: "en" \| "dv" }`                                                                                        |
| GET    | `/me/notifications`                | Caller-scoped notifications, newest first                                                                           |
| PATCH  | `/me/notifications/:publicId/read` | `{ read?: boolean }` → `{ publicId, read }` — only the owner's rows                                                 |

## Settings

| Method | Path              | Access                     | Notes                                                  |
| ------ | ----------------- | -------------------------- | ------------------------------------------------------ |
| GET    | `/settings`       | any authenticated          | `Record<key, value>` tunables for clients              |
| PUT    | `/admin/settings` | superadmin + `super` level | `{ settingKey, value }`; unknown keys are 400; audited |

## Admin

| Method | Path                | Access                 | Notes                                                                 |
| ------ | ------------------- | ---------------------- | --------------------------------------------------------------------- |
| GET    | `/admin/audit-logs` | superadmin (any level) | Filters: `action`, `entityType`; rows carry actor **public** ids only |

## Rate limits

Global: 100 req/min per IP (Redis-backed). Strict: OTP request/verify and
admin login 5/min per IP. OTP per-phone hourly cap from
`OTP_RATE_LIMIT_PER_HOUR`.

## Roadmap endpoints

Company signup/approval, fleet CRUD, fares, booking lifecycle, driver realtime,
settlements and refunds land in Phases 2–4 (`docs/ROADMAP.md`); this file grows
with them.
