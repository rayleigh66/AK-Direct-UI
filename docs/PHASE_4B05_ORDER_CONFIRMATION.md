# Phase 4B-05 — Order Confirmation, Pricing Approval, Reservation, Expiry and Release

Status: implementation for review. This document is the authoritative PRD for
Phase 4B-05. It records (a) the business contract confirmed by the Owner,
(b) conservative engineering choices made where the contract leaves an
implementation choice, (c) business assumptions that are **not** approved, and
(d) acceptance blockers. A technical recommendation is never a business
authorisation.

Baseline: `main` at `9d0d3bce992384e9fa93fb638ff3d619f4c4a3b4` (PR #20).
Feature branch: `feat/phase-4b05-order-confirmation`.

## 1. Confirmed business contract

These points are frozen for this phase. They must not be changed by
implementation convenience.

1. **Submission stays a request.** Customers keep using the Phase 4B-04 shared
   company cart. A submitted order is `PENDING_CONFIRMATION`, stores only a
   reference snapshot and reserves no stock. Order numbers for new orders use
   `OD-YYMMDD-NNNN`; historical `ODYYMMDDNNNN` numbers remain queryable,
   displayed and linked unchanged. Both formats share the same
   `ORDER_NUMBER_TIME_ZONE`, the same daily sequence table, the same
   `orders.order_no` UNIQUE constraint and the same 9999-exhaustion refusal.
   The old-format CHECK is widened by an additive migration; existing data is
   not rewritten.

2. **The current owner writes the complete plan.** The salesperson who is the
   company's **current** assignee and holds `sales.write` prepares the complete
   plan and may adjust each existing order line's quantity and final USD unit
   price. The submission reference and every plan version are retained. The
   existing SKU, brand, MOQ, eligibility and quantity bounds still apply.
   Changing a quantity creates a new plan version and requires fresh customer
   acceptance. **Every manual unit-price change, in either direction, requires
   business-administrator approval.** A quantity-only change is not a price
   change. A pending price change must not be washed away by a later
   quantity-only edit. A changed-price plan cannot be accepted by the customer
   until the price is approved. A rejected price change returns the plan to the
   salesperson for resubmission. No approval means no acceptable/confirmed
   changed price.

3. **Buyer confirmation is delegated by account.** A customer account
   explicitly designated inside the buyer company may log in, see the complete
   acceptable plan (every line's item, quantity, USD unit price, line amount and
   the total) and explicitly accept it. The customer may instead reject the
   plan and return it to the salesperson; this is a separate plan outcome, not
   an order cancellation. A business administrator or system administrator
   designates and revokes this authority. Ordinary salespeople, ordinary
   customer accounts and accounts of another company have no such authority.
   The record contains the company, account, authorization instance, plan
   version/digest, timestamp and result. A quantity or final-price change
   invalidates the previous acceptance. Revocation before formal confirmation
   invalidates the old acceptance; re-granting does not revive it. The current
   authorized account must accept again. A successful formal confirmation keeps
   the evidence of what was accepted.

4. **Formal confirmation is the current owner's write action.** Only the
   company's **current** assigned salesperson with `sales.write` may confirm.
   `sales.read_all`, system-administrator and business-administrator status
   alone do not bypass the write permission or the current-ownership check.
   Inside one transaction the service re-reads and locks the authorization and
   business state, verifies the order is still pending, the plan
   version/approval/acceptance match, the company and account are valid, and
   the goods/SKU/brand remain eligible. The salesperson supplies an explicit
   per-line SKU allocation across one or more warehouses; the per-line
   allocations must add up to the final quantity. Unknown/inactive warehouses,
   duplicate allocations, missing or extra SKUs and invalid quantities are
   rejected. Sellable stock is `on_hand - reserved - unsellable` per
   SKU+warehouse; if any warehouse is short the whole order fails. On success
   the same transaction freezes final quantity/unit price/line amount/total
   snapshots, writes each warehouse reservation and inventory movement,
   increments the corresponding `inventory_balances.reserved` and `version`,
   sets `CONFIRMED`, records the first confirmation and expiry timestamps, and
   writes history/audit/notification and the idempotent result.
   `on_hand`/`unsellable` do not change. Any failure rolls back everything,
   including an idempotent success row, audit and notifications.

5. **Reservation lifetime.** The confirmed 3 + 10 day rule is implemented as
   continuous hours: initial lifetime is 72 hours from first confirmation and
   at most 240 additional hours may be approved, giving a hard ceiling of 312
   hours from first confirmation. Extensions are approved by a
   business administrator (self-approval allowed) and approval+execution must
   be atomic, checking the old deadline, current reservation version and order
   state so concurrent approvals cannot exceed the ceiling. On expiry the
   reservation is marked overdue, the current salesperson and business
   administrators are reminded, and the exception remains outstanding with its
   stock still held. Expiry never auto-releases stock and never changes the
   order to `CANCELLED`. The order remains `CONFIRMED`; overdue is a separate
   reservation dimension.

6. **Full release / exception cancellation.** Releasing the whole order or
   exceptionally cancelling a confirmed order requires business-administrator
   approval (self-approval allowed). The request must state the reason and
   include a manual verification of payment and actual despatch: verifier,
   time, result and note. Any unknown/paid/shipped result, or stale status
   evidence, forbids the ordinary release path and cannot be bypassed by the
   exception cancellation. With no payment or fulfilment system, the request
   must explicitly verify **unpaid** and **not shipped**. A rejected approval
   changes neither order nor stock. On approval+execution the same transaction
   locks and verifies the same request, current order and valid reservation,
   reduces only `reserved` by the original SKU+warehouse details, increments
   inventory versions, records the release history, sets the whole order
   `CANCELLED` with cancellation time/reason, and writes audit/notification and
   the idempotent result. The customer can only submit a new order. Final
   transaction snapshots plus approval and acceptance history are retained.
   Legacy customer cancellation/quantity-change and legacy destructive admin
   actions cannot bypass this path. Partial release, payment/refund, shipment,
   WMS, automatic cross-warehouse allocation, promotion/tier pricing engines
   and external notification channels are **out of scope**.

## 2. Engineering choices (conservative, subject to acceptance)

These are implementation choices that satisfy the confirmed contract. They are
not new business authorisations.

### 2.1 Time

- All intervals are continuous UTC instants: `confirmed_at + 72h` and
  `confirmed_at + 312h`. Time comes from PostgreSQL, not the client or the
  application clock, in every transactional decision. Transactional code reads
  `clock_timestamp()` **after** its locks; confirmation anchors the deadline to
  the real database time at which the confirmation row is written.
- Extension adds the approved hours to the **old** `expires_at`, never resets
  the clock from the approval time.
- An already-overdue reservation may still be extended before the hard ceiling
  only when the resulting deadline is strictly after database `clock_timestamp()`.
- The Owner-confirmed rule is **3 days initial plus at most 10 additional days
  (13 days in total)**. It is implemented as continuous UTC hours from first
  confirmation: 72h initial, at most 240h additional and a 312h hard ceiling.
  Only the overdue-recovery semantics remain an Owner review item in §9.

### 2.2 Reservation representation

- `order_reservations` has one row per confirmed order and a
  `reservation_version`. `expires_at` is the current deadline and
  `hard_deadline_at` is first-confirmation + 312h.
- `order_reservation_lines` stores the immutable SKU+warehouse allocation.
- `inventory_balances.reserved` remains the aggregate held quantity.
  `inventory_movements` gains `reserve`/`release` types and
  `reserved_before`/`reserved_after`.
- A reservation whose `expires_at <= now()` is projected as expired even before
  the scanner writes `EXPIRED`; the UI never waits for a scan to show the true
  state. Stock remains reserved while the exception is open.
- Release is whole-order only and is based on the immutable reservation lines.

### 2.3 Expiry scan and reminders

- A recoverable Real-backend scan (`runExpiryScan` in
  `orders/reservationService.ts`) is callable by an authenticated internal
  operator through `POST /api/admin/order-approvals/expiry-scan` and runs
  periodically in the API process. It takes bounded batches, serialises
  concurrent scanners with a transaction-scoped PostgreSQL advisory lock (a
  competing scan returns an empty batch and retries on the next tick), re-reads
  the reservation under company -> order -> reservation row locks and uses
  database time. It only selects reservations whose `expires_at` is at or
  before `clock_timestamp()`; there is no pre-expiry reminder.
- `order_deadline_reminders` has a unique
  `(reservation_id, deadline_at, kind)` key. Inserting the reminder and queuing
  the notification happen in the same transaction. Repeated scans, restarts and
  multiple API instances therefore emit at most one reminder per real deadline.
  An extension changes `expires_at`, so the new deadline gets its own reminder.
  A pre-existing reminder row never suppresses the `EXPIRED` transition: the
  status change and stock hold remain authoritative, and the reminder insert is
  only an at-most-once outbox side effect. Expired reminders keep the stock held
  and the order `CONFIRMED`; they never auto-release or auto-cancel.
- Notifications stay in the existing `order_notifications` outbox. There is no
  external channel. At minimum the overdue state is visible in the Real
  internal order screen, and the notification targets the current salesperson
  and business administrators.

### 2.4 Roles and permissions

The existing roles are `admin`, `sales`, `sales_writer` and `auditor`. This
phase adds an explicit `business_admin` role and four permissions:

| Permission | Granted to | Meaning |
| --- | --- | --- |
| `orders.approve_price` | `business_admin` | Approve/reject a changed-price plan |
| `orders.approve_extension` | `business_admin` | Approve/reject a reservation extension and run the expiry scan |
| `orders.approve_release` | `business_admin` | Approve/reject a full release/exception cancellation |
| `orders.manage_confirmers` | `business_admin`, `admin` | Grant/revoke buyer-confirmation authorizations |

`business_admin` receives no general `sales.read_all` grant. The approval queue
and approval detail are exposed only through the explicit approval
permissions, and confirmer management uses the minimal
`buyer-confirmation-accounts` projection (company code, company short name and
customer account identifiers only). `admin` receives `orders.manage_confirmers`
only: it can manage confirmation accounts but has **no** automatic business
approval and no automatic sales write. `sales.read_all`, `accounts.manage` and
frontend menus never imply approval or confirmation. A business administrator
who also wants to propose a plan or confirm an order must separately hold
`sales.write` and be the current assignee.

Production initial grants are **pending Owner confirmation** (§9).

### 2.5 Authorization linearisation

- `buyer_confirmation_authorizations` rows are authorization instances. A grant
  inserts a new instance; revocation sets `status='revoked'` and never
  reactivates the row. Re-granting creates a new instance.
- Multiple accounts of one company may each be explicitly authorized. Whether
  the policy should cap this at one account is a business decision, not decided
  here (§9).
- Grant/revoke, account suspension, company suspension, sales reassignment,
  acceptance, confirmation, plan edit, extension, release and approval
  decisions all lock the company row (`FOR UPDATE`) first and then the
  order/authorization. Approval decisions do not require company ownership, but
  use the same company -> order path so no order -> company reverse lock exists.
- Revocation invalidates active acceptances tied to that authorization instance
  only for orders still `PENDING_CONFIRMATION`, and restores the current plan to
  `SUBMITTED` so another explicitly authorized account can accept the same plan.
  Confirmed orders keep their acceptance evidence. If revocation commits first,
  confirmation fails; if confirmation commits first, the completed transaction
  history remains.
- Confirmation never trusts `req.auth` alone, the frontend, or an
  out-of-transaction read: after its locks it re-reads the session, account,
  company, current assignee and exact current permission (including
  `sales.write`) inside the transaction.

### 2.6 Price approval fingerprint

- A plan's canonical **price fingerprint** covers the order id and the
  normalized SKU order with each line's reference unit price and final unit
  price. It is domain-separated and versioned.
- A plan whose final prices all equal the submission reference prices needs no
  price approval.
- A custom-price plan needs an `APPROVED` approval whose order, price epoch and
  fingerprint match exactly.
- `orders.price_epoch` increments whenever a plan's price fingerprint changes
  from the previous plan version (including changing back to reference prices).
  Quantity-only versions keep the same fingerprint and epoch. An approval is
  bound to its epoch, so a change-to-reference and change-back sequence cannot
  resurrect an old approval.
- If a plan edit changes the fingerprint while an approval is pending, the
  pending approval is superseded. If only quantities change, the pending
  approval survives and still blocks customer acceptance until decided.
- Approval decisions store both requester and decider (self-approval is two
  recorded roles on one person). Approvals reference the plan id/version at
  request time; the immutable plan snapshot is retained.
- A price decision may present either the approval's request-time plan version
  (what the queue shows) or the current plan version. The current plan must
  still match the approval's fingerprint and epoch, so a quantity-only edit
  cannot strand a pending approval, while a price change still makes it stale.
- Counterexamples covered by tests: raise price; lower price; quantity-only
  with an approved price; quantity-only with a pending price (must remain
  blocked); change price then revert to reference; approve a price then change
  a different line; return to a previously approved number after an intervening
  change; stale approval after a newer plan version.

### 2.7 Money

- USD integer cents everywhere. The service reuses
  `validateOrderQuantity`, `multiplyCents` and `sumCents`, and enforces
  positive, safe upper bounds. Clients cannot submit a total; the server
  recomputes line amounts and total. Negative, zero, fractional, over-precision,
  overflow and forged-total inputs are rejected.
- Additional discount or margin-threshold price policies are **not approved**;
  no Mock promotion is connected and no new pricing policy is invented.

### 2.8 Idempotency

- Every new state-changing order action carries an `idempotencyKey` and an
  expected order/plan/reservation precondition.
- `order_action_idempotency` binds operation + actor + key to order, company and
  a canonical payload digest. Same key + same input returns the first safe
  result. Same key + different content returns `409 idempotency_conflict`.
  Different actor/order/company cannot replay another actor's record and never
  reveals it.
- Replay lookup happens after the current transaction's session/permission
  checks and, for buyer actions, after the active authorization-instance check.
  It runs before revision/state checks, so a legitimate retry of a completed
  confirmation returns the original result, while a revoked or re-granted
  account cannot replay an old acceptance/confirmation key.
- Idempotency records for buyer actions bind the authorization instance id as
  well as operation + actor + order + company. Re-granting creates a new
  instance, so the old key stays invalid.
- A failed action (including a rollback after an inventory failure) leaves no
  idempotency row, audit row or notification.
- Inventory shortage and transient transaction failures are safe to retry.

### 2.9 Lock order

The canonical order is:

```
company -> order -> buyer authorization -> plan/approval -> inventory (SKU, warehouse sorted) -> history/notification/audit
```

- Submission keeps its existing company -> product -> SKU path.
- Destructive catalogue actions keep company -> product/SKU -> pending orders.
- Confirmation is the one order write that re-reads catalogue state. Because the
  catalogue destructive path locks product/SKU before orders, confirmation
  takes the product and SKU `FOR SHARE` locks before the order row, then follows
  company -> order -> authorization -> plan/approval -> inventory. It never
  takes `FOR SHARE` on immutable `order_plan_lines`, which the runtime role
  intentionally cannot lock.
- Approval decisions lock company -> order but do not require company ownership.
- Inventory import/adjustment locks balances by stable SKU+warehouse order;
  confirmation/release use the same order, so batch inventory writes and
  reservations cannot deadlock.
- Product/SKU/brand/company suspension or revocation is still allowed when a
  confirmed reservation exists: the action does not silently release stock or
  cancel the order. It records a `CONFIRMED_RESERVATIONS_AFFECTED` audit entry
  and notifies business administrators with `CONFIRMED_RESERVATION_EXCEPTION`
  so the exception is handled through the approved release path. Warehouse
  deactivation remains blocked with `409 confirmed_orders_affected` because
  existing reservation lines still point at that warehouse.

### 2.10 Order-number compatibility

- New numbers are generated as `OD-YYMMDD-NNNN`; the sequence table and
  business time zone are unchanged.
- Migration 007 widens the CHECK to accept both
  `OD[0-9]{10}` and `OD-[0-9]{6}-[0-9]{4}` and keeps the UNIQUE constraint.
  Existing rows are not rewritten.
- Lookup is by internal UUID plus display of the stored string, so old numbers
  keep working everywhere (list, detail, drawer, history, export).

### 2.11 API surface

All routes require a real session, changed initial password and CSRF on unsafe
methods. Errors keep the existing envelope
`{ "error": { "code", "message" }, ...details }`.

Customer:

| Method | Path | Body / result |
| --- | --- | --- |
| GET | `/api/orders` | Company orders with current plan, acceptance state and reservation projection |
| GET | `/api/orders/:id` | Company-scoped detail |
| POST | `/api/orders/:id/plan-decision` | `{ expectedRevision, expectedPlanVersion, planDigest, outcome: "ACCEPTED"\|"REJECTED", reason?, idempotencyKey }` |
| PATCH | `/api/orders/:id/lines` | Preserved 4B-04 path when no plan is active; `409 active_plan_exists` once a plan exists |
| POST | `/api/orders/:id/cancel` | Preserved 4B-04 path. A pending order with a plan can still be cancelled; the current plan/acceptance and any pending price approval are superseded/invalidated atomically. A confirmed order returns `409 order_status_conflict`. |

Sales (internal + `sales.write` + current assignee):

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/sales/orders` | Assigned orders |
| GET | `/api/sales/orders/:id` | Assigned order detail |
| POST | `/api/sales/orders/:id/plans` | `{ expectedRevision, expectedPlanVersion, lines: [{ skuId, quantity, unitPriceCents }], idempotencyKey }` |
| POST | `/api/sales/orders/:id/confirm` | `{ expectedRevision, expectedPlanVersion, planDigest, acceptanceId, allocations: [{ skuId, warehouseId, quantity }], idempotencyKey }` |
| POST | `/api/sales/orders/:id/extension-requests` | `{ expectedRevision, expectedReservationVersion, additionalHours, reason, idempotencyKey }` |
| POST | `/api/sales/orders/:id/release-requests` | `{ expectedRevision, expectedReservationVersion, reason, paymentVerification: "unpaid", shipmentVerification: "not_shipped", verificationNote, idempotencyKey }` |

Approvals (explicit approval permissions):

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/admin/order-approvals?type=price\|extension\|release&status=PENDING` | Scoped queue |
| GET | `/api/admin/order-approvals/:type/:id` | Request + immutable plan/acceptance/reservation evidence |
| POST | `/api/admin/order-approvals/price/:id/decision` | `{ decision, note?, expectedPlanVersion, idempotencyKey }` |
| POST | `/api/admin/order-approvals/extension/:id/decision` | `{ decision, note?, expectedReservationVersion, idempotencyKey }` |
| POST | `/api/admin/order-approvals/release/:id/decision` | `{ decision, note?, expectedReservationVersion, idempotencyKey }` |
| POST | `/api/admin/order-approvals/expiry-scan` | Bounded `{ limit? }` scan; safe to repeat |
| GET | `/api/admin/order-approvals/reconciliation` | `reserved` vs active/expired reservation-line reconciliation |

Confirmation-account management (`orders.manage_confirmers`):

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/admin/buyer-confirmation-accounts` | Minimal company/account projection for the grant form; no general sales read |
| GET | `/api/admin/companies/:id/buyer-authorizations` | All instances for a company, with account labels |
| POST | `/api/admin/companies/:id/buyer-authorizations` | `{ customerUserId, idempotencyKey }` — creates a new instance |
| POST | `/api/admin/buyer-authorizations/:id/revoke` | `{ reason?, idempotencyKey }` |

All unsafe routes on the customer, sales, admin and approval routers use the
router-level double-submit CSRF check. Integration tests probe every new write
entry point without the header (`403 csrf_failed`) and exercise cross-company
order writes (foreign salesperson and foreign customer account return
`404 order_not_found` without disclosing ownership).

### 2.12 Privacy projection

- Customer DTOs contain the acceptable plan lines and total, the plan/acceptance
  result, the final confirmed snapshot and the reservation deadline/status.
  They never contain internal approver identities/notes, warehouse allocation,
  other accounts, sales notes or audit data. The internal release reason and
  manual verification note stay on the internal request/reservation evidence;
  the customer sees only a generic cancelled-after-release reason and note.
- Internal DTOs expose allocation and approval evidence only to an authorized
  internal session; the approval queue is permission-gated.
- Rejection reasons follow the existing privacy filter.

### 2.13 UI (Real mode only)

- Customer: view the complete plan, accept or reject, see pending price
  approval, see rejection/return-to-sales, see confirmed final total and
  reservation deadline/overdue with date **and time**, and see the final
  cancelled state. The reject action remains available while a price change is
  pending; only acceptance is blocked. Existing English customer copy is
  preserved.
- Sales: build/update a plan with per-line quantity and USD unit price, see
  conflicts, request/execute confirmation with per-line warehouse allocation,
  request an extension (reason required), and request whole-order release with
  explicit checkboxes confirming the manual verification of unpaid and
  not-shipped status plus a required verification note. Server errors are
  preserved and rendered inside the active drawer.
- Business administrator: approvals queue and detail, approve/reject with
  recorded notes (decided requests are read-only), run/observe the overdue scan
  with scanned/expired/reminded/skipped counts, and grant/revoke buyer
  confirmation authority. System administrator can grant/revoke authority but
  cannot approve or confirm through that alone.
- The existing `SideDrawer`, V1 order detail, Real i18n, CSRF-aware API client,
  mobile layout and duplicate-submit guards are reused. No second order page,
  no Mock interaction change.

## 3. Migration 007

`apps/api/migrations/007_order_confirmation.sql` is additive. `001`–`006` stay
byte-identical. It:

- inserts the `business_admin` role and the four permissions/grants;
- widens the order-number CHECK and keeps UNIQUE;
- adds order confirmation/current-plan/price-epoch/final-snapshot columns;
- adds `order_plans`, `order_plan_lines`, `order_price_approvals`,
  `buyer_confirmation_authorizations`, `order_plan_acceptances`,
  `order_reservations`, `order_reservation_lines`, `order_final_lines`,
  `order_confirmations`, `order_extension_requests`, `order_release_requests`,
  `order_deadline_reminders` and `order_action_idempotency`;
- extends `order_status_history` and `order_notifications` event vocabularies;
- extends `inventory_movements` with `reserve`/`release` and
  `reserved_before`;
- adds indexes, foreign keys, composite uniqueness, active-row partial
  uniqueness and bounded checks, including the database invariant
  `hard_deadline_at = confirmed_at + interval '312 hours'` and
  `expires_at <= hard_deadline_at` on `order_reservations`;
- adds `order_reservation_ledger` and the two narrow `SECURITY DEFINER`
  functions below, with fixed `search_path` and `EXECUTE` revoked from `PUBLIC`;
- sets `schema_version='4b05'`.

`readiness.ts` requires `007_order_confirmation.sql`.
`provision-runtime-role.ts` grants only what the API commands need: SELECT and
row INSERT/UPDATE on the new tables, no DELETE, SELECT-only on
`order_reservation_ledger`, and `EXECUTE` on the two narrow reservation
functions. `order_release_requests` receives a column-restricted INSERT grant
that excludes `status`, the `decided_*` columns and `executed_at`, so the API
role cannot insert an already-approved release request that the release bridge
would accept. It deliberately does **not** grant generic `UPDATE` on
`inventory_balances.reserved` or on the `reserved` column, and it does not grant
`FOR SHARE` access to immutable `order_plan_lines`. There is no generic "retain
quantity" or "permission catalogue self-write" API. Inventory
adjustment/import may only change the original `on_hand`/`unsellable` fields
and must keep `on_hand >= reserved + unsellable`.

Reservation accounting is therefore enforced in SQL rather than by
table-wide application updates:

- `aoking_reserve_inventory(...)` checks the reservation is `ACTIVE`, the
  reservation line belongs to the order, the expected inventory version and
  reserved value still match, and sellable stock is sufficient. It inserts one
  ledger row per line/action with
  `ON CONFLICT (reservation_line_id, action) DO NOTHING`; a second application
  raises `reservation_already_applied` without changing `reserved`. It then
  updates `reserved` and `version` once.
- `aoking_release_inventory(...)` accepts the release request id, verifies the
  same order has an `APPROVED` release request that was executed, verifies the
  reservation is `ACTIVE` or `EXPIRED`, checks version/reserved, inserts exactly
  one `release` ledger row per reservation line and reduces `reserved` once.
  An unapproved, wrong-order, replayed or already-released call fails
  (`release_not_approved` / `reservation_already_released`) without touching
  stock.
- `order_reservation_ledger` is insert-only for the application role and makes
  double reserve/release observable and impossible to post twice.

## 4. Upgrade, rollback and reconciliation

- Upgrade rehearsal starts from a 006 database containing historical
  `ODYYMMDDNNNN` orders, inventory rows, pending notifications and an import
  result, applies 007 twice, and checks that old numbers/orders/outbox rows are
  unchanged and the second run is a no-op.
- There is no automatic downgrade. Rolling the code back while 4B-05 orders
  exist leaves new tables, reservations and `reserved` stock in place; the old
  code must not be used to release them. A manual, audited forward fix is
  required. No automatic release, auto-cancel or destructive SQL is provided.
- Reconciliation query: for every SKU+warehouse, compare
  `inventory_balances.reserved` with the sum of reservation lines whose
  reservation status is `ACTIVE` or `EXPIRED`, together with
  `inventory_movements` `reserve`/`release` deltas and versions. Any difference
  is a P0 incident.

## 5. Test plan (counterexamples first)

- Order numbers: old format before/after migration, lookup/drawer/history,
  same-day old→new shared sequence, midnight time zone, 9999 exhaustion,
  concurrent submits, old idempotent replay.
- Plans/prices: reference snapshot retained; quantity-only; every price
  direction requires approval; self-approval records both roles; rejected
  approval produces no deal; acceptance blocked while pending; stale
  plan/approval/acceptance cannot be reused; quantity/price change invalidates
  acceptance; price-fingerprint boundaries and revert counterexamples;
  negative/zero/fractional/overflow/forged-total inputs.
- Authorization/security: 401/CSRF on every new write entry/first-login
  password change; cross-company IDs for customer acceptance and salesperson
  plan/confirm/extension/release; non-designated sub-account; cross-company
  designation; ordinary `sales`; `sales.read_all`/`admin`/`business_admin`
  without write/ownership; revoked replay; reassignment and suspension;
  customer DTO privacy; runtime DB role completes the whole business flow and is
  denied forbidden SQL.
- Concurrency (separate connections, deterministic barriers): revoke vs
  accept/confirm in both orders; revoke then re-grant still requires
  acceptance; reassignment vs confirm; approval vs plan edit; legacy customer
  quantity/cancel vs confirm; destructive catalogue/company change vs confirm;
  double confirm; two companies' accepted orders queued on the same
  `inventory_balances` row (an external connection holds the row lock, both
  confirmations block on `pg_blocking_pids`, then exactly one succeeds and the
  other returns `409 insufficient_stock` with no reservation, ledger, success
  audit or `CONFIRMED` history); inventory adjustment/import vs allocation;
  expiry scan vs extension/release; duplicate release with same and different
  keys.
- Warehouse: cross-warehouse SKU, allocation sum, unknown/inactive warehouse,
  shortage rolls back the whole order, no negative stock, reserve/release only
  touches `reserved` and metadata, version bump invalidates stale previews,
  reconciliation by SKU+warehouse, historical traceability.
- Deadlines: 72h/240h/312h boundaries, DST, expiry and overdue non-sellability,
  repeated/restarted/concurrent reminders, new window after extension, rejected
  or stale approval side-effect-free, verification unknown/paid/shipped blocks,
  release and cancellation in one commit, duplicate release does not
  double-deduct, cancellation cannot be reopened, customer can submit a new
  order.
- Real E2E: submission → buyer-authority grant/revoke/re-grant through the
  business-admin UI → price approval → buyer acceptance → two-warehouse
  confirmation → extension request (drawer-visible success feedback) →
  exception release (drawer-visible success feedback) → customer sees
  cancellation, plus ordinary-customer and revocation scenarios, at
  `real-desktop-1440` and `real-mobile-390`, using real login, database and API.
  The new spec owns its customer company/account (first-login password change
  cannot disturb the older suite). Existing Mock/Real suites continue to run.
- Commands aligned with CI: `npm ci`, `npm run lint`, `npm test`,
  `npm run build`, `npm run verify:assets`, `npm run api:lint`, `npm run
  api:build`, `npm run api:test`, isolated-PostgreSQL `npm run api:test:db`,
  `npm run test:e2e`, `npm run test:e2e:preview`, Real scripts, Compose
  config/smoke and `git diff --check`.

## 6. Acceptance matrix (evidence)

| Area | Required evidence |
| --- | --- |
| Migration | 006 fixture applies 007 twice; old orders/outbox intact |
| Order numbers | old/new lookup, shared sequence, 9999, midnight, concurrency |
| Plan/price | approval matrix, epoch/fingerprint counterexamples, acceptance invalidation |
| Authorization | grant/revoke/re-grant, linearisation, suspension, privacy |
| Confirmation | allocation validation, all-or-nothing reservation, final snapshot |
| Concurrency | deterministic barriers and final table/inventory assertions |
| Warehouse | reconciliation query, version bump, no negative stock |
| Deadline | boundary instants, reminders idempotent, extension/release races |
| Release | verification gate, whole-order release, no double deduct, no reopen |
| Runtime role | full flow under least privilege and forbidden-SQL denials |
| UI | Real desktop/mobile flows and existing suites |
| Delivery | final head SHA, CI run, Draft PR, known blockers |

## 7. Explicit non-goals

Partial release, payment recording/refund, shipment, WMS, automatic
cross-warehouse allocation, promotion/tier pricing engines, external
notification channels, a second order page, Mock behaviour changes, production
deployment, production database/Compose use, secret reads and merge automation.

## 8. Operational notes

- Buyer-confirmation authority is managed per account; revoke on suspension.
- Expiry scan is idempotent and bounded; alert on reconciliation mismatch.
- Release requires explicit unpaid/not-shipped verification. If status evidence
  is unknown, do not release; escalate.
- Never "fix" stuck stock with ad-hoc SQL. Use the audited release path or a
  forward migration reviewed by the Owner.

## 9. Pending business approval / acceptance blockers

These items are **not** approved business rules. Until decided they remain
acceptance blockers for production, not implementation blockers for this
review branch.

1. Overdue-recovery semantics only. The durations are already confirmed by the
   Owner as 3 days initial plus at most 10 additional days (13 days total) and
   are implemented as 72h initial, 240h maximum extra and a 312h hard ceiling
   of continuous hours from first confirmation.
2. Whether buyer-confirmation authority must be capped at one account per
   company (implementation currently allows explicit per-account grants).
3. The production list of initial `business_admin` users and any additional
   `sales.write` grants for them.
4. Price policy beyond "any manual change needs approval": discounts, margin
   thresholds, rounding beyond integer cents, promotion/tier sources.
5. Destructive product/brand/company policy once reservations exist
   (implementation allows the action, keeps stock reserved, audits
   `CONFIRMED_RESERVATIONS_AFFECTED` and alerts business administrators;
   warehouse deactivation remains blocked until release).
6. External notification channels (implementation stays on the internal
   outbox).

## 10. Acceptance status

Implementation status and measured evidence are recorded in
`docs/PHASE_4B05_ACCEPTANCE.md`. A green local/CI run does not remove the
business decisions in §9.
