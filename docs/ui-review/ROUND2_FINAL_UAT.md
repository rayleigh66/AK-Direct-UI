# PR #16 final UAT fixes

Baseline: `6c4ef31d7aafbca01a56080041ddc18c364f9f23`
Scope: the six Owner-reported UAT fixes. No frozen business rule, permission,
order-state or pricing change.

## 1. Real interactive date calendar

`EnglishDateField` is no longer a transparent native `<input type="date">`.
It now renders a real trigger plus a clickable calendar:

- the whole trigger (text, calendar icon, blank area) opens the calendar;
- day, month navigation, Today, Clear date and Cancel are real buttons;
- Arrow keys/Home/End/PageUp/PageDown/Enter/Space/Escape work when the
  calendar is open;
- the closed state is always English (`Nov 9, 2026`, `Select date`), while the
  stored/submitted value remains ISO `YYYY-MM-DD`;
- no browser `showPicker()` or transparent overlay is required, so Mac
  Chrome/Safari and iPhone Safari use the same component.

The open view is anchored synchronously before the first open render, avoiding
a stale-month frame. Tests cover a real click/tap -> day click -> value update,
clear/reselect, month navigation, Escape cancel and keyboard selection.

## 2. Cart badge uses total PCS

The top badge now reads `cart.totalQuantity`, not the SKU line count. Two SKUs
with 10 + 30 PCS show `40`; above 99 it shows `99+`. The cart page keeps the
exact line/PCS counts, and the badge has an accessible `Cart, N PCS` label.
A shared `formatCartBadge` helper is unit-tested. Mock entry badges already
used total quantity.

## 3. Customer header hides the internal customer code

The customer header shows the logged-in `user.username` (for example
`AK150016A`) and never `C150016`. The value is not hard-coded. Catalogue,
cart, orders and success pages were checked; internal sales/admin views keep
their existing customer-code visibility. Account generation and API rules are
unchanged.

## 4. One catalogue cart entry

The duplicate `Order list` button with the cart icon in the Catalogue content
area was removed. The top navigation **Cart** and the cart badge remain, as do
the product-detail add/update-cart actions. This removes the duplicate entry
on mobile widths.

## 5. UAT-only sample catalogue

The isolated `akd-uat16` database was extended by
`/Users/hermes/Desktop/AK-Direct-UI-PR16-UAT/seed_uat_catalog.py` with eight
products (`UAT-PR16-002` … `-009`), three UAT series, three feature tags,
thirteen colour SKUs, images, prices and varied stock. One product has three
SKUs. The script is idempotent: it matches product/SKU/series/tag codes,
creates only missing rows, preserves existing inventory rows and never
overwrites user edits. It refuses to run unless the base URL is the PR #16 UAT
stack (`http://127.0.0.1:18416`). Production seeds/migrations are untouched.

## 6. CSV template with an example row

The downloaded template is now:

```csv
sku_code,warehouse_code,on_hand,unsellable
EXAMPLE-SKU,EXAMPLE-WH,100,0
```

The Import page shows a column legend (`SKU code`, `warehouse code`, on-hand,
unsellable) and a warning to replace the example SKU and warehouse code before
uploading. The download does not call any inventory API. The server preview
still validates real SKUs/warehouses and the full flow was exercised in Real
E2E: download -> replace example row -> upload -> preview -> explicit commit.

## Tests

Unit tests: `npm test` (21 files / 158 tests) covers the calendar interactions,
ISO values, cart badge formatting, template parser compatibility, strict
destination selection and the existing round 2 suite.

Mock E2E: 101 passed / 35 skipped, including a Chinese-locale click-through
calendar test.

Real E2E (against the rebuilt isolated UAT stack): `real-catalog`,
`real-orders`, `round2-admin` and warehouse registration cover the interactive
date, total-PCS badge, hidden company code, removed duplicate entry, one row
CSV flow and the existing permission/regression paths.

## Deliberate limits

- The sample catalogue exists only in the isolated UAT database; no production
  seed or default data was added.
- No API, migration, permission, order-state, inventory-transaction or pricing
  rule was changed by these six fixes.
- PR #16 remains Draft/Open; nothing was merged or deployed to production.
