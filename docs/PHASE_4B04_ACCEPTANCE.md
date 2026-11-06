# Phase 4B-04 Acceptance Report

**Branch:** `feat/cart-orders-4b04`
**Base:** `feat/catalog-inventory-4b03` (Phase 4B-03, PR #9, `a281e15ff05b71e23daa233ab3c3bbd2eea4cf00`)
**PR:** stacked Draft PR against `feat/catalog-inventory-4b03` (URL, exact Head SHA and CI links are recorded in the PR body)
**Scope:** company shared cart, customer order submission, reference pricing, order numbers, customer/internal order views, pending-order changes/cancellation, administrator impact linkage and the two Phase 4B-03 inventory-import P1 fixes. No confirmation, reservation, payment, shipment, WMS, promotions or Phase 3C changes.

## 1. Delivered

| Area | Result |
| --- | --- |
| Schema | Additive migrations `005_cart_orders.sql` and `006_sales_reassignment.sql` (001–005 untouched) |
| Cart | One company cart, monotonic revision, shared by all sub-accounts, PostgreSQL persistence, server eligibility/stock checks |
| Orders | Atomic submission, server-recomputed integer-cent reference amounts, `OD + YYMMDD + daily sequence`, immutable snapshots |
| Idempotency | Company + actor + key + canonical payload digest |
| Statuses | Only `PENDING_CONFIRMATION` and `CANCELLED` written; future statuses exist in `order_statuses` only |
| Customer orders | List/detail, pending quantity changes, cancellation, history; company-scoped |
| Internal orders | Assigned-sales data scope, administrator supervision, read-only; confirmation disabled in UI |
| Admin linkage | Impact preview/token, transactionally revalidated cancellation for unpublish/discontinue/revoke/suspend |
| P1 fixes | Import idempotency binding + immutable committed-result snapshot |
| DB roles | Runtime grants for cart/order tables; column-level `UPDATE` only on `order_items.quantity`/`line_reference_cents`; no `reserved` write |
| React | Real customer catalogue→cart→checkout→orders, sales pending orders, admin supervision and impact dialog; Mock unchanged |

Not implemented: order confirmation, final tier/promotion pricing, stock reservation, payment, shipment, WMS, automatic deployment, FactoryOS3.

## 2. Migration and schema

`005_cart_orders.sql` adds `order_statuses`, `company_carts`, `cart_items`, `order_sequences`, `orders`, `order_items`, `order_idempotency`, `order_status_history`, `order_notifications` and `inventory_import_commit_results`, plus `inventory_import_batches.payload_digest`.

`006_sales_reassignment.sql` adds the `cancelled` notification status and `cancelled_at`, and cancels pending sales notifications addressed to a former company owner. `schema_version` is `4b04.1`; readiness requires `006_sales_reassignment.sql`.

Guards include: unique order numbers, unique company/SKU cart lines, quantity 10–1,000,000, positive bounded cent amounts, `line_reference_cents = reference_unit_price_cents × quantity`, cancellation timestamp ↔ `CANCELLED`, one daily sequence row per date, and foreign keys to company/user/product/SKU/warehouse/order. `schema_version` becomes `4b04.1`; readiness requires `006_sales_reassignment.sql`.

Order-number date basis is `ORDER_NUMBER_TIME_ZONE` (default `UTC`), validated at startup. Daily sequences are allocated with `INSERT … ON CONFLICT … UPDATE … RETURNING`; numbers are never reused and are not derived from a random value.

## 3. API contract and permissions

The full contract and permission matrix are in [Phase 4B-04 Cart & Orders](PHASE_4B04_CART_ORDERS.md#3-api-contract).

- Every write requires authentication, a changed initial password, server-side RBAC and CSRF.
- Customers are always scoped by `auth.user.companyId`; no request field can select another company.
- Sales see only orders whose customer company currently has `assigned_sales_user_id = auth.user.id` (a database join, not the order snapshot), unless they also hold `sales.read_all`. A former owner receives 404 on direct detail; the current owner sees existing orders.
- Administrators use `sales.read_all` for supervision; no order write route exists for administrators or sales in this phase.
- Customer DTOs omit company/internal IDs, assigned salesperson, internal notes, audit data, submitter identity and employee permissions; the integration suite asserts these fields are absent.
- All cart/order responses set `Cache-Control: no-store`.

## 4. Concurrency and atomicity evidence

PostgreSQL integration tests use separate HTTP sessions through the real Express app.

| Scenario | Evidence |
| --- | --- |
| A/B/C share one company cart; another company isolated | Same revision/items across A/B/C; company B starts at revision 1; no company ID in the customer cart DTO |
| Concurrent cart edits | One 200, one `409 cart_version_conflict` with the latest cart; retry with the new revision succeeds |
| Repeated set does not accumulate | Setting 15 twice leaves 15, not 30 |
| Cart remove/clear revision guard | Stale revision 409; correct revision removes/clears |
| Cart persistence | Row survives logout/new login and container restart; E2E proves a second sub-account sees the first account's cart |
| Submit revalidation | MOQ < 10 rejected at cart boundary; unpublished product, discontinued SKU, revoked brand and insufficient stock rejected server-side; cart/draft preserved |
| Duplicate submission | Same key + payload returns the same order (`alreadySubmitted: true`); different payload → `idempotency_conflict`; a different key after success → `cart_empty` |
| Concurrent same-key retry | Two simultaneous submissions → one 201 + one 200, same order ID, one order row |
| Two sub-accounts submit one cart | Exactly one 201 and one 409; order count increases by one; cart cleared |
| Daily order numbers | Four simultaneous companies → four distinct `OD…` numbers matching `^OD[0-9]{10}$` |
| Reference amount snapshot | Base 4200 × 10 = 42000; admin changes base to 5000; order line still 4200 and modify keeps 4200 |
| No reservation | `SUM(reserved)` remains 0 after submission and import commit |
| Admin action races | 4 rounds each of unpublish-vs-submit and suspend-vs-submit: either the admin action is rejected with `pending_orders_affected` and a pending order exists, or the admin action succeeds and no pending order exists. No state with an unpublished product/suspended company plus a live pending order was observed |
| Runtime role | Cart + submission + order modification through `aoking_runtime`; DDL, `DELETE FROM orders`, `DELETE FROM order_items` and `reserved` updates denied |
| Restart persistence | Isolated `db` + `api` restart: order count and latest order number unchanged; `/api/ready` 200 |

## 5. Administrator impact linkage

Integration tests prove, for each of product unpublish, SKU discontinuation, brand revoke and company suspension:

1. Without confirmation the mutation is rejected with `pending_orders_affected` and the affected order list; the product/SKU/grant/company and orders are unchanged.
2. A preview token becomes stale when a second pending order is added; the old token returns `impact_changed` and changes nothing.
3. A fresh preview + confirmation commits the destructive change and cancels every affected order in the same transaction.
4. Each cancelled order gets `ADMIN_CANCELLED` history, an audit row, and `pending` customer + assigned-sales notification rows (4 rows for two orders).
5. Suspended company sessions are revoked; reactivation is explicit.

The React admin catalogue shows the impact dialog and requires explicit confirmation for unpublish/discontinue. Brand and company administration remain API/admin-channel operations in the existing workspace; their backend enforcement is covered by tests.

## 6. Pricing evidence

- Every order is marked `pricingMode: base_reference`, `pricingVersion: 4b04-base-price-v1`, `isReferenceQuote: true`, with a customer-visible note that final tier/promotion pricing and confirmation happen in Phase 4B-05.
- Line snapshots store product code/title, SKU code, colour, quantity, base unit price, reference unit price and line reference cents.
- Client-supplied totals/prices/company/salesperson are ignored (the routes only read delivery fields + cart revision + idempotency key).
- Zero/negative or unsafe cent totals cannot be stored (`reference_total_cents > 0` and bounded; `sumCents`/`multiplyCents` guards).
- No new SKU permanent price, tier rule or promotion was created.

## 6a. P0-01 — sales ownership follows the current company assignment

- `orders.assigned_sales_user_id` remains the immutable submission-time snapshot.
- `/api/sales/orders` and `/api/sales/orders/:id` now authorize through `customer_companies.assigned_sales_user_id` (SQL join/condition), so a former owner gets an empty list and 404 on direct detail; the new owner sees existing pending orders; `sales.read_all` supervision is unchanged.
- Internal DTOs expose both the snapshot and `currentAssignedSalesUserId`.
- Change/cancellation/administrative-cancellation notifications resolve the current assignee under a shared company lock; the assignment transaction locks the company and marks stale pending sales notifications `cancelled` with `cancelled_at`. A future sender must only process `pending` rows.
- Destructive catalogue/company actions lock affected customer companies before their product/order locks, matching submission's company → product → SKU → order lock order, so the added assignment check cannot introduce a lock-order deadlock.
- Integration test: company assigned A → order → reassignment to B → A list empty/404, B list/detail 200, admin 200, snapshot unchanged; A's unsent submission notification is cancelled; post-reassignment modify, customer cancellation and administrative cancellation create pending rows only for B; unassignment removes B's access, leaves customer/admin access intact, and cancels B's remaining pending sales rows.
- Runtime-role test also performs a sales reassignment, exercising the column-level notification `UPDATE` grant.

## 7. Phase 4B-03 P1 fixes

| P1 | Evidence |
| --- | --- |
| A — idempotency binding | Same actor + canonical payload (including reordered JSON keys / whitespace) returns the same batch; different source/rows → 409; second actor with the same key → 409 without batch data; two concurrent same-key previews → both 201, one batch row |
| B — committed result snapshot | After commit (30/1, version 2), inventory adjusted to 50/version 3, repeated commit still returns 30/1/version 2; result row persisted; movements remain 1; `reserved` stays 0; legacy committed batch without a snapshot is reconstructed from its immutable preview rows |

## 8. React real mode

- Customer: catalogue detail adds/updates a SKU in the company shared cart; header badge shows line count and pieces; cart page supports plus/minus/manual quantity, remove, clear, invalid-line messages, delivery form with privacy check, server reference total, confirmation modal and success page with the real order number/pieces/reference total; orders page supports details, pending quantity changes and cancellation; delivery draft is local-only and kept on failure.
- Sales: assigned pending orders with detail and a disabled “available in Phase 4B-05” confirmation button.
- Admin: read-only order supervision; impact dialog for product unpublish and SKU discontinuation.
- The default Mock app and its Playwright suite are unchanged.

## 9. Test results (local, final code)

| Command | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm test` | **18 files, 101 passed** (Mock suite + new API validation unit tests) |
| `npm run build` / `npm run verify:assets` | PASS |
| `npm run api:lint` / `npm run api:build` | PASS |
| `npm run api:test` | **6 files, 25 passed** |
| `npm run api:test:db` | **5 files, 58 passed** — infrastructure 6, auth/RBAC 13, catalogue/inventory 19, cart/orders 16, import P1 4 |
| `npm run test:e2e` | **90 passed / 18 skipped** |
| `npm run test:e2e:preview` | **1 passed** |
| `bash scripts/test-smoke-isolation.sh` | PASS — 6 migrations, runtime role, backup/restore, media marker, readiness |
| `bash scripts/test-media-restore.sh` | PASS — archive negatives + live API stop/rollback/restart/health cases |
| `bash scripts/real-auth-e2e.sh` (isolated Compose project) | **4 passed** — catalogue + orders, desktop 1440 and mobile 390 |
| Restart persistence | PASS — order count unchanged after isolated `db`/`api` restart; `/api/ready` 200 |

### Real-mode Playwright path

`scripts/real-auth-e2e.sh` creates a fresh admin, a real salesperson, catalogue-flow customers, and dedicated order-flow companies with a second sub-account each. It then runs:

1. admin UI creates warehouse/product/image/SKU/publishes/registers stock;
2. customer A adds 10 PCS; customer B sees the shared cart and changes it to 12;
3. customer A submits with delivery fields and confirms the modal; the success page displays a real `OD…` number, 12 PCS and `$504.00`;
4. customer B sees the company order, changes the quantity to 14 (`$588.00`) and later cancels it;
5. the assigned salesperson sees the pending order and the disabled Phase 4B-05 confirmation button.

Layout is asserted with no horizontal overflow at 375, 390, 430, 768 and 1440 px; mobile 390 and desktop 1440 screenshots are stored in `docs/ui-review/real-orders/`. The internal detail now shows the current salesperson (access scope) alongside the submission-time audit snapshot.

## 10. Screenshots

`docs/ui-review/real-orders/`:

- `shared-cart-real-desktop-1440.png`, `shared-cart-real-mobile-390.png`, `shared-cart-375.png`, `shared-cart-430.png`, `shared-cart-768.png`
- `order-success-real-desktop-1440.png`, `order-success-real-mobile-390.png`
- `customer-orders-real-desktop-1440.png`, `customer-orders-real-mobile-390.png`
- `customer-orders-cancelled-real-desktop-1440.png`, `customer-orders-cancelled-real-mobile-390.png`
- `sales-pending-orders-real-desktop-1440.png`, `sales-pending-orders-real-mobile-390.png`

Updated real-catalogue screenshots in `docs/ui-review/real-catalog/` now show the add-to-cart SKU rows.

## 11. PASS / FAIL / NOT RUN

- **PASS:** all local commands above; isolated Compose smoke; media restore; real-auth E2E; responsive overflow checks; restart persistence; runtime-role cart/order/modify checks; admin race tests.
- **FAIL:** none in the final local run.
- **NOT RUN:** Ubuntu 24.04 target hardware; production domain/TLS; offsite backup; 24-hour backup interval; real-device Safari/Chrome; public deployment; email/external notification delivery (outbox rows only); order confirmation/reservation/payment/shipment (out of scope).
- **NOT SIMULATED:** true multi-process database deadlock injection; the concurrency tests use separate HTTP sessions but one Node process.

## 12. Residual risks / decisions

- Prices remain **reference** base-price quotes. Tier and limited-time promotion pricing are not implemented; Phase 4B-05 must re-verify final pricing and reject zero-amount orders before confirmation/reservation.
- Submission checks stock but does not reserve it; two pending orders can exceed stock until Phase 4B-05.
- Order lists are not paginated; acceptable for the pilot.
- The order status vocabulary is present, but only two states are written. Extension requires the Phase 4B-05 confirmation/reservation transaction.
- Administrator impact UI exists for product/SKU actions; brand/company screens are not part of the current real workspace, though their API enforcement and tests exist.
- Delivery country is validated against ISO alpha-3; a shipping-country allowlist and past-date policy need Owner confirmation.
- Real-mode screenshots are browser emulation, not real-device acceptance.
- Audit append-only protection/retention and trusted-proxy configuration remain from earlier phases.
- `order_items` price/product snapshots are immutable; only quantity and the derived line total can be updated while pending (column-level runtime grant).
