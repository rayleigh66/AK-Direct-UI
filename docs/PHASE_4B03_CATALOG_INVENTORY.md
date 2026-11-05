# Phase 4B-03 — Persistent Catalogue, Media and Inventory

Status: implementation for review. It does **not** implement orders, cart submission, stock reservation for orders, payments, shipment, WMS, promotions or membership pricing.

## 1. Scope

Implemented:

- PostgreSQL tables for products, SKUs, image metadata, series, feature tags, warehouses, inventory balances/movements and inventory import batches.
- Real product/SKU management through the API: draft creation, editing, publishing, unpublishing, SKU status.
- Real image upload to a Docker volume with metadata and access control in PostgreSQL.
- Warehouse management and explicit stock registration/adjustment with row locks and version checks.
- Server-validated CSV/XLSX inventory import with preview snapshots, all-or-nothing commit, idempotency and audit.
- Customer catalogue filtered by company brand grant, product publish state and active SKUs, with public availability only.
- Sales read-only stock view.
- React real-auth workspace (`VITE_REAL_AUTH=true`) for admin catalogue/inventory/import/setup, sales inventory and customer catalogue. The default Mock UI and its tests remain unchanged.

Not implemented: orders, cart submission, order-time reservation, payment, shipment, WMS sync, promotion/tier pricing, automatic PENDING-order cancellation, FactoryOS3 integration.

## 2. Migration `004_catalog_inventory.sql`

| Table | Purpose |
| --- | --- |
| `products` | Manual unique product code, brand, bilingual names/descriptions, category, material, size, series, publish state |
| `product_skus` | Manual unique SKU code, colour names/hex, price in USD cents, sellable status, optional image |
| `product_images` | Storage key, MIME, size, SHA-256, order, primary flag, soft removal |
| `series_definitions` | Stable series ID, bilingual names, order, active flag |
| `feature_tags` | Stable tag code, bilingual names, tone, order, active flag |
| `product_feature_tags` | Explicit product/tag association |
| `warehouses` | Stable unique warehouse code, bilingual names, active flag |
| `inventory_balances` | One row per SKU + warehouse; on hand, reserved, unsellable, version |
| `inventory_movements` | Immutable before/after ledger with actor, reason and optional import batch |
| `inventory_import_batches` | Preview/commit state, unique idempotency key, creator |
| `inventory_import_rows` | Per-row snapshot: old/new quantities, reserved and version at preview |

No product, SKU, series, tag, warehouse, stock or media row is seeded. The only reused reference data is the AOKING brand from `002_auth_rbac.sql`. `system_metadata.schema_version` becomes `4b03`.

Database guards: non-negative quantities, `on_hand >= reserved + unsellable`, `unsellable <= on_hand` in imports, unique product/SKU/warehouse codes, one primary image per product, SKU images restricted to the same product via a composite foreign key. There is no physical delete path; series/tags/warehouses are deactivated and images are soft-removed.

## 3. API contract

All endpoints require a real session. Every POST/PUT/PATCH/DELETE also requires the CSRF header. Admin routes require the stated permission; failures return JSON `{ "error": { "code", "message" } }`.

### Customer catalogue

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/api/catalog/products` | customer session | Filters: `brandId`, `seriesId`, `tagId`, `category`, `search`; published + brand-granted + at least one active SKU; returns public `available` per SKU |
| GET | `/api/catalog/products/:id` | customer session | 404 when not visible |
| GET | `/api/catalog/brands` | customer session | Brands granted to the session company |
| GET | `/api/catalog/series`, `/api/catalog/tags` | customer session | Active dictionaries only |
| GET | `/api/media/:imageId` | authenticated | Customer access requires published product + brand grant + active SKU; removed images 404 |

### Admin catalogue (`catalog.read` to read, `catalog.manage` to write)

| Method | Path |
| --- | --- |
| GET | `/api/admin/catalog/brands`, `/series`, `/tags`, `/products`, `/products/:id` |
| POST | `/api/admin/catalog/products` |
| PATCH | `/api/admin/catalog/products/:id` |
| POST | `/api/admin/catalog/products/:id/publish`, `/unpublish` |
| POST | `/api/admin/catalog/products/:id/skus` |
| PATCH | `/api/admin/catalog/skus/:id` |
| POST | `/api/admin/catalog/products/:id/images` (raw JPEG/PNG/WebP body, max 4 MB) |
| PATCH | `/api/admin/catalog/products/:id/images/order` |
| PUT | `/api/admin/catalog/products/:id/images/:imageId/primary` |
| DELETE | `/api/admin/catalog/products/:id/images/:imageId` (soft removal) |
| POST/PATCH | `/api/admin/catalog/series`, `/series/:id`, `/tags`, `/tags/:id` |

### Warehouses and inventory (`inventory.manage`; sales use read-only routes)

| Method | Path |
| --- | --- |
| GET/POST | `/api/admin/warehouses`, PATCH `/api/admin/warehouses/:id` |
| GET | `/api/admin/inventory` |
| POST | `/api/admin/inventory/register` |
| PATCH | `/api/admin/inventory/:skuId/:warehouseId` (`expectedVersion` required) |
| POST | `/api/admin/inventory/import/preview` |
| POST | `/api/admin/inventory/import/:batchId/commit` |
| GET | `/api/sales/inventory`, `/api/sales/warehouses` (read-only) |

Notable error codes: `duplicate_product_code`, `duplicate_sku_code`, `publish_requires_sku`, `publish_requires_image`, `last_active_sku`, `primary_image_required`, `last_image_required`, `image_type_mismatch`, `version_conflict`, `stale_preview`, `unknown_inventory_row`, `duplicate_import_row`, `invalid_import_quantity`, `unknown_sku`, `unknown_warehouse`, `csrf_failed`, `forbidden`.

### Business rules enforced by the API

- New products are drafts. Publishing requires at least one active SKU and one active image.
- A published product cannot discontinue its last active SKU.
- Editing names, prices, images or codes never changes internal product/SKU IDs.
- Product/SKU/series/tag physical deletion does not exist.
- Deactivating a series/tag keeps existing product associations.
- SKU images must belong to the same product.
- The primary image cannot be removed directly; another image must become primary first.
- The last image of a published product cannot be removed until the product is unpublished.

## 4. Media storage and backup

- Uploads are validated by magic bytes (JPEG/PNG/WebP), allowlisted MIME, size ≤ 4 MB and a SHA-256 checksum.
- Files are written under `MEDIA_ROOT` (Docker volume `media_data` mounted at `/app/media`) with a random UUID filename; the original filename is never used as a path.
- The API image ships an entrypoint that starts as root only long enough to `chown` `MEDIA_ROOT` to the `node` user and then `exec`s the API process under `node` via `su-exec` (`UID 1000`). This keeps uploads working even if Docker initialised the named volume from another image. The `backup` service also waits for the API to be healthy.
- Serving goes through `GET /api/media/:id`, never a static directory, so authorisation is enforced per request.
- **Database backups do not include image files.** `scripts/backup-container.sh` now writes a separate `*_media_*.tar.gz` archive of the media volume with the same 30-day retention and mode 600.
- `scripts/media-restore.sh` never wipes the target before validation:
  1. requires `COMPOSE_PROJECT`, `CONFIRM_RESTORE=yes` and `CONFIRM_MEDIA_VOLUME=<project>_media_data`, and verifies the Compose project/volume labels on the target volume;
  2. checks the gzip integrity and every member path (`./` relative, no `..`, no backslash) and rejects symlink/hardlink/device entries;
  3. extracts into a temporary volume, computes a SHA-256 manifest and verifies the extraction;
  4. **stops the API and verifies it is stopped before any snapshot**; if the stop command fails or the container is still running, the restore is rejected with the target untouched (the API is the only media writer; the backup service mounts the volume read-only);
  5. snapshots the now-quiescent media into a recoverable previous volume;
  6. promotes the staging volume and compares the target manifest with the staged manifest;
  7. on any promotion/verification failure, restores the previous volume while writers remain stopped, verifies the rollback manifest, and only then restarts the API;
  8. after a successful restore, restarts the API and requires its health check to pass; a restart or health failure exits non-zero, keeps the previous snapshot and never prints success.
  `RESTORE_MANAGE_API=0` exists for isolated negative tests only and prints a warning; it is not evidence of production ordering.
- `scripts/test-media-restore.sh` exercises the actual script against an isolated Compose project/volume: wrong target confirmation, missing volume, corrupt/truncated archives, path traversal, extraction failure, forced post-promotion failure with rollback, and a valid restore with content/checksum verification. It also starts a real isolated API and tests `RESTORE_MANAGE_API=1`: stop-before-snapshot ordering, stop failure (target hashes unchanged), rollback after promotion/verification failure with the API restarted only afterwards, restart-command failure and health-check failure (both non-zero and the previous snapshot preserved). It hashes the production-named volume read-only before/after and fails if it changed.
- Restoring only the database leaves images untouched; restoring only media leaves metadata untouched. Both archives must be kept together.

## 5. Inventory transactions

- `inventory_balances` is unique per SKU + warehouse; `available = on_hand - reserved - unsellable`.
- `reserved` starts at 0 and can never be written by the API: the runtime database role has column-level `INSERT`/`UPDATE` grants that exclude the `reserved` column. The API ignores any `reserved` field in request bodies.
- Manual adjustment requires the current `version`; the transaction locks the row `FOR UPDATE`, re-checks the version and constraints, increments the version and writes a movement row with before/after values, reason and actor.
- Initial stock is only created with an explicitly selected active warehouse (SKU creation or `register`); no default or Mock warehouse exists.
- Import preview:
  - validates ≤ 500 rows / 1 MB at the API boundary, required columns, integer non-negative values, duplicate SKU+warehouse, existing SKU and active warehouse, existing balance row, `unsellable <= on_hand` and `on_hand - unsellable >= reserved`;
  - stores a batch with a unique idempotency key and one snapshot row per line (old on hand, old unsellable, reserved, version);
  - returns the server-side old/new values; the client preview is never trusted.
- Import commit:
  - locks every target balance in a deterministic order (`sku_id`, `warehouse_id`);
  - rejects the entire batch with `stale_preview` if any version or quantity differs from the preview;
  - applies every row, writes movements linked to the batch and one audit row; any failure rolls the whole transaction back;
  - a repeated commit with the same batch returns `alreadyCommitted: true` and does not change stock or movements again.

## 6. React integration

- `VITE_REAL_AUTH=true` renders the real login gate and, after login, a real workspace:
  - admin: Products (create/edit/publish, SKU, images), Inventory (register/adjust), Import (server preview + commit), Setup (warehouses, series, tags);
  - sales: read-only Inventory;
  - customer: English catalogue with filters, product detail, prices and public availability, with an explicit “cart and ordering not enabled” notice.
- All data comes from the API; the Mock `AppContext` is not used in real mode. Failed requests show the server message and a retry action.
- The default `VITE_REAL_AUTH=false` keeps the existing Mock application and Playwright suite unchanged.

## 7. Verification

See [Phase 4B-03 Acceptance](PHASE_4B03_ACCEPTANCE.md) for the exact commands, counts, screenshots and CI links.

## 8. Known limitations / Owner decisions

- Cart, order creation and order-time reservation are not implemented; `reserved` remains 0 until the order module exists.
- No image transformation, thumbnails, CDN or EXIF stripping beyond format validation.
- Media backup archives are local-only; offsite copy is not implemented.
- Warehouse location/contact fields are minimal (code, bilingual names, active).
- Product category remains free text to avoid inventing an unapproved taxonomy.
- Sales catalogue visibility beyond inventory is limited to `catalog.read` seed data; no sales product-management UI is provided.
- Customer session duration, password policy, admin `sales.write` grant workflow, trusted-proxy configuration and audit append-only protection remain from Phase 4B-02.
