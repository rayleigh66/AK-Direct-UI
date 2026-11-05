# Phase 4B-03 Acceptance Report

**Branch:** `feat/catalog-inventory-4b03`
**Base:** `feat/auth-rbac-4b02` (Phase 4B-02, PR #8)
**PR:** stacked Draft PR against `feat/auth-rbac-4b02` (URL, exact Head SHA and CI links are reported in the PR body)
**Scope:** persistent catalogue, media, warehouses and inventory. No orders, cart, reservation, payment, shipment, WMS, promotions or Phase 3C changes.

## 1. Delivered

| Area | Result |
| --- | --- |
| Schema | Additive migration `004_catalog_inventory.sql` (001–003 untouched) |
| Catalogue | Products (manual unique code, draft by default), SKUs (manual unique code), series, feature tags, publishing rules |
| Media | Raw JPEG/PNG/WebP upload, magic-byte validation, Docker volume storage, authorised streaming, separate media backup archive |
| Warehouses | Admin-managed stable codes; no seeded warehouse |
| Inventory | Explicit registration, versioned adjustments, immutable movement ledger, no API write to `reserved` |
| Import | Server-side CSV/XLSX row validation, DB preview snapshot, all-or-nothing commit, idempotent confirmation |
| Customer | Brand-grant + published + active-SKU filtered catalogue with public availability only |
| Sales | Read-only inventory and warehouse list; no write route |
| React | Real-auth workspace for admin catalogue/inventory/import/setup, sales inventory and customer catalogue; Mock default preserved |
| DB roles | Runtime role extended with least-privilege catalogue/inventory grants; no DELETE on catalogue entities and no `reserved` column write |

Explicitly not implemented: orders, cart submission, order-time reservation, payment, shipment, WMS, promotions/tier pricing, automatic PENDING-order cancellation, FactoryOS3.

## 2. Migration and tables

`004_catalog_inventory.sql` adds: `products`, `product_skus`, `product_images`, `series_definitions`, `feature_tags`, `product_feature_tags`, `warehouses`, `inventory_balances`, `inventory_movements`, `inventory_import_batches`, `inventory_import_rows`. No catalogue/stock data is seeded. `schema_version` becomes `4b03`; readiness requires `004_catalog_inventory.sql`.

Guards include unique product/SKU/warehouse codes, non-negative stock, `on_hand >= reserved + unsellable`, one primary image per product, same-product SKU images (composite FK) and no delete APIs. Runtime role grants are column-level for `inventory_balances` and exclude `reserved`.

## 3. API contract

The full request/response, permission and error-code contract is in [Phase 4B-03 Catalogue & Inventory](PHASE_4B03_CATALOG_INVENTORY.md#3-api-contract). All writes require authentication, RBAC and CSRF; customer catalogue/media queries are filtered server-side.

## 4. React real mode

`VITE_REAL_AUTH=true` renders:

- admin: Products, Inventory, Import, Setup tabs (create/edit/publish products, SKUs, image upload/primary/order/removal, stock register/adjust, import preview/commit, warehouses/series/tags);
- sales: read-only Inventory;
- customer: English catalogue with brand/series/tag filters, product detail, SKU colours/prices and public availability; cart/order actions are explicitly marked unavailable.

The default Mock application is unchanged and still passes its suite.

## 5. Media storage and backup

- Files live in the `media_data` Docker volume; PostgreSQL stores only metadata (`storage_key`, MIME, size, SHA-256, order, primary flag).
- `scripts/backup-container.sh` writes a database dump **and** a `*_media_*.tar.gz` archive (mode 600, same retention). `scripts/media-restore.sh` restores media with `CONFIRM_RESTORE=yes`.
- The isolated smoke creates a media marker, backs it up, deletes it, restores the archive and verifies the marker.
- Media is served only through `GET /api/media/:id`; customers need a published product, brand grant and active SKU.

## 6. Inventory transaction and concurrency evidence

- Adjustment: `SELECT … FOR UPDATE` + `expectedVersion`; a stale version returns 409 `version_conflict`; a reserved value in the body is ignored and the column-level grant blocks direct writes.
- Import preview stores per-row `on_hand_before`, `unsellable_before`, `reserved_before` and `version_before`.
- Commit locks rows in deterministic order, re-checks every snapshot, and returns 409 `stale_preview` if any row changed; otherwise it applies all rows, movements and audit atomically.
- Repeated commit returns `alreadyCommitted: true` without new movements.
- Concurrent test: two adjustments with the same version produce exactly one 200 and one 409, version increments once, final value equals the winner, and exactly one movement exists.
- Import test: one invalid row (unknown SKU, duplicate pair, unsellable > on hand, negative) aborts the whole preview with no batch, audit or stock change.

## 6a. Review fixes (P0-01, P0-02)

### P0-01 — concurrent SKU discontinuation

`updateSku()` now reads the SKU's immutable `product_id`, locks the parent `products` row `FOR UPDATE`, and only then locks the SKU row. Every other catalogue write (publish, SKU creation, image upload/order/primary/removal, product edit) already locks the product first, so the lock order is consistently parent → child. `setPrimaryImage()` was updated to take the same parent lock before the image row.

Regression tests (PostgreSQL, separate HTTP sessions through the real app):

- Published product with two active SKUs, both discontinued concurrently: exactly one 200 and one 409 `last_active_sku`; the losing SKU remains active; the product stays published with exactly one active SKU; exactly one `UPDATE_SKU` audit row exists.
- Publish vs last-active-SKU discontinuation, five rounds: exactly one 200 and one 409 each round; if published, the product always has at least one active SKU; if discontinued, the product stays unpublished and publish fails with `publish_requires_sku`; audit rows match the successful action only.
- Mutation evidence: temporarily removing `FOR UPDATE` from the parent product read makes the new discontinuous test fail with two 200 responses, confirming the regression test detects the original race.

### P0-02 — safe media restore

`scripts/media-restore.sh` was rewritten to validate before touching the target:

- explicit `COMPOSE_PROJECT` and `CONFIRM_MEDIA_VOLUME` plus Compose label verification on the target volume;
- gzip integrity, relative-path/`..`/backslash checks, and rejection of non-regular entries before extraction;
- extraction into a temporary staging volume with a SHA-256 manifest;
- recoverable snapshot of the current media before promotion;
- promotion only after successful staging, then manifest verification; any failure restores the snapshot and keeps it if rollback itself fails.

`scripts/test-media-restore.sh` runs the real script against an isolated Compose project (created via `docker compose create`) and asserts the target manifest is byte-identical after: wrong target confirmation, missing volume, corrupt archive, truncated archive, path traversal, extraction failure, and forced post-promotion verification failure (rollback path). A valid restore is verified against the archive checksum and must remove pre-restore files. The production-named media volume is hashed read-only before/after and must not change. All cases PASS locally; the same script runs in CI.

## 7. Local test results

| Command | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm test` | 17 files, **94 passed** (includes API unit tests; Mock suite preserved) |
| `npm run build` / `npm run verify:assets` | PASS |
| `npm run api:lint` / `npm run api:build` | PASS |
| `npm run api:test` | 5 files, **18 passed** |
| `npm run api:test:db` | 3 files, **38 passed** (6 infrastructure, 13 auth/RBAC, 19 catalogue/inventory) |
| `npm run test:e2e` | **90 passed / 18 skipped** |
| `npm run test:e2e:preview` | **1 passed** |
| `bash scripts/test-smoke-isolation.sh` | PASS (DB + media backup/restore, 4 migrations, runtime role) |
| `bash scripts/test-media-restore.sh` | PASS (wrong target, missing volume, corrupt/truncated/unsafe/extraction-failure archives, forced rollback, valid restore with checksums) |
| `bash scripts/real-auth-e2e.sh` | **2 passed** (desktop 1440 + mobile 390) |
| Docker default stack (001–004) | `/api/ready` 200 |
| Container restart persistence | PASS — product/image/stock counts unchanged after `docker compose restart db api`; the media file was served again with HTTP 200 `image/png` |
| Runtime role DDL / delete / reserved write | denied (integration test) |

### Real-mode Playwright path

`scripts/real-auth-e2e.sh` creates a fresh admin (no fixed password) and two customer companies through the API, then runs `playwright.real.config.ts`:

admin login → create warehouse/season/tag → create product → upload image → create SKU → publish → register stock → import CSV with server preview → confirm → customer login → forced password change → browse authorised product → open detail (cart explicitly unavailable).

Screenshots (mobile 390 and desktop 1440): `docs/ui-review/real-catalog/`.

## 8. Docker smoke details

`scripts/test-smoke-isolation.sh` keeps the Phase 4B-01/02 protections (unique project, credentials, volume, images, ports, sanitized Compose environment, resolved-config validation, polluted-parent-env regression) and adds:

- 4 migration rows and the 4b03 readiness marker;
- api media volume and read-only backup media mount validated as project-scoped;
- media marker backup + restore;
- runtime role DDL denial and ability to read migration metadata;
- restore re-provisions the runtime role before readiness.

Actual result: **PASS** — `All isolated Phase 4B-01/4B-02/4B-03 compose checks passed.` and `Smoke isolation regression PASSED: polluted parent env did not redirect the smoke; production volume, simulated backup sentinel and real backups were untouched.` The run printed `Media backup written: …_media_….tar.gz`, `Migrations complete: 0 applied, 4 skipped.` after restore, restored the media marker and returned `/api/ready` 200.

## 9. Owner decisions still pending

1. Customer session duration (from Phase 4B-02).
2. Final password policy and admin `sales.write` grant workflow (Phase 4B-02).
3. Trusted-proxy hop configuration and spoofed `X-Forwarded-For` testing before public rollout (Phase 4B-02).
4. Audit append-only protection / retention mechanism (5-year duration is frozen policy).
5. Product category taxonomy: currently free text; a fixed category list needs Owner approval.
6. Warehouse fields beyond code/bilingual name/active.
7. Order module: reservation must set `reserved`; the runtime role will need an explicit, audited reservation path in that phase.
8. Media retention/offsite copy policy and whether removed images should be purged.

## 10. Not run / environment-limited

| Item | Status |
| --- | --- |
| Ubuntu 24.04 target hardware | **NOT RUN** |
| Production domain/TLS | **NOT RUN** |
| Offsite backup | **NOT RUN** |
| 24-hour backup interval | **NOT RUN** |
| Real device Safari/Chrome | **NOT RUN** — Playwright emulation only |
| Orders/cart/reservation | Out of scope; not claimed |
| Image EXIF stripping / thumbnails / CDN | Not implemented |
| CI execution of the real-auth Docker Playwright flow | **PASS in CI** — the `real-catalog-e2e` job starts the real-auth stack and runs desktop + mobile Playwright, then the media restore security tests |

## 11. Residual risks

- Media and database backups are separate archives; losing one loses either metadata or files. They must be stored together.
- The media volume is local; no offsite disaster recovery.
- File validation checks signatures and size but performs no image re-encoding, so malformed-but-signed files are served with `nosniff` and no script execution path.
- Import preview snapshots are checked again at commit; a long preview lifetime is not expired automatically.
- Free-text categories and materials can drift; taxonomy approval is pending.
- `reserved` cannot be changed until the order module adds a dedicated grant; this is intentional for this phase.
- Runtime grants must be updated in future migrations for any new table, as documented in Phase 4B-02.

## 12. CI

CI runs `local-prototype`, `backend-foundation` (38 integration tests), `docker-smoke` and `real-catalog-e2e` (real-auth stack, desktop/mobile Playwright and media restore security tests). The exact push/PR run links for the current Head are recorded in the PR body.
