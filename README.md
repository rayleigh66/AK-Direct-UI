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

## Scope and limitations

**This is a demonstration application, not a production ordering service.**

- State, including carts, orders, stock, audit events and account flags, is stored in React memory and resets on reload.
- Role switching is a demo feature in the default Mock UI, not authentication or server-side authorization. Phase 4B-02 adds a separate real-auth gate with PostgreSQL sessions, but the Mock role switcher remains a demo-only surface; the backend enforces real authorization for its APIs.
- Phase 4B-02 implements real password hashing, login, sessions and first-login password change in the API. The default Mock UI still simulates password reset; use `VITE_REAL_AUTH=true` to see the real auth gate. Business screens remain Mock data.
- Stock reservation is a frontend simulation, **not an atomic database transaction** and must not be relied upon to prevent overselling.
- The “Excel import” screen parses local `.xlsx` / `.csv` files in the browser, but only updates in-memory Mock inventory; it is not a database transaction and has no real concurrency control.
- Prices, promotion dates, product codes, SKU images and copy are demonstration content requiring a separate PRD consistency review before production development.
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
5. Backend authentication, permission checks and persistent sessions are introduced in Phase 4B-02; persistent business storage and safe inventory reservation remain future work.
6. Unit tests, CI and the reproducible npm lockfile are in place; true end-to-end mobile tests and real-device validation remain planned.

## Branch policy

The UI cleanup is developed on a separate branch and proposed in a draft pull request. No automatic merge into `main`.
