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
- `reserved` stock is never writable by the API until the order module exists.
- Image files live in the `media_data` Docker volume. Database dumps **do not** contain them: the backup service also writes `*_media_*.tar.gz`, and `scripts/media-restore.sh` restores it.
- With `VITE_REAL_AUTH=true` the app shows the real admin catalogue/inventory/import/setup workspace, the read-only sales inventory view and the customer catalogue. The default Mock UI is unchanged.

```bash
# Real-auth catalogue flow against a running stack (creates a fresh admin and customers)
VITE_REAL_AUTH=true docker compose build web && docker compose up -d --no-deps web
bash scripts/real-auth-e2e.sh
```

See [Phase 4B-03 Catalogue & Inventory](docs/PHASE_4B03_CATALOG_INVENTORY.md) for the API contract, media backup/restore and inventory transaction rules, and [Phase 4B-03 Acceptance](docs/PHASE_4B03_ACCEPTANCE.md) for results and pending decisions.

## Scope and limitations

**This is a demonstration application, not a production ordering service.**

- In the default Mock UI, state (carts, orders, stock, audit events and account flags) is stored in React memory and resets on reload. With `VITE_REAL_AUTH=true`, products, SKUs, images, warehouses and stock are stored in PostgreSQL and survive reloads, container restarts and normal updates.
- Role switching is a demo feature in the default Mock UI, not authentication or server-side authorization. Phase 4B-02 adds a separate real-auth gate with PostgreSQL sessions, but the Mock role switcher remains a demo-only surface; the backend enforces real authorization for its APIs.
- Phase 4B-02 implements real password hashing, login, sessions and first-login password change in the API. The default Mock UI still simulates password reset; use `VITE_REAL_AUTH=true` to see the real auth gate. Business screens remain Mock data.
- Stock reservation is a frontend simulation, **not an atomic database transaction** and must not be relied upon to prevent overselling.
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
5. Backend authentication, permissions, sessions, catalogue, media and inventory persistence are implemented through Phase 4B-03; order-time reservation and atomic order transactions remain future work.
6. Unit tests, CI and the reproducible npm lockfile are in place; true end-to-end mobile tests and real-device validation remain planned.

## Branch policy

The UI cleanup is developed on a separate branch and proposed in a draft pull request. No automatic merge into `main`.
