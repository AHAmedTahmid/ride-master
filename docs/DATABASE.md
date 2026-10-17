# Ride Master — MySQL Database Design

MySQL 8.4 LTS, InnoDB, `utf8mb4_0900_ai_ci`. Raw SQL migrations in `apps/api/src/database/migrations` are authoritative; the Prisma schema (`apps/api/prisma/schema.prisma`) mirrors them for application queries. This document describes the full design and the reasoning behind every constraint that the database enforces by itself.

## Conventions

| Rule | Detail |
| --- | --- |
| Engine / charset | InnoDB, `utf8mb4_0900_ai_ci` (Dhivehi Thaana text must round-trip) |
| Primary keys | `id BIGINT UNSIGNED AUTO_INCREMENT` — internal only, never exposed by the API |
| Public ids | `public_id CHAR(26)` ULID, unique — the only id the API ever returns |
| Money | Integer **laari** (1 MVR = 100 laari) in `BIGINT` columns; percentages in **basis points** (10% = 1000). No floats, ever |
| Time | `DATETIME(3)` in **UTC**; server `default-time-zone=+00:00`; display in `Indian/Maldives` |
| Statuses | `VARCHAR` + `CHECK` constraints, never `ENUM` (easier to extend) |
| Foreign keys | Table-level `CONSTRAINT ... FOREIGN KEY` (MySQL silently ignores inline `REFERENCES`) |
| Soft delete | `deleted_at` on users, companies, drivers, vehicles |
| Timestamps | `created_at`, `updated_at` (`ON UPDATE CURRENT_TIMESTAMP(3)`) on mutable tables |
| Partial uniqueness | Generated columns + `UNIQUE` keys (MySQL has no partial indexes) |

## Entity relationship overview

```
users ──< user_roles >── companies ──< vehicles ──< driver_vehicle_assignments >── drivers
                │              │                        │                          │
                │              ├──< company_documents   └── driver_status          │
                │              ├──< company_service_areas ── areas (geometry)      │
                │              ├──< fares ──< fare_history                         │
                │              ├──< surcharges                                     │
                │              ├──< company_ledger                                 │
                │              └──< settlement_statements ──< settlement_lines     │
                │                                                                  │
                ├──< sessions                                                       │
                ├──< otp_codes                                                      │
                ├──< user_consents                                                  │
                └──< notifications / audit_logs                                     │
                                                                                   │
rider (users) ──< bookings >── company + driver + vehicle + areas                  │
                    ├──< booking_offers (to drivers) ──────────────────────────────┘
                    ├──< booking_status_history
                    ├──< booking_locations (breadcrumbs)
                    ├──< payments / company_ledger / settlement_lines / refunds
                    ├──< ratings (rider→driver+company) / rider_ratings (driver→rider)
                    └──< complaints

suggested_fares: areas × areas × vehicle_types (set by SuperAdmin)
vehicle_types: platform-wide catalogue
commission_rules: global or per-company, basis points
platform_settings: key/value JSON (defaults for timeouts, limits, credit)
```

## Database-enforced invariants

These rules live in the schema, not in application code — no race condition can break them.

1. **One open vehicle assignment per driver and per vehicle** — `driver_vehicle_assignments.open_driver_key` / `open_vehicle_key` are generated columns (`IF(assigned_to IS NULL, id, NULL)`) with `UNIQUE` keys. `NULL` (not `0`) marks closed rows because MySQL's UNIQUE allows many NULLs, so closed history rows never collide.
2. **One active trip per driver** — `driver_status.on_trip_key = IF(state='on_trip', driver_id, NULL)` with a `UNIQUE` key, plus one row per driver (PK `driver_id`).
3. **One role-combination per user** — `user_roles.company_id_key = COALESCE(company_id, 0)` with `UNIQUE (user_id, role, company_id_key)`: a user cannot hold the same role twice for the same company, and `company_id = 0` sentinel keeps rider/superadmin roles unique.
4. **One booking per idempotency key** — `bookings.idempotency_key` unique: a double-tapped Book button can never create two bookings.
5. **One commission charge per booking** — `company_ledger (company_id, booking_id, type)` unique: a completed ride is charged exactly once.
6. **One settlement line per booking** — `settlement_lines.booking_id` unique: a booking cannot be paid out twice.
7. **One rating per booking per direction** — `ratings.booking_id` and `rider_ratings.booking_id` each unique.
8. **One fare per company per route per vehicle type** — `fares (company_id, from_area_id, to_area_id, vehicle_type_id)` unique.
9. **One suggested fare per route per vehicle type** — `suggested_fares (from_area_id, to_area_id, vehicle_type_id)` unique.
10. **Phone uniqueness** — `users.phone` unique (one account per number, normalised to `+960XXXXXXX`).
11. **Plate uniqueness** — `vehicles.plate_number` unique across the platform.
12. **Foreign keys are real** — every relationship is a hard constraint with explicit `ON DELETE` behaviour (`RESTRICT` for money and identity, `CASCADE` for children of bookings, `SET NULL` for references that may disappear).

## Table reference

### 001_identity.sql

| Table | Purpose | Notes |
| --- | --- | --- |
| `users` | One account per phone number | `password_hash`/`totp_secret_enc` only for superadmins; `language` `en`/`dv`; soft delete |
| `user_roles` | Many roles per user | `role ∈ {superadmin, company_owner, driver, rider}`; `admin_level` only for superadmin; `company_id NULL` for rider/superadmin; uniqueness via generated `company_id_key` |
| `otp_codes` | Phone OTP logins | argon2 `code_hash`, 5 attempts, TTL, single-use (`used_at`), indexed by `(phone, purpose, expires_at)` |
| `sessions` | Refresh sessions | `refresh_token_hash` (argon2), `user_role_id` pins the active role, `revoked_at` for logout, expiry indexed |
| `user_consents` | Legal proof | document name + version + timestamp + IP for terms/privacy/operator agreement |

### 002_companies.sql

| Table | Purpose | Notes |
| --- | --- | --- |
| `companies` | Operator (company or individual) | `type ∈ {company, individual}`; `status ∈ {pending, approved, rejected, suspended}`; `commission_override_bps` NULL = global rate; `balance_limit_laari` (max debt, default 500 MVR credit); soft delete |
| `company_documents` | Licences, registration, insurance | `expiry_date` drives the daily expiry job; `status ∈ {pending, verified, rejected, expired}` |
| `company_service_areas` | Which areas an operator covers | composite PK `(company_id, area_id)`; FK to `areas` added in 004 |
| `company_staff` | Owner-added managers/dispatchers | unique `(company_id, user_id)`; `staff_role ∈ {manager, dispatcher}` |

### 003_fleet.sql

| Table | Purpose | Notes |
| --- | --- | --- |
| `vehicle_types` | Platform catalogue | SuperAdmin-managed: standard car (4), van (6), large van (8); `seats`, `luggage_capacity` |
| `vehicles` | Fleet | unique `plate_number`; `insurance_expiry`; soft delete |
| `drivers` | Company drivers | FK to `users` + `companies`; `licence_expiry`; `id_card_number` encrypted at app layer; soft delete |
| `driver_vehicle_assignments` | Shifts | generated `open_driver_key`/`open_vehicle_key` UNIQUE ⇒ one open assignment per driver and per vehicle |
| `driver_status` | Live state | one row per driver; `state ∈ {offline, online, on_trip}`; last position mirrored in Redis GEO; `on_trip_key` UNIQUE |

### 004_areas_pricing.sql

| Table | Purpose | Notes |
| --- | --- | --- |
| `areas` | Zones (Malé, Hulhumalé P1/P2, Airport, Villimalé) | `geometry POLYGON` SRID 0, coordinates ordered **(longitude, latitude)**; SPATIAL INDEX; `name_en` + `name_dv` |
| `suggested_fares` | SuperAdmin reference prices | one-tap accept for new operators and individuals |
| `fares` | Operator prices | unique per company+route+vehicle type; `active` flag; `valid_from`/`valid_to` windows |
| `surcharges` | Night/airport/luggage | fixed `amount_laari` or `percent_bps`; optional daily `time_from`/`time_to` window (UTC) |
| `fare_history` | Price audit trail | every change recorded with old/new price and who changed it |

### 005_bookings.sql

| Table | Purpose | Notes |
| --- | --- | --- |
| `saved_places` | Rider shortcuts | map pins, landmarks |
| `bookings` | The ride | unique `idempotency_key`; full status lifecycle + timestamps per transition; money snapshot (`quoted_price_laari` locked at booking, `final_price_laari`, `tax_laari`, `commission_bps`/`commission_laari`); indexed on rider, company+status, driver, status, requested_at |
| `booking_offers` | Fan-out log | unique `(booking_id, driver_id)`; `response ∈ {accepted, declined, timeout}` |
| `booking_status_history` | Who changed what, when | dispute resolution source of truth |
| `booking_locations` | Trip breadcrumbs | deleted after retention period (nightly job) |

### 006_money.sql

| Table | Purpose | Notes |
| --- | --- | --- |
| `commission_rules` | Global or per-company | `percent_bps` + optional `fixed_fee_laari`; validity window; company override wins over global |
| `payments` | Cash/card/wallet record | MVP creates cash rows on completion |
| `company_ledger` | Running operator balance | `amount_laari` negative for charges; `balance_after_laari` for fast reads; UNIQUE `(company_id, booking_id, type)` blocks double commission; balance beyond `balance_limit_laari` pauses new requests |
| `settlement_statements` | Monthly bill | per company + period; totals + status `open/issued/paid`; unique period per company |
| `settlement_lines` | Booking-level detail | unique `booking_id` |
| `refunds` | Admin-approved money back | status workflow `pending → approved/rejected → processed` |

### 007_trust_system.sql

| Table | Purpose | Notes |
| --- | --- | --- |
| `ratings` | Rider → driver + company | `driver_score`/`company_score` 1–5; one per booking |
| `rider_ratings` | Driver → rider | one per booking; underpins no-show warnings and bans |
| `complaints` | Disputes | `against_type ∈ {driver, company, rider}`; status workflow |
| `notifications` | In-app / push / SMS log | `data JSON` payload; `read_at` |
| `audit_logs` | Sensitive actions | actor, action, entity, old/new JSON values, IP, request id |
| `platform_settings` | Tunables | JSON values; defaults seeded: commission 1000 bps, request timeout 60 s, search radius 10 km, cancellation window 300 s, individual vehicle limit 3, starting credit 50 000 laari, GST 0 bps, SMS budget, retention 90 days |

## Operational notes

- **Migrations**: raw SQL files applied by `apps/api/src/database/migrate.ts` in filename order; tracked in `schema_migrations`; runner refuses to run when tables exist without recorded versions (MySQL DDL cannot roll back).
- **Connection pooling**: 10–20 connections per API instance; ProxySQL when scaling out.
- **Concurrency**: booking and ledger changes use short `READ COMMITTED` transactions with deadlock retry (application layer, Phase 3/5).
- **Live data**: Redis GEO holds driver positions; MySQL `driver_status` keeps only last known position and state.
- **Retention**: nightly job deletes `booking_locations`, expired `otp_codes`, revoked/expired `sessions` and old `notifications` in small batches.
- **Monitoring**: slow query log at 200 ms, reviewed weekly.
- **Scaling later**: read replica for admin reports; monthly partitioning of `booking_locations` and `audit_logs`.
