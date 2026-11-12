# Phase 4B-04 — Company Shared Cart and Customer Orders

Status: implementation for review. Order **confirmation**, inventory reservation, payment, shipment, WMS, promotions and customer-tier pricing are **not** implemented in this phase.

## 1. Scope

Implemented:

- one company shared cart (`customer_companies.id`) persisted in PostgreSQL, shared by every sub-account of that company;
- optimistic cart revisions with `expectedRevision` and a server-returned latest cart on conflict;
- server-side eligibility and stock checks when adding/updating a cart line;
- customer order submission inside one transaction: revalidation, price snapshot, order number, order lines, status history, audit, cart clearing and a pending-notification outbox;
- order numbers in the frozen `OD + YYMMDD + 4-digit daily sequence` form, generated atomically in PostgreSQL;
- customer order list/detail, pending-order quantity changes and cancellation;
- assigned-salesperson and administrator supervision read models with server-side data scopes;
- impact preview + explicit confirmation when an administrator unpublishes a product, discontinues an SKU, revokes a brand grant or suspends a company while `PENDING_CONFIRMATION` orders exist;
- Phase 4B-03 P1 fixes: import idempotency binding and an immutable committed-result snapshot;
- React real-mode cart, checkout, customer orders and internal pending-order screens, with the Mock application unchanged.

Explicitly not implemented: order confirmation, final tier/promotion pricing, stock reservation (`reserved` stays 0), payment, shipment, WMS, automatic deployment, FactoryOS3.

## 2. Migrations `005_cart_orders.sql` and `006_sales_reassignment.sql`

Additive only. `001`–`005` are untouched and checksum-frozen.

`006_sales_reassignment.sql` adds the `cancelled` notification status and
`cancelled_at`, and cancels any pending sales notification addressed to a
salesperson who is no longer the company's current assignee. `schema_version`
becomes `4b04.1`; readiness requires `006_sales_reassignment.sql`.

| Table | Purpose |
| --- | --- |
| `order_statuses` | Frozen status vocabulary; API only writes `PENDING_CONFIRMATION` and `CANCELLED` in this phase |
| `company_carts` | One row per customer company, monotonic `revision` |
| `cart_items` | One row per company + SKU, quantity 10–1,000,000 |
| `order_sequences` | `order_date` → last daily sequence, updated atomically with `INSERT … ON CONFLICT … RETURNING` |
| `orders` | Order number, company, submitter, assigned salesperson snapshot, status, revision, delivery snapshot, pricing mode/version, reference total, cancellation fields |
| `order_items` | Product/price snapshot at submission. The runtime role may update only `quantity` and its derived `line_reference_cents` while the order is pending; codes, colours and unit-price snapshots stay immutable |
| `order_idempotency` | `(company_id, submitted_by_user_id, idempotency_key)` → payload digest and order |
| `order_status_history` | `SUBMITTED`, `LINES_MODIFIED`, `CANCELLED`, `ADMIN_CANCELLED` events with actor and details |
| `order_notifications` | Pending/sent/failed outbox rows for the customer company and assigned salesperson |
| `inventory_import_commit_results` | Immutable committed import result (P1-B) |

Constraints: unique order number; unique `(order_id, line_number)` and `(order_id, sku_id)`; non-negative and bounded quantities/amounts; positive reference total; a cancellation timestamp is present exactly when the status is `CANCELLED`; cart quantities match the MOQ; order-item line amount equals reference unit price × quantity. There is no DELETE grant for orders, order items or history.

`schema_version` becomes `4b04.1`; readiness requires `006_sales_reassignment.sql`.

### Order-number date basis

`ORDER_NUMBER_TIME_ZONE` (default `UTC`) is an IANA time zone validated at startup. Both the sequence row date and the `YYMMDD` part are derived from the same instant in that zone. Daily sequence exhaustion above 9999 returns `503 order_sequence_exhausted`. Rolled-back transactions may leave gaps; numbers are never reused.

## 3. API contract

All routes require a real session, a changed initial password, and (for POST/PUT/PATCH/DELETE) the double-submit CSRF header. Errors use `{ "error": { "code", "message" }, ...details }`; `details` may carry `cart`, `order` or `impact`.

### Customer cart

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/cart` | Current company cart, revision, items, issues, reference total |
| PUT | `/api/cart/items/:skuId` | `{ quantity, expectedRevision }`; sets the target quantity (never adds) |
| DELETE | `/api/cart/items/:skuId` | `{ expectedRevision }` |
| DELETE | `/api/cart/items` | `{ expectedRevision }`; clears the company cart |

The company is always taken from the authenticated session. No request field can select another company. Invalid existing lines are returned with `isAvailable: false` and human-readable `issues`; they are never silently deleted.

Conflicts return `409 cart_version_conflict` with the latest `cart`.

### Customer orders

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/orders` | `{ idempotencyKey, expectedCartRevision, shippingMethod, destinationCountryAlpha3, expectedShipDate, shippingRequirements }` → `201 { order, alreadySubmitted: false }`; a safe retry returns `200 … alreadySubmitted: true` |
| GET | `/api/orders` | Company orders, newest first |
| GET | `/api/orders/:id` | Company-scoped; another company receives 404 |
| PATCH | `/api/orders/:id/lines` | `{ expectedRevision, lines: [{ skuId, quantity }] }`, pending only |
| POST | `/api/orders/:id/cancel` | `{ expectedRevision, reason? }`, pending only |

Delivery fields follow the approved Mock values: `Express`, `Air`, `Sea`, `Customer Pickup`, `Other`; an assigned ISO 3166-1 alpha-3 country code; a real `YYYY-MM-DD` date; free text up to 1,000 characters with the frozen privacy filter (no email, phone or street address).

### Internal order views

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/sales/orders`, `/api/sales/orders/:id` | `sales.read_assigned` via the company's **current** `assigned_sales_user_id`, or `sales.read_all` |
| GET | `/api/admin/orders`, `/api/admin/orders/:id` | `sales.read_all` |
| GET | `/api/admin/orders/impact?kind=…&targetId=…[&companyId=…]` | `sales.read_all` |

Sales and administrator order routes are **read-only**. There is no confirmation, reservation, payment or shipment route in this phase.

### Permission and data-scope matrix

| Session | Cart | Own company orders | Assigned orders | All orders | Destructive admin actions |
| --- | --- | --- | --- | --- | --- |
| Customer | yes (own company only) | yes (all sub-accounts) | no | no | no |
| Sales (`sales.read_assigned`, `sales.write`) | no | no | read only | no | no |
| Admin (`sales.read_all`, no `sales.write`) | no | no | read only | read only | catalogue/brand/company permissions apply; order writes remain sales-only |
| Admin with `sales_writer` role | no | no | read only | read only | same |

## 4. Company shared cart

- `GET /api/cart` returns revision 1 with no row until the first write; the first write locks the row `FOR UPDATE` and compares `expectedRevision`.
- A successful write increments the revision once and writes an audit row in the same transaction.
- Two sub-accounts editing concurrently: one succeeds, the other receives `409` plus the latest cart; there is no silent last-write-wins.
- Setting the same SKU twice replaces the quantity, so a retry cannot double the quantity.
- Add/update rejects an unpublished product, discontinued SKU, revoked brand grant or quantity above current available stock. `available = SUM(on_hand − reserved − unsellable)` from PostgreSQL.
- Items that become invalid later remain in the cart and are flagged in `GET /api/cart`; only an explicit remove operation deletes them.
- The cart is a database row, so it survives page refresh, logout/login, API restart and container restart.

## 5. Order submission

Inside one transaction the server:

1. re-checks the customer company and account are active;
2. locks the company cart and resolves an existing idempotency record **before** the revision check (so a safe retry still returns the original order after the cart was cleared);
3. verifies `expectedCartRevision`;
4. reloads every cart line from PostgreSQL and re-checks product published state, SKU status, brand grant, MOQ ≥ 10 and available stock;
5. recomputes every line amount and the order total from the current SKU base price in integer USD cents (client totals/prices/company/salesperson are ignored);
6. allocates the daily order number atomically;
7. inserts `orders`, `order_items`, submission history and idempotency record;
8. deletes the submitted cart lines and increments the cart revision;
9. queues customer and assigned-salesperson notification rows with status `pending`;
10. writes the `SUBMIT_ORDER` audit row;
11. commits. Any failure rolls everything back, including the cart deletion and sequence increment.

A zero/negative total or an unsafe cent total is rejected (`amount_overflow` / `invalid_amount`). `inventory_balances.reserved` is never changed in this phase; tests assert it stays zero.

Concurrency with administrator actions: submission takes `FOR SHARE` locks on the company/account and on the cart's product/SKU rows. Destructive admin actions take the matching `FOR UPDATE` locks, so either the order commits first and the admin impact preview sees it, or the admin change commits first and the submission re-reads an unpublished/discontinued/suspended state and is rejected. Regression tests race unpublish-vs-submit and suspend-vs-submit and assert that no pending order survives for an unpublished product or suspended company.

### Pricing status

The database currently stores only a base wholesale price per SKU. Orders therefore carry:

- `pricingMode = base_reference`
- `pricingVersion = 4b04-base-price-v1`
- `isReferenceQuote = true`
- per line `baseUnitPriceCents` and `referenceUnitPriceCents` (equal at submission), plus the line snapshot.

The customer UI and DTO state that this is a **reference quote pending sales confirmation**. No SKU-level permanent price, tier discount or promotion rule is created in this phase. Phase 4B-05 must re-verify final tier/promotion pricing and must reject a zero-amount order before confirmation/reservation.

### Idempotency

- Key format: 8–128 visible characters; the frontend uses UUIDs.
- Scope: company + submitting account + key. Another account or company cannot read or reuse the record.
- Payload digest is a SHA-256 over the canonical delivery fields and `expectedCartRevision`.
- Same key + same payload → original order, `alreadySubmitted: true`.
- Same key + different payload → `409 idempotency_conflict`.
- Concurrent retries with one key serialise on the cart lock; both return the same order and only one order exists.

## 6. Order states and history

Only `PENDING_CONFIRMATION` and `CANCELLED` are written in this phase. `order_statuses` also contains the frozen future states (`CONFIRMED`, `PAYMENT_RECORDED`, `PREPARING_SHIPMENT`, `SHIPPED`, `DELIVERED`, `COMPLETED`, `RESERVATION_EXPIRED`, `DRAFT`) as the explicit extension contract; no API route writes them.

`PENDING_CONFIRMATION` allows:

- quantity changes for SKUs already in the order (MOQ, product, SKU, brand and stock are re-checked; the original unit-price snapshot is retained and line/total reference amounts are recomputed);
- direct cancellation with a reason (privacy-filtered);
- both require `expectedRevision`; stale revisions return `409 order_version_conflict` with the current order;
- history and audit rows are written in the same transaction. A repeated cancel returns `409 order_status_conflict` and creates no second success audit.

Confirmed-order changes, reservation adjustment and change approval are out of scope. The UI does not pretend a confirmed-order approval workflow exists.

## 7. Administrator action linkage

Destructive actions check affected `PENDING_CONFIRMATION` orders:

| Action | Endpoint | Impact kind |
| --- | --- | --- |
| Unpublish product | `POST /api/admin/catalog/products/:id/unpublish` | `product_unpublish` |
| Discontinue SKU | `PATCH /api/admin/catalog/skus/:id` with `sellableStatus: discontinued` | `sku_discontinue` |
| Revoke brand grant | `PUT /api/admin/companies/:id/brands/:brandId` with `granted: false` | `brand_revoke` |
| Suspend company | `PATCH /api/admin/companies/:id/status` with `status: suspended` | `company_suspend` |

Flow:

1. `GET /api/admin/orders/impact` returns the exact pending order IDs, order numbers, companies and a digest `impactToken`.
2. Without `confirmAffectedOrders: true`, the mutation returns `409 pending_orders_affected` with the current impact and changes nothing.
3. With confirmation, the backend re-computes the affected set **inside the mutation transaction**, locks those order rows, and compares the latest digest to `impactToken`. A new/cancelled/changed order invalidates the token (`409 impact_changed`).
4. When the token matches, the administrative change and every affected cancellation (status, history, audit, customer notification, assigned-salesperson notification) commit or roll back together.
5. If an order can no longer be safely cancelled, the whole group rolls back; no invalid pending order is left behind.

Notifications are durable `order_notifications` rows with status `pending`. **No email or external message is sent** in this phase.

## 8. Customer-safe and internal DTOs

Customer order DTOs contain only order number, status/label, revision, line snapshots, reference amounts, delivery fields, customer note, cancellation reason and a customer-friendly history. They omit company/internal IDs, assigned salesperson, internal notes, audit data, submitter identity and employee permissions.

Internal sales/administrator DTOs add company code/name, submitting username, the immutable submission-time assigned-salesperson snapshot (`assignedSalesUserId`), the current owner (`currentAssignedSalesUserId`) and full history actor/details.

Sales list and detail authorization uses the **current** `customer_companies.assigned_sales_user_id` through a database join/condition, never the order snapshot. After a reassignment, the former owner receives an empty list and 404 on direct detail; the new owner sees existing pending orders; administrators with `sales.read_all` are unchanged. The order snapshot is preserved for audit only.

Order-change, customer-cancellation and administrative-cancellation notifications resolve the current assignee inside the transaction under a shared company lock. A sales-assignment transaction locks the company `FOR UPDATE` and marks every pending sales notification for a different assignee as `cancelled` with `cancelled_at`; a sender must therefore never deliver a stale pending row to the former owner. Unassigned companies generate customer notifications only.

To keep that added shared lock deadlock-safe, destructive catalogue actions lock affected companies before their product/order locks, and notification insertion always takes the company lock before the order lock. The resulting order matches submission (`company → product → SKU → order`).

## 9. Phase 4B-03 P1 fixes

### P1-A — import idempotency binding

`inventory_import_batches.payload_digest` stores a SHA-256 over a canonical payload (fixed key order, trimmed source name, rows sorted by row number). A retry returns the original batch only when the actor and digest both match; a different payload or actor receives `409 idempotency_conflict` without batch data. Concurrent creation of the same key resolves the unique-violation race by re-reading the winner and applying the same checks (no 500, no duplicate batch). Legacy preview rows have a NULL digest and are refused for reuse because their original payload cannot be verified.

### P1-B — committed-result snapshot

`inventory_import_commit_results` stores the immutable committed rows (SKU code, warehouse code, resulting quantities and version). A repeated commit returns that snapshot with `alreadyCommitted: true`, even after later adjustments. For a committed Phase 4B-03 batch without a snapshot, the original preview rows provide the exact committed outcome; it is persisted once and then reused. Imports never write `reserved`.

## 10. React real mode

`VITE_REAL_AUTH=true` now renders:

- customer: Catalogue → Cart → Orders (English). Cart badge, shared-cart page, quantity editing/removal, invalid-line warnings, delivery form, reference total, confirmation modal, success page with the real order number/pieces/reference total, customer order cards/detail/modify/cancel;
- sales: Inventory, Orders (assigned customers, read only). The confirm button is explicitly disabled and labelled “available in Phase 4B-05”;
- admin: Products, Inventory, Import, Setup, Orders (read-only supervision). Product unpublish and SKU discontinuation show the pending-order impact dialog and require explicit confirmation.

The delivery draft is stored locally per company as a convenience; the submitted server snapshot is authoritative and is cleared on success. Failed submissions keep the cart and delivery draft.

The default Mock application (`VITE_REAL_AUTH=false`) and its Playwright suite are unchanged.

## 11. Error codes (new)

`cart_version_conflict`, `cart_empty`, `cart_item_not_found`, `invalid_quantity`, `product_unavailable`, `sku_unavailable`, `brand_not_authorized`, `insufficient_stock`, `invalid_shipping_method`, `invalid_destination_country`, `invalid_expected_ship_date`, `privacy_violation`, `invalid_lines`, `invalid_order_line`, `no_change`, `moq_not_met`, `amount_overflow`, `invalid_amount`, `order_not_found`, `order_status_conflict`, `order_version_conflict`, `idempotency_conflict`, `order_sequence_exhausted`, `pending_orders_affected`, `impact_confirmation_required`, `impact_changed`, `idempotency_conflict` (import), plus the existing auth/CSRF/RBAC codes.

## 12. Known limitations / Owner decisions

- Order confirmation, final tier/promotion pricing, reservation and payment are Phase 4B-05.
- The UI exposes impact confirmation for product unpublish and SKU discontinuation. Brand-revoke and company-suspension impact enforcement exists in the API but those administrative screens are not part of the current real workspace (companies/brands are managed through existing Phase 4B-02 API/admin flows).
- The delivery country is validated against the ISO alpha-3 set; a fixed shipping-country allowlist is an Owner decision.
- Order list endpoints are not paginated yet; the pilot scale is small.
- Notification delivery (email/external) is not implemented; only durable pending rows exist.
- The cart and order screens use the existing visual system rather than a new order application; visual parity with the Mock remains an Owner review item.
