# Ride Master: Complete Roadmap and System Plan

*A web-based taxi marketplace for the Maldives. One platform, many taxi companies, the customer chooses.*

## 1. Product Summary

Ride Master owns no taxis. It is a marketplace connecting riders with licensed taxi companies and independent owner-drivers. A rider enters pickup and drop-off, sees every available company with price, vehicle type and ETA, picks one, and that company's driver fulfils the ride. Ride Master earns an agreed commission per completed ride.

**Core flow:** Company signs up, adds fleet and fixed prices, SuperAdmin approves, drivers go online, rider sees options, books, driver accepts, ride completes, commission is recorded.

**Launch corridor:** Hulhumalé to Malé (busiest route, small area, easy to test).

## 2. The Four Roles

| Role | Who | Interface | Main job |
| --- | --- | --- | --- |
| SuperAdmin | Ride Master team | Admin panel (web) | Control the platform, approve companies, set commission, handle disputes |
| Company | Taxi company owner/manager, or an independent driver with 1 to 3 cars | Owner dashboard (web) | Manage fleet, drivers, prices, earnings |
| Driver | Employee of a company, or the independent owner themselves | Driver screen (mobile web/PWA) | Go online, accept rides, complete trips |
| Rider | Customer | Rider site (mobile-first PWA) | Search, book, track, pay, rate |

All four use one web app and one backend. The login decides which interface they see.

### Independent drivers (owner-operators)

A driver with up to three cars and no company registers as a company of type **Individual**. The platform treats them exactly like a one-person company, so nothing else in the system changes.

- They add their 1 to 3 vehicles and set their own fares, or accept the suggested standard fares in one tap.
- One login gives them two screens: the **driver screen** (go online, accept rides) and the **owner dashboard** (fares, earnings, statements).
- If they later hire a driver, they add that person under their own account.
- They are verified like any company: personal taxi licence, vehicle registration, insurance, ID.
- Riders see an "Independent" badge in the options list.
- An Individual account is limited to 3 vehicles (suggested). Beyond that it should register as a full company.

## 3. Role Permissions Matrix

**Legend:** Full = create/read/update/delete, R = read only, Own = only their own records, Co = only their own company's records, None = no access.

| Feature / Data | SuperAdmin | Company | Driver | Rider |
| --- | --- | --- | --- | --- |
| Create/approve/suspend companies | Full | None | None | None |
| Company profile & licence | Full | Own (edit, re-verification needed) | None | R (public info only) |
| Vehicles | Full | Co (Full) | R (assigned vehicle) | R (type only, on booking) |
| Drivers (create/suspend) | Full | Co (Full) | Own profile (limited edit) | R (name, plate, rating on active ride) |
| Price list / fares | Full (can override) | Co (Full, within platform rules) | R (fare of own ride) | R (quotes) |
| Commission rates | Full | R (own rate) | None | None |
| Go online/offline | None | R (see who is online) | Own | None |
| Accept/decline ride request | None | None | Own | None |
| Create booking | Full (on behalf, support) | None | None | Own |
| View bookings | Full (all) | Co | Own (assigned) | Own |
| Cancel booking | Full | Co (with reason) | Own (with reason) | Own (before pickup, rules apply) |
| Payments & settlements | Full | Co (own statements) | Own (daily earnings) | Own (receipts) |
| Ratings | Full (moderate) | Co (read, reply) | R (own) | Create (after ride) |
| Complaints / disputes | Full (resolve) | Co (respond) | Own (respond) | Create/Own |
| Platform settings | Full | None | None | None |
| Audit logs | Full | None | None | None |
| User accounts | Full (all) | Co (own drivers) | Own | Own |

**Rules to enforce in code:**

- Permissions are checked on the **server** for every request, never only in the UI.
- Every company query is filtered by `company_id`. A company must never see another company's data.
- Drivers only see rides assigned to them. Riders only see their own bookings.
- Sensitive actions (suspend, price override, refund, commission change) are written to an audit log.
- A company or driver can be suspended instantly, which also kills their active sessions.

**Independent drivers:** an Individual account holds both the Company and Driver permissions for the same company, as two entries in `user_roles`. They see the owner dashboard and the driver screen, never anyone else's data.

**SuperAdmin staff levels:** the Ride Master team should not all have full power. Each admin account gets a level:

- **Super:** everything, including commission rates, platform settings and creating other admins
- **Verifier:** approve or reject companies, drivers and documents only
- **Support:** view bookings, handle complaints, create bookings on behalf of riders, no money actions
- **Finance:** settlements, refunds, commission statements, no approvals

## 4. Key Business Rules

1. **Fixed fares per route/zone**, set by each company. The rider sees the final price (fare plus any surcharge, such as night or airport) before booking.
2. **Price changes apply only to new bookings.** An accepted ride keeps its price.
3. **A company appears in search only if** it is approved, not suspended, has no expired documents, has a fare for the route, has at least one online and idle driver whose vehicle has enough seats, and has not passed its commission balance limit.
4. **First driver to accept wins.** Requests go to online drivers of the chosen company; others are told the ride is taken.
5. **Request timeout:** if no driver accepts within 60 to 90 seconds, the rider is told and offered other companies.
6. **Commission** is calculated per completed ride from a rule set by SuperAdmin (default percent, overridable per company).
7. **Fleet size is not availability.** Only online drivers count as available.
8. **Cancellation rules:** free before driver acceptance; after acceptance, limits and possible fee; driver/company cancellations are tracked and affect ratings and ranking.
9. **Fair ranking:** the options list sorts by price, ETA or rating, never by who pays Ride Master more.

**Added after review:**

- **Availability means online and idle.** A driver who is on a trip is not available, so an independent with one car cannot take two bookings at once.
- **Re-check at booking.** The system confirms a driver is still free when the rider taps Book. If not, the rider is offered the next company.
- **Safe accept.** Two drivers tapping Accept at the same moment must not both win. Accept is one atomic database step.
- **Document expiry.** Licences and insurance have expiry dates. A daily job warns 30 days ahead and pauses the driver or company on the expiry date.
- **No removing a driver mid-ride.** A company cannot suspend or move a driver who is on an active trip until it ends.
- **No fare, no listing.** A company with no fare for the requested route is not shown for that route.

## 5. Booking Lifecycle (State Machine)

`requested` → `offered` (sent to company's drivers) → `accepted` → `driver_arriving` → `arrived` → `in_progress` → `completed`

Exit states: `cancelled_by_rider`, `cancelled_by_driver`, `cancelled_by_company`, `expired` (nobody accepted), `no_show`, `disputed`.

Every change of state is saved with time, who did it and why. This history is what resolves disputes.

## 6. Database Design

**Recommended database:** MySQL 8.4 with InnoDB. It handles relations and transactions (important for money) and has built-in spatial types for zones. The full MySQL schema is in the separate document Ride Master: MySQL Database Design. The table list below follows it. If a column name here differs from the MySQL document, the MySQL document wins. Use **Redis** alongside it for live driver locations and ride-request timeouts.

### MySQL conventions

The complete SQL is in [Ride Master: MySQL Database Design](https://claude.ai/code/artifact/7fa996ea-f241-4d20-aa2f-474a6ef59d9c). The rules that shape every table below:

- **Engine and encoding:** InnoDB with utf8mb4, so Dhivehi (Thaana) text is stored correctly.
- **Ids:** each table has an internal BIGINT id and a public\_id (ULID). The API shows only public\_id, so ids cannot be guessed.
- **Money:** whole numbers in laari (1 MVR = 100 laari). Percentages are in basis points (10% = 1000). No decimals for money.
- **Time:** DATETIME(3) stored in UTC and shown in Maldives time.
- **Statuses:** VARCHAR fields with CHECK constraints, not ENUM, so they are easy to change later.
- **Zones:** spatial POLYGON columns with a spatial index. Live driver positions stay in Redis.
- **Rules the database enforces by itself:** one open assignment per vehicle and per driver, one active ride per driver, one booking per idempotency key, one commission charge per booking, one rating per booking, one booking per settlement line.
- **Foreign keys** are real constraints, and users, companies, drivers and vehicles are soft deleted.

### 6.1 Identity and Access

**users**: id, full\_name, phone (unique), email (optional), password\_hash and totp\_secret\_enc (admin only), status (active / suspended / deleted), language, last\_login\_at, deleted\_at, created\_at

**user\_roles**: id, user\_id, role (superadmin / company\_owner / driver / rider), company\_id (empty for rider and superadmin), admin\_level (super / verifier / support / finance, only for superadmin), status, created\_at. One user can hold several roles. An independent driver has two rows: company\_owner and driver, both for the same company.

**otp\_codes**: id, phone, code\_hash, purpose, expires\_at, attempts, used\_at

**sessions**: id, user\_id, refresh\_token\_hash, device\_info, expires\_at, revoked\_at

**user\_consents**: id, user\_id, document (terms, privacy policy, operator agreement), version, accepted\_at, ip\_address (proof of what each person agreed to and when)

**permissions** and **role\_permissions** (optional, later): only needed if the four admin levels turn out to be too limited.

### 6.2 Companies

**companies**: id, owner\_user\_id, type (company / individual), name, trade\_name, registration\_number, licence\_number, phone, email, logo\_key, status (pending / approved / rejected / suspended), commission\_override\_bps, balance\_limit\_laari, rating\_avg, approved\_by, approved\_at, created\_at

**company\_documents**: id, company\_id, type (licence, registration, insurance), file\_key, expiry\_date, verified\_by, verified\_at, status

**company\_service\_areas**: company\_id, area\_id (composite key). It replaces the old service\_areas list on companies.

**company\_staff** (optional): id, company\_id, user\_id, staff\_role (manager, dispatcher), so an owner can add managers.

### 6.3 Fleet and Drivers

**vehicle\_types**: id, name (standard car, van, 6-seater, luxury), seats, luggage\_capacity, sort\_order (managed by SuperAdmin so all companies use the same categories)

**vehicles**: id, company\_id, vehicle\_type\_id, plate\_number (unique), make, model, year, colour, insurance\_expiry, status (active / maintenance / retired)

**drivers**: id, user\_id, company\_id, licence\_number, licence\_expiry, id\_card\_number\_enc (encrypted), photo\_key, status (pending / active / suspended), rating\_avg, created\_at

**driver\_vehicle\_assignments**: id, driver\_id, vehicle\_id, assigned\_from, assigned\_to (a driver may share vehicles over shifts)

**driver\_status**: driver\_id, state (offline / online / on\_trip), current\_vehicle\_id, last\_lat, last\_lng, last\_seen\_at (this is hot data, mirror it in Redis)

### 6.4 Areas and Pricing

**areas**: id, name (Malé, Hulhumalé Phase 1, Phase 2, Villimalé, Airport), type, geometry (spatial polygon), active

**suggested\_fares**: id, from\_area\_id, to\_area\_id, vehicle\_type\_id, price\_laari (set by SuperAdmin; new operators and independent drivers accept these in one tap)

**fares**: id, company\_id, vehicle\_type\_id, from\_area\_id, to\_area\_id, price\_laari, valid\_from, valid\_to, active

**surcharges**: id, company\_id, name (night, airport, extra luggage), amount\_laari or percent\_bps, time\_from, time\_to, active

**fare\_history**: id, fare\_id, old\_price\_laari, new\_price\_laari, changed\_by, changed\_at (full price audit trail)

### 6.5 Bookings

**saved\_places**: id, user\_id, label, address, lat, lng

**bookings**: id, rider\_id, company\_id, driver\_id, vehicle\_id, vehicle\_type\_id, passengers, luggage\_count, pickup\_address, pickup\_lat, pickup\_lng, dropoff\_address, dropoff\_lat, dropoff\_lng, from\_area\_id, to\_area\_id, quoted\_price\_laari, final\_price\_laari, tax\_laari, commission\_bps, commission\_laari, idempotency\_key, payment\_method, payment\_status, status, requested\_at, accepted\_at, arrived\_at, started\_at, completed\_at, cancelled\_at, cancel\_reason, cancelled\_by

**booking\_offers**: id, booking\_id, driver\_id, sent\_at, response (accepted / declined / timeout), responded\_at

**booking\_status\_history**: id, booking\_id, from\_status, to\_status, changed\_by, note, created\_at

**booking\_locations** (optional): booking\_id, lat, lng, recorded\_at (breadcrumb trail for disputes)

### 6.6 Money

**commission\_rules**: id, scope (global / company), company\_id, percent\_bps, fixed\_fee\_laari, valid\_from, valid\_to

**payments**: id, booking\_id, method (cash / card / wallet), amount\_laari, status, provider\_reference, paid\_at

**settlement\_statements**: id, company\_id, period\_start, period\_end, total\_rides, gross\_laari, commission\_laari, net\_laari, status (open / issued / paid), issued\_at, paid\_at

**settlement\_lines**: id, statement\_id, booking\_id (unique), fare\_laari, commission\_laari

**refunds**: id, booking\_id, amount\_laari, reason, approved\_by, status, created\_at

**company\_ledger**: id, company\_id, type (top-up, commission charge, adjustment, payout), amount\_laari, balance\_after\_laari, booking\_id, created\_at. For cash rides, the commission is charged to this balance. A company may owe up to its balance limit, set by SuperAdmin (give new companies a small starting credit so their first rides are not blocked). Beyond that limit it stops receiving new requests until it tops up.

### 6.7 Trust, Support and System

**ratings**: id, booking\_id, rider\_id, driver\_id, company\_id, driver\_score, company\_score, comment, created\_at

**rider\_ratings**: id, booking\_id, driver\_id, rider\_id, score, comment, created\_at (drivers rate riders too, so repeat no-shows or abuse can lead to a warning or ban)

**complaints**: id, booking\_id, raised\_by, against\_type (driver / company / rider), category, description, status, resolution, resolved\_by, created\_at, resolved\_at

**notifications**: id, user\_id, channel (push / sms / in-app), title, body, read\_at, sent\_at

**audit\_logs**: id, actor\_user\_id, action, entity\_type, entity\_id, old\_value (JSON), new\_value (JSON), ip\_address, created\_at

**platform\_settings**: setting\_key, value as JSON (default commission, request timeout, search radius, cancellation window)

### 6.8 Relationship Summary

- One user can hold several roles through user\_roles. A company owner owns one company; a driver belongs to one company at a time. For an Individual operator, the owner and the driver are the same user.
- A company has many vehicles, drivers, fares and bookings.
- A booking belongs to one rider, one company, one driver, one vehicle.
- A settlement statement groups many completed bookings for one company.

**Indexes to add early:** bookings(rider\_id), bookings(company\_id, status), bookings(driver\_id), fares(from\_area\_id, to\_area\_id, vehicle\_type\_id, active), driver\_status(state), and a spatial index on areas.

## 7. Technical Architecture

- **Frontend:** Next.js (React), PWA enabled, Tailwind CSS. Mobile-first for rider and driver, desktop layout for company and admin.
- **Backend:** Node.js (NestJS or Express) or Django REST. REST API plus WebSockets.
- **Database:** MySQL 8.4 (InnoDB, utf8mb4), Redis for live state and queues.
- **Real-time:** WebSockets for new ride requests, driver location, booking status.
- **Maps:** Google Maps or Mapbox for maps, geocoding, distance and ETA.
- **Notifications:** Web push, plus SMS fallback for critical events (ride request, ride accepted).
- **SMS/OTP:** a provider that reaches Maldivian numbers reliably (check Dhiraagu / Ooredoo routes).
- **File storage:** S3-compatible storage for licences and photos, with private access.
- **Hosting:** a cloud server in the nearest region (Singapore or Mumbai), with daily database backups, monitoring and error tracking.
- **Environments:** development, staging, production.

**MySQL setup and operations:**

- **Hosting:** managed MySQL 8.4 (for example AWS RDS or DigitalOcean) with automatic daily snapshots and point-in-time recovery from the binary log.
- **Connections:** a pool of 10 to 20 connections per API instance; add ProxySQL when running several instances.
- **Concurrency:** booking and ledger changes use short READ COMMITTED transactions with retry on deadlock. Accepting a ride is one conditional UPDATE, so exactly one driver wins.
- **Live data:** Redis GEO holds driver positions and finds the nearest drivers. MySQL keeps only the last known position.
- **Scaling later:** add a read replica for admin reports and statements, and partition booking\_locations and audit\_logs by month once they are very large.
- **Retention:** a nightly job deletes old trip locations, OTP codes, expired sessions and old notifications in small batches.
- **Monitoring:** slow query log at 200 ms, reviewed weekly.

**Request flow for a search:** rider enters route → backend finds approved companies with online drivers → looks up each company's fare for that route and vehicle type → computes ETA from nearest online driver → returns a sorted list in one response.

## 8. Security and Privacy

- Phone OTP for riders, drivers and company owners; password plus 2FA for SuperAdmin. One active session per driver.
- HTTPS everywhere, hashed passwords and OTPs, rate limits on OTP and login.
- Role and company checks on every API endpoint.
- Private document storage with expiring links.
- Location data kept only as long as needed; riders see a driver's location only during an active ride.
- Share driver name, plate and photo with the rider only after acceptance; hide rider phone behind masked calling or in-app contact if possible.
- Audit logs for all admin and financial actions; backups tested by actually restoring.
- Follow Maldives data protection and consumer rules; get local legal advice.

**Database security (MySQL):**

- A dedicated database user with only the rights the app needs, never root.
- TLS between the app and the database, and encrypted disks and backups.
- Encrypt sensitive columns in the app (ID card numbers, 2FA secrets) and never log them.
- Strict SQL mode on every connection, and parameterised queries only.
- Separate database credentials for production, staging and development.

## 9. Roadmap

### Phase 0: Validation and Foundations (Weeks 1 to 4)

- Talk to 5 to 10 taxi companies, independent owner-drivers and drivers in Hulhumalé and Malé. Learn how they get bookings, how they price, what they fear.
- Confirm legal requirements: platform licensing, whether third-party bookings are allowed, taxes, payment rules.
- Get 2 to 3 companies to agree to a pilot (letter of intent).
- Decide commission model, cancellation rules and who handles complaints.
- Collect the real fare tables for the pilot corridor.
- Write the operator agreement and rider terms.
- Design wireframes for all four roles.

**Exit check:** at least 2 companies committed, legal path clear, fare data collected.

### Phase 1: MVP Build (Weeks 5 to 14)

**Timeline check:** 10 weeks assumes at least three developers working in parallel. With one developer plus an AI agent building phase by phase, plan for roughly 16 to 20 weeks and move the pilot and launch dates by the same amount.

**Sprint 1 (Weeks 5 to 6): Foundation**

- Project setup, authentication, roles and permissions, audit logging. Write the MySQL migrations (spatial columns, generated columns and CHECK constraints in raw SQL), seed the five zones and demo data, add a concurrency test for ride acceptance, and set up English and Dhivehi (right-to-left) support.

**Sprint 2 (Weeks 7 to 8): Company side and SuperAdmin**

- Company registration, document upload, SuperAdmin approval, vehicles, drivers, areas, fares. Include a quick signup path for independent drivers (company type Individual) and admin staff levels.

**Sprint 3 (Weeks 9 to 10): Driver side**

- Driver login, online/offline, live location, receive and accept requests, trip status buttons.

**Sprint 4 (Weeks 11 to 12): Rider side**

- OTP signup, route entry, company options list, booking, live status, cancel, history.

**Sprint 5 (Weeks 13 to 14): Money and polish**

- Cash payment flow, commission calculation and company ledger, settlement statements, ratings, complaints and refunds (handled manually by admin), notifications, document expiry job, admin KPI dashboard, Dhivehi translations, PWA install.

**MVP scope (in):** fixed fares, cash payment, 1 corridor, online drivers only, manual dispute handling. **MVP scope (out):** in-app card payments, scheduled rides, promo codes, multi-stop trips, native apps.

### Phase 2: Testing and Closed Pilot (Weeks 15 to 20)

- Internal testing with test accounts for every role.
- Test on real phones and real mobile networks (weak signal, switching between Wi-Fi and data).
- Security review, a load test, and a MySQL backup and restore drill.
- Pilot with 2 to 3 companies and 10 to 20 drivers, invited riders only.
- Daily check-ins with drivers, weekly with owners.
- Fix the top issues: lost requests, location drift, confusing screens.

**Exit check:** at least 90% of requests answered, completed rides without disputes, drivers still using it after 2 weeks.

### Phase 3: Public Launch (Weeks 21 to 26)

- Open to all riders on the corridor.
- Local marketing: QR posters at the ferry terminal, airport link, offices, social media, and in partner cars.
- Onboard more companies in Malé and Hulhumalé.
- Customer support channel (WhatsApp and phone) with a simple complaint process.
- Weekly review of KPIs.

### Phase 4: Growth (Months 7 to 12)

- Add routes: Villimalé, airport, Maafushi and other islands where road taxis operate.
- In-app payments (card, local wallets or bank link) and automatic settlement.
- Driver native app if web location tracking proves unreliable.
- Scheduled rides, airport pickup booking, saved places and favourites.
- Promo codes and referral rewards.
- Company analytics: busy hours, earnings, driver performance.
- API integration for larger companies that have their own systems.
- Dispatcher tools for companies (assign rides manually).

### Phase 5: Scale (Year 2)

- Other atolls, resorts and transfer services (boats and speedboats could become another category).
- Business accounts for hotels and offices.
- Dynamic ETAs and smarter matching.
- Native rider app if usage justifies it.

## 10. KPIs to Track

- **Supply:** companies approved, drivers online per hour, average vehicles available per area.
- **Demand:** searches, bookings, riders registered, repeat rate.
- **Quality:** request acceptance rate, average pickup ETA vs actual, cancellation rate, average rating.
- **Money:** gross fares, commission earned, average fare, settlement delays.
- **Trust:** complaints per 100 rides, resolution time.

## 11. Team and Rough Effort

Minimum team for the MVP:

- 1 full-stack lead developer
- 1 front-end developer (mobile-first UI)
- 1 back-end developer
- 1 designer (part-time)
- 1 product/operations person who signs up companies and handles support
- QA tester (part-time)

A solo founder with a developer can still do it, but expect the timeline to stretch. Get cost quotes locally and from remote freelancers before fixing a budget.

## 12. Risks and Fixes

| Risk | Why it matters | Fix |
| --- | --- | --- |
| Companies refuse to join | No supply, no product | Start with 2 to 3 friendly companies, show them extra bookings at no cost, keep their branding visible |
| Not enough drivers online | Riders see empty options | Start with one corridor, require a minimum online driver count before launch |
| Web location is unreliable | Drivers vanish from the map | Keep page open guidance, SMS fallback, plan a native driver app |
| Missed ride requests | Lost trust | Sound alerts, push plus SMS, auto-reassign to next driver |
| Companies bypass the platform | Lose commission | Make the platform valuable: payments, ratings, repeat riders, small commission |
| Price disputes | Complaints | Lock the price at booking, show it clearly, log changes |
| Fake or unlicensed operators | Safety and legal trouble | Manual approval, document expiry reminders |
| Legal and licensing | Could block launch | Resolve in Phase 0, get written confirmation |
| Weak internet | App feels broken | Light pages, retry logic, offline-friendly screens |
| Payment and cash leakage | Commission not collected | Monthly statements, deposit or prepaid balance for companies, suspension for late payment |

### Added in final review

- **Weak street addressing:** Google Maps knows few street names in Hulhumalé. Let riders drop a pin, pick saved places and landmarks, and choose the zone, so pickup does not depend on a typed address.
- **Redis is a single point of failure for availability:** use a managed Redis with a replica, and if it is down, fall back to the last\_seen time in driver\_status.
- **SMS cost and abuse:** OTP texts cost money and can be abused. Rate limit per number and per device, and set a daily SMS budget alert.
- **Shared driver accounts:** one active session per driver, and a new login signs the old device out.
- **Surcharge surprises:** the quoted price already includes surcharges, and the rider sees the total before booking.
- **Starting credit:** a new company with a zero balance and a zero limit would be blocked after its first cash ride, so set a small starting credit.
- **No budget yet:** this plan has no cost figures. Get quotes for development, managed MySQL and Redis, SMS and maps before committing.

## 13. Launch Checklist

- Legal and licensing confirmed in writing
- Operator agreement signed by every pilot company
- All four role interfaces tested end to end
- Role permission tests passed (a company cannot see another company's data)
- MySQL backups, point-in-time recovery and restore tested
- SMS/OTP delivery tested on Dhiraagu and Ooredoo numbers
- Support phone/WhatsApp and complaint process ready
- Privacy policy, terms of use and cancellation policy published
- Monitoring and error alerts on
- Driver training session done, with a one-page guide

## 14. Immediate Next Steps

1. Choose the pilot corridor (Hulhumalé to Malé) and list the companies to approach.
2. Confirm legal requirements with the relevant Maldivian authority.
3. Collect fare tables and fleet details from the first 2 to 3 companies.
4. Approve this plan and the database design, then wireframe the four interfaces.
5. Start Sprint 1.

## 15. Process Walkthrough and Review Findings

I walked the plan through seven journeys: company onboarding, independent driver onboarding, rider booking, a driver who never answers, a mid-ride cancellation, a dispute, and month-end settlement. Each journey exposed gaps, and the fixes are now in the sections above.

| Area | Gap found | Fix in the plan |
| --- | --- | --- |
| Independent drivers | No path for a driver with 1 or 2 cars and no company | Company type Individual, quick signup, "Independent" badge (sections 2, 3, 6.2) |
| Roles | One user could not be both owner and driver | user\_roles table replaces the single role column (6.1) |
| Admin team | Every SuperAdmin had full power | Admin levels: Super, Verifier, Support, Finance (section 3) |
| Availability | "Online" does not mean free; a driver on a trip still counted | Driver state: offline, online, on\_trip. Only online and idle counts (4, 6.3) |
| Booking race | Driver goes offline or two drivers accept at once | Re-check at booking, atomic accept, fall back to the next company (4) |
| Group size | Passengers and luggage were not captured | passengers and luggage\_count on bookings, filter by vehicle seats (6.5) |
| Missing fares | A company with no fare for a route would break search | No fare means not listed; SuperAdmin suggested fares for new operators (4, 6.4) |
| Cash commission | Cash rides let companies skip the commission | company\_ledger with a balance limit; low balance pauses new requests (6.6) |
| Rider behaviour | Drivers had no way to flag bad riders | rider\_ratings; repeated no-shows can lead to a warning or ban (6.7) |
| Legal proof | No record of who accepted the terms | user\_consents with version and time (6.1) |
| Expiring documents | Licences and insurance could lapse unnoticed | Daily job warns 30 days ahead and pauses on expiry (4) |
| Driver changes | A company could remove a driver mid-ride | Blocked until the trip ends; one active company per driver (4) |
| Language | Dhivehi speakers were not covered | English and Dhivehi (Thaana, right-to-left) from the MVP |
| Safety | No safety tools for riders | Share-trip link, SOS button that calls support, lost-item report |
| Connection loss | Weak signal during a ride could drop the trip | Trip continues; last known location kept; driver and rider can call each other |
| Phone numbers | Duplicate or badly formatted numbers | Normalise to +960 format; one account per number |
| Taxes | GST on fares and on the commission not handled | Store tax amount per booking; confirm treatment with an accountant before launch |
| Data retention | No rule for deleting old data | Keep ride records for the legal period; delete locations after a set time; let users request account deletion |

### MySQL-specific risks found

Moving to MySQL exposed a second set of traps, each already handled in the schema:

- **No partial indexes:** rules like one active ride per driver use generated columns with UNIQUE keys.
- **NULL breaks uniqueness:** user\_roles has a nullable company, so a generated key keeps it unique.
- **Inline foreign keys are ignored:** all foreign keys are written as table-level constraints.
- **Date limit:** TIMESTAMP stops at 2038, so DATETIME(3) in UTC is used.
- **Coordinate order:** spatial zones use one fixed order (longitude, latitude) to avoid swapped coordinates.
- **Double commission:** a unique key on the ledger blocks a second charge for the same booking.
- **Money rounding:** all amounts are integers in laari, never decimals.

### Still open: needs your decision

- Commission percentage, and whether individuals get a lower launch rate
- Whether the MVP accepts only cash, or cash plus a local payment option
- Maximum vehicles for an Individual account (3 suggested)
- The legal route to operate as a transport platform in the Maldives
- Who translates and checks the Dhivehi text
- The minimum number of online drivers needed before opening a route to riders
