# AOKING Direct UI

Standalone **UI / workflow prototype** for the AOKING Direct wholesale ordering portal.

## Local development

Requirements: a Node.js version compatible with Vite 8, and npm.

```bash
npm ci
npm run dev
```

Open the URL printed by Vite (configured development port: 3000).

```bash
npm run lint      # TypeScript check
npm test          # Vitest unit tests
npm run test:e2e  # Playwright customer flow and responsive checks
npm run build     # production build
npm run preview
```

The project does **not** need a Google/Gemini API key, Google AI Studio, Google Cloud Run, or Google-hosted fonts to run. It uses locally available system font fallbacks.

## Backend infrastructure (Phase 4B-01)

Phase 4B-01 adds only the deployment and API foundation: PostgreSQL, migrations, health/readiness endpoints, Caddy reverse proxy, backups and Docker Compose. It does **not** add customer, order, inventory or login business APIs.

```bash
cp .env.example .env   # change the local password before use
docker compose up -d --build --wait
curl http://127.0.0.1:8080/api/health
curl http://127.0.0.1:8080/api/ready
```

See [Phase 4B-01 Deployment](docs/PHASE_4B01_DEPLOYMENT.md) for environment, migrations, test database, backups/restore, production domain/HTTPS and upgrade steps.

## Authentication and RBAC (Phase 4B-02)

Phase 4B-02 adds real PostgreSQL-backed customer/internal authentication, roles, permissions, persistent sessions, CSRF protection, login rate limiting, audit events and least-privilege runtime database credentials. It does **not** add orders, inventory, cart, WMS or business APIs.

```bash
# Create the first internal admin without a fixed/default password
printf '%s\n' 'A-strong-password' | \
  docker compose exec -T -e MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" api \
  node apps/api/dist/auth/create-admin.js --email admin@example.com --name "Admin" --password-stdin --no-must-change

# Build the real login/session client (default is still the Mock UI)
VITE_REAL_AUTH=true docker compose build web
VITE_REAL_AUTH=true docker compose up -d --no-deps web
```

The default `VITE_REAL_AUTH=false` preserves the existing Mock app and Playwright suite. See [Phase 4B-02 Authentication & RBAC](docs/PHASE_4B02_AUTH_RBAC.md) for roles, data scopes, session policy, APIs, runtime-role separation and pending Owner decisions.

## Catalogue, media and inventory (Phase 4B-03)

Phase 4B-03 persists products, SKUs, image metadata, series, tags, warehouses and stock in PostgreSQL, with real uploads, publishing rules, a versioned inventory ledger and an all-or-nothing CSV/XLSX import. It does **not** add orders, cart submission, order reservation, payment, shipment, WMS or promotions.

- Product and SKU codes are entered manually and are unique; new products start unpublished.
- `reserved` stock is never writable by the API in this phase; order submission does not reserve stock. Phase 4B-05 adds the audited reservation path.
- Image files live in the `media_data` Docker volume. Database dumps **do not** contain them: the backup service also writes `*_media_*.tar.gz`, and `scripts/media-restore.sh` restores it after validating the archive into a staging volume (requires `COMPOSE_PROJECT`, `CONFIRM_MEDIA_VOLUME` and `CONFIRM_RESTORE=yes`).
- With `VITE_REAL_AUTH=true` the app shows the real admin catalogue/inventory/import/setup workspace, the read-only sales inventory view and the customer catalogue. The default Mock UI is unchanged.

```bash
# Real-auth catalogue flow against a running stack (creates a fresh admin and customers)
VITE_REAL_AUTH=true docker compose build web && docker compose up -d --no-deps web
bash scripts/real-auth-e2e.sh
```

See [Phase 4B-03 Catalogue & Inventory](docs/PHASE_4B03_CATALOG_INVENTORY.md) for the API contract, media backup/restore and inventory transaction rules, and [Phase 4B-03 Acceptance](docs/PHASE_4B03_ACCEPTANCE.md) for results and pending decisions.

## Company shared cart and customer orders (Phase 4B-04)

Phase 4B-04 adds the real customer ordering path: one PostgreSQL cart per customer company shared by all sub-accounts, server-revalidated order submission, reference pricing, `OD + YYMMDD + daily sequence` order numbers, customer order history, pending-order quantity changes/cancellation, assigned-salesperson and administrator read models, and impact-checked destructive admin actions. It does **not** confirm orders, reserve stock, record payment, arrange shipment, integrate WMS or implement promotions/tier pricing.

- Cart writes require `expectedRevision`; conflicts return 409 with the latest company cart. A retry sets a quantity instead of accumulating it.
- Submission locks the company cart, re-checks company/account/brand/product/SKU/MOQ/stock in PostgreSQL, recomputes integer-cent reference amounts, creates the order, history, audit and pending notifications, then clears the cart — all in one transaction.
- Idempotency is bound to company + submitting account + key + canonical payload.
- Orders start as `PENDING_CONFIRMATION`. Confirmation, final pricing and reservation are explicitly deferred to Phase 4B-05; the sales UI shows a disabled confirmation button.
- Sales order access follows the customer company's **current** assigned salesperson; the order stores the submission-time salesperson only as an audit snapshot. Pending sales notifications to a former owner are cancelled on reassignment.
- `ORDER_NUMBER_TIME_ZONE` (default `UTC`) controls the daily order-number date basis.
- With `VITE_REAL_AUTH=true` the customer sees Catalogue → Cart → Orders; sales sees assigned pending orders; administrators see read-only supervision and the pending-order impact dialog.

```bash
# Real-auth catalogue + shared cart + order + sales pending-order flow
VITE_REAL_AUTH=true docker compose build web && docker compose up -d --no-deps web
bash scripts/real-auth-e2e.sh
```

See [Phase 4B-04 Cart & Orders](docs/PHASE_4B04_CART_ORDERS.md) for the schema, API contract, permission matrix, concurrency/idempotency rules and P1 fixes, and [Phase 4B-04 Acceptance](docs/PHASE_4B04_ACCEPTANCE.md) for results and risks. The later UI/UX polish (status language, tooltips, quantity editing, searchable configuration controls, audit display and Real warehouse-name editing) is documented in [UI/UX Polish](docs/ui-review/UI_UX_POLISH.md), with the UAT round-2 visual system, customer English dates, internal language, CSV template, product views and tier preview in [Round 2 UI/UX](docs/ui-review/ROUND2_UI_UX.md).

## Order confirmation, price approval, reservation and release (Phase 4B-05)

Phase 4B-05 adds the real confirmation path on top of 4B-04. New orders use `OD-YYMMDD-NNNN`; historical `ODYYMMDDNNNN` numbers remain valid and share the same daily sequence.

- The current assigned salesperson with `sales.write` writes the complete plan (quantities and USD unit prices). A first plan at reference prices needs no price approval; any manual change against the most recent valid sales price creates a new approval epoch, including changing back to reference prices. Quantity-only edits inherit the current epoch/approval state. Business administrators approve/reject changed prices; approval and rejection record requester and decider separately (self-approval allowed).
- A company account explicitly granted buyer-confirmation authority can accept or reject the acceptable plan. Authority is managed per account by `business_admin` or `admin` through the Real Approvals screen; ordinary accounts and other companies have no authority. Revocation invalidates pending-order acceptances and returns the plan to `SUBMITTED`; confirmed evidence is retained.
- Only the current assigned salesperson with `sales.write` can confirm. Confirmation atomically re-reads authorization/plan/approval/acceptance/eligibility, validates explicit SKU+warehouse allocations, reserves sellable stock (`on_hand - reserved - unsellable`) through narrow SQL functions, freezes final snapshots, and writes history/audit/notifications/idempotent result. A short warehouse fails the whole order.
- Reservations start at 72h, may be extended up to a 312h hard ceiling with business-admin approval, and on expiry keep stock held and the order `CONFIRMED`. A full release/exception cancellation requires business-admin approval plus explicit unpaid/not-shipped verification and reduces only `reserved` by the original allocation.
- Destructive product/SKU/brand/company changes are allowed with a confirmed reservation but do not release stock: they write a `CONFIRMED_RESERVATIONS_AFFECTED` audit and notify business administrators. Warehouse deactivation remains blocked while active reservation lines point at it.
- The runtime database role has no generic `UPDATE reserved`; reservation/release accounting is enforced by two `SECURITY DEFINER` functions with a per-line/action reservation ledger, an approved-release binding and unique keys.

```bash
# Isolated Real stack for Phase 4B-05 verification (do not reuse 4b04 images/project)
COMPOSE_PROJECT_NAME=akd4b05-test \
API_IMAGE=akd4b05-test-api:local \
MIGRATE_IMAGE=akd4b05-test-migrate:local \
WEB_IMAGE=akd4b05-test-web:local \
WEB_PORT=18705 VITE_REAL_AUTH=true \
docker compose -p akd4b05-test up -d --build
# The E2E script only verifies the running stack; pass the same project/port.
COMPOSE_PROJECT_NAME=akd4b05-test WEB_PORT=18705 \
bash scripts/real-auth-e2e.sh
```

See [Phase 4B-05 Order Confirmation](docs/PHASE_4B05_ORDER_CONFIRMATION.md) for the authoritative contract, API and lock/transaction design, and [Phase 4B-05 Acceptance](docs/PHASE_4B05_ACCEPTANCE.md) for measured evidence and remaining acceptance blockers. The default Compose image tags remain `4b04`; always pass isolated image tags/project/port for 4B-05 verification and pass the same project/port to `scripts/real-auth-e2e.sh`.

## Scope and limitations

**This is a demonstration application, not a production ordering service.**

- In the default Mock UI, state (carts, orders, stock, audit events and account flags) is stored in React memory and resets on reload. With `VITE_REAL_AUTH=true`, products, SKUs, images, warehouses, stock, company carts, orders and pending notification records are stored in PostgreSQL and survive reloads, container restarts and normal updates.
- Role switching is a demo feature in the default Mock UI, not authentication or server-side authorization. Phase 4B-02 adds a separate real-auth gate with PostgreSQL sessions, but the Mock role switcher remains a demo-only surface; the backend enforces real authorization for its APIs.
- Phase 4B-02 implements real password hashing, login, sessions and first-login password change in the API. The default Mock UI still simulates password reset; use `VITE_REAL_AUTH=true` to see the real auth gate. Business screens remain Mock data.
- Stock reservation is a frontend simulation in the Mock UI, **not an atomic database transaction** and must not be relied upon to prevent overselling. In real mode, Phase 4B-04 order submission does not reserve stock; Phase 4B-05 confirmation does so atomically through PostgreSQL row locks and the reservation ledger.
- The Mock “Excel import” screen updates in-memory Mock inventory. The real-mode import sends parsed rows to the API, which re-validates them, stores a database preview and commits all-or-nothing inside a transaction; the browser preview is never trusted.
- Prices, promotion dates, product codes, SKU images and copy in the Mock data are demonstration content requiring a separate PRD consistency review before production development. Real-mode product/SKU data is entered by administrators.
- The multi-warehouse reservation is an in-memory allocation mock. It plans the whole order before changing state and fails as a whole when stock is short, but it is **not an atomic database transaction** and does not guarantee isolation under concurrent users.
- Order actions validate the current status and exact warehouse allocations. Duplicate release/payment/shipment/confirmation and repeated change approvals are rejected; approved quantity changes re-plan the entire order and leave both order and inventory unchanged on failure.
- Whole-order payment must equal the confirmed total in integer cents; partial or excess payment is rejected and cannot enable shipment. A pending cancellation/quantity-change request also blocks payment or release until it is approved or rejected.
- Product images are imported through Vite so production builds use hashed assets; the Demo data itself remains fictional. The four product JPGs are resized to 1000px and recompressed for the prototype.
- Customer-facing screens use English display fields/mappings while internal product IDs, SKU codes and sales/admin workflows remain unchanged.
- The customer flow is verified in Playwright at 375, 390, 430, 768 and 1440 CSS pixels. This is still browser emulation, not real-device Safari/Chrome acceptance. See [Mobile Customer UX](docs/ui-review/MOBILE_CUSTOMER_UX.md). Admin product management is documented in [Admin Catalog](docs/ui-review/ADMIN_CATALOG.md). Internal mobile operations and local inventory import are documented in [Internal Operations](docs/ui-review/INTERNAL_OPERATIONS.md).

Do not deploy this UI as a publicly accessible system containing real customers, credentials, orders or inventory.

## Planned review areas

1. Mobile-first buyer flows: browse products, filter, select SKU, adjust quantities, place orders, track progress.
2. English-only customer-facing copy; bilingual internal-facing copy.
3. Product management: create/edit products and SKUs, series, category, feature tags, per-color pictures, visibility.
4. Confirm business rules against the approved AOKING Direct PRD before changing MOQ, account, promotion or order behavior.
5. Backend authentication, permissions, sessions, catalogue, media, inventory, shared-cart order submission, confirmation, approval, reservation and full release are implemented through Phase 4B-05; payment, shipment, WMS, promotions/tier pricing and external channels remain future work.
6. Unit tests, CI and the reproducible npm lockfile are in place; true end-to-end mobile tests and real-device validation remain planned.

## Branch policy

The UI cleanup is developed on a separate branch and proposed in a draft pull request. No automatic merge into `main`.
