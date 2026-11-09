# AOKING Direct UI/UX polish

**Baseline:** accepted PR #13, `a6b31aae9ec31b9d489ac957bedfc8ef0e29ab77`
**Branch:** `feat/ui-ux-polish`
**Scope:** presentation and interaction only. No migration, order status value, state-machine, permission, pricing-rule or Phase 3C change.

## 1. What changed, and where

| # | Change | Mock | Real |
| --- | --- | --- | --- |
| 1 | One status colour/label vocabulary for business orders; internal Chinese/English mode without mixed title, status or action copy | `SalesOrdersView` | `OrdersView` (sales and admin scopes); customer status badges use the same palette |
| 2 | Long customer helper paragraphs replaced with a `?` tooltip that opens on hover, click and keyboard focus | catalogue, product detail, order list, membership, order-success | catalogue, cart confirmation, order detail |
| 3 | Visible cart icon + quantity badge on the customer Order List entry; product-card quick add edits the exact quantity | catalogue header and page entry; header/ bottom navigation already had a count | catalogue page entry; shared-cart header badge remains |
| 4 | Searchable promotion SKU combobox over SKU code, product code and Chinese/English names | `PromoTierConfigView` | not applicable: promotions are not implemented in Real mode |
| 5 | Searchable ISO3 country selector over Chinese name, English name and three-letter code; tier tags use existing tier rules | `CompanyAccountsView` | not applicable: Real mode has no company/tier administration screen |
| 6 | Reusable first-focus select-all, damped focused wheel stepping, MOQ/stock validation | product-card quantity, product-detail quantity, order-list quantity | catalogue detail quantity, cart quantity, order-line quantity |
| 7 | Internal audit action labels and business details displayed in Chinese without changing action codes or raw audit records | `AuditLogView` | not applicable: Real mode has no audit-log screen |
| 8 | Real administrator can edit both warehouse names through the existing `PATCH /api/admin/warehouses/:id` API | not applicable: Mock warehouses are demonstration data | `SetupView` |

### 1.1 Status vocabulary

`src/utils/orderStatus.ts` owns the single mapping used by Mock and Real:

- pending: amber
- confirmed: emerald
- payment recorded: sky
- preparing shipment: indigo
- shipped: violet
- delivered: teal
- completed: deeper emerald
- cancelled: rose
- reservation expired: orange
- draft: slate

The stored values (`PENDING_CONFIRMATION`, `CANCELLED`, etc.), the order state machine and the backend remain unchanged. Mock defaults to Chinese; Real internal order screens default to English. Both have a visible `中文 / EN` toggle covering page titles, filter tabs, status badges, action buttons, action messages and modal actions.

### 1.2 Tooltip

`src/components/ui/HelpTooltip.tsx` is a small disclosure button:

- hover, click and keyboard focus open the panel;
- Escape closes it and returns focus to the button;
- an outside press closes a pinned panel;
- the panel is viewport-width capped, so it cannot create horizontal overflow;
- reduced-motion is handled by the existing global CSS override.

### 1.3 Quantity editing

`src/components/ui/SelectAllOnFocusInput.tsx` selects the existing value only on the first focus. Later clicks place the caret normally; copy, paste, keyboard editing and touch selection are untouched. A pointer focus suppresses the mouseup caret collapse once.

`src/components/ui/QuantityField.tsx` adds:

- a focused-only wheel listener, so hovering a card does not hijack page scroll;
- a 30-unit damping accumulator and 90 ms rate limit, turning a wheel gesture into one PCS step;
- clamping to MOQ/stock and normal keyboard editing.

The Mock product card now has a visible quantity input plus **Set**, replacing the old `+10 PCS` accumulation. Invalid values keep the existing order list unchanged and show a toast.

### 1.4 Searchable configuration controls

`src/components/ui/SearchableCombobox.tsx` is an accessible single-select combobox:

- `role="combobox"` / `role="listbox"` / `role="option"` and `aria-activedescendant`;
- ArrowUp/ArrowDown/Enter/Escape;
- filtering over visible label + hidden keywords;
- pointer selection with `onMouseDown` protection so the input does not blur before selection.

Promotion options expose SKU code, product code, Chinese product name, English product name and both colour names. Country options combine alpha-3, alpha-2, English name and Chinese name from `src/data/isoCountries.ts` (249 ISO 3166-1 entries; Chinese labels generated with `Intl.DisplayNames`).

### 1.5 Tier tags and audit presentation

`TierBadge` reads `CustomerCompany.tier_id` against the existing `tierRules`; it never invents a level. The five existing levels render as colored Bronze, Silver, Gold, Platinum and Diamond tags before the customer name in the Mock account list.

`src/utils/auditDisplay.ts` is a presentation dictionary. The stored `action` code, actor, target and raw `details` are untouched; the view translates known action codes and the existing detail templates into Chinese. Unknown detail text falls back to a generic Chinese sentence while the raw record remains in place. Search still matches the raw action/details as well as the Chinese labels.

### 1.6 Real warehouse names

The Real Setup warehouse row has an **Edit names** action with Chinese and English fields, Save and Cancel. Save calls the existing `updateWarehouse` API and refreshes the list. Warehouse code and stock cannot be changed here; no drag-and-drop inventory behaviour was added.

## 2. Screenshots

Mock (`docs/ui-review/ui-polish/`):

- `customer-catalog-1440.png`, `customer-catalog-390.png`, `customer-catalog-430.png`
- `sales-orders-zh-1440.png`, `sales-orders-en-1440.png`, `sales-orders-390.png`, `sales-orders-430.png`
- `admin-promotions-1440.png`, `admin-accounts-1440.png`, `admin-audit-1440.png`

Real:

- `docs/ui-review/real-catalog/warehouse-edit-real-desktop-1440.png`
- `docs/ui-review/real-catalog/warehouse-edit-real-mobile-390.png`
- refreshed customer catalogue/detail, shared-cart, customer-order and sales-pending-order captures.

## 3. Interaction tests

### Mock Playwright

`tests/e2e/ui-polish.spec.ts` covers, at 1440 and by resizing to 390/430:

- cart entry + quantity badge;
- tooltip hover / Escape / click;
- first-focus selection and focused wheel stepping;
- direct quantity set and MOQ validation;
- keyboard activation of the Order List entry;
- promotion SKU search by code and Chinese/English name;
- ISO3 search by Chinese name, English name and code;
- existing tier tags (Gold/Bronze/Diamond);
- Chinese audit action/detail display;
- business-order status color and Chinese/English toggle with no overflow.

Existing Mock suites were updated only where the old labels or old `+10` accumulation no longer apply.

### Real Playwright

`tests/e2e-real/real-catalog.spec.ts` now edits both warehouse names through the real Setup UI and checks no horizontal overflow at 390/1440. `tests/e2e-real/real-orders.spec.ts` checks the shared status badge and the internal `中文 / EN` toggle.

### Local results

| Check | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm test` | **19 files, 113 tests** |
| `npm run build` / `verify:assets` | PASS |
| `npm run test:e2e` | **98 passed / 30 skipped** (existing intentional skips + new desktop-only resize tests) |
| `npm run test:e2e:preview` | **1 passed** |
| `npm run api:lint` / `api:build` | PASS (no API change) |
| `scripts/real-auth-e2e.sh` on isolated Compose project | **4 passed** (catalogue + orders, desktop 1440 / mobile 390) |

## 4. Boundaries and limitations

- Promotions and tier business rules are still Mock-only. No backend pricing, promotion, tier or discount logic was added.
- Real mode has no promotion, tier or audit screen, so items 4, 5 and 7 are Mock-only by design.
- The internal order language toggle changes the order workspace; global navigation keeps its existing bilingual chrome.
- The audit translation is a presentation layer for the current known action/detail templates. New action codes require a new dictionary entry; the raw record is never mutated.
- No migration, runtime grant, permission, order status value or frozen Phase 3C rule changed.
