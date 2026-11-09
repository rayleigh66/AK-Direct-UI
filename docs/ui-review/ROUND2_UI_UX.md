# UAT round 2 — visual system, customer dates and internal language

**Baseline:** PR #15 head `e76fcade22c9e2ce4ed2b7daa2f79ba343d8e28e`
**Branch:** `feat/factoryos3-uat-round2`
**Final local head:** `0151a34eee8ef28b703d70731aaa258a7a73ae7c`

**Scope:** presentation and interaction only. No order state-machine, permission, frozen business rule or Phase 4B-05 change.

## 1. FactoryOS3 visual language

The existing warm-white/black/orange palette was completed from the FactoryOS3 design tokens in `src/index.css`:

- `--ink #151515`, `--muted #6b6d6f`, `--bg #f8f8f6`, `--line #e8e8e6`;
- one orange accent `--orange #ff681e`, with `--orange-strong #ed5610` and `--orange-deep #c24400`;
- shared radius/shadow tokens and `--focus`;
- reusable `.fo-card`, `.fo-btn`, `.fo-btn-primary`, `.fo-btn-dark`, `.fo-input`, `.fo-table`, `.fo-tag`, `.fo-page-title`, `.fo-eyebrow` classes.

The Real workspace shell is now a light FactoryOS-style top bar with a compact black active tab, orange active icon, grouped navigation, reduced helper copy and the global internal language control. Mock customer and internal surfaces keep their existing light shell and use the same palette (the Mock shell already used the same token family).

## 2. Customer dates

- New shared `src/utils/dateDisplay.ts` uses `Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })`.
- New `EnglishDateField` shows the closed-state value as `Nov 9, 2026` / `Dec 1, 2026` and uses a transparent native date input for the platform picker and keyboard.
- Applied to Mock order list and Real cart; order list/detail/success, membership, notifications and internal timestamp display use the shared English formatter.
- The backend still receives/stores the ISO `YYYY-MM-DD` value; the test suite checks the input value and the submitted order.
- No month names are derived from the system locale or from `lang="en"`.

## 3. Destination and shipping

- Real cart destination is a `SearchableCombobox` over `ISO_COUNTRIES`: search by English name or ISO3 code; the option label is English-only.
- The selected value is stored as the uppercase ISO3 code. Client validation resolves it against the same dictionary and the API still validates the assigned ISO3 set.
- New Real drafts default to `Sea`; a valid saved draft selection wins; an empty/invalid old draft falls back to `Sea`.
- Mock already defaulted to `Sea`; its saved-method path is now normalized against the approved methods too.
- `Express`, `Air`, `Sea`, `Customer Pickup` and `Other` remain available where already supported.

## 4. Internal language

- `src/real/internalLanguage.tsx` provides one context, per-user `localStorage` preference, a top global `中文 / EN` toggle, a shared dictionary, and `Localized` for host text/attribute translation.
- The Real shell, Products, Inventory, Warehouse cards, registration dialog, Import, Setup, Orders and the new tier preview use the same language state.
- A language change does not reset `activeTab`, filters, drafts, open dialogs or form state because the provider rerenders in place.
- Customer-visible Real copy is English-only; customer pages do not expose the internal toggle.
- Known API failures display a Chinese error summary with an expandable raw technical detail in Chinese mode; dynamic server text is not silently presented as a translated success.

## 5. Admin requirements

### CSV template

`src/utils/inventoryTemplate.ts` creates a header-only UTF-8 CSV:

```csv
sku_code,warehouse_code,on_hand,unsellable
```

The Import page exposes **Download CSV template / 下载 CSV 模板**; the download itself has no API call. The existing CSV/XLSX upload and server preview/commit path is unchanged. A unit test parses the template plus a filled row through the current parser.

### Product views

Real Products now has Grid and List modes sharing the same data, search, permissions and editor components. The preference is stored at `aoking.real.adminCatalogView`; toggling keeps search, expansion and in-progress editor drafts. Grid cards become full-width when expanded so editors stay usable; the layout is one column on mobile and has no horizontal overflow at 375/390/430/768/1440.

## 6. Tier preview — data contract and backend gap

The existing approved five-level model is now shared by the Mock rules and the Real preview in `src/data/tierModel.ts`:

```ts
interface TierRule {
  id: string;
  tier_level: 1 | 2 | 3 | 4 | 5;
  name: string;
  name_en?: string;
  threshold_usd: number;
  discount_rate: number; // 0 … 0.20
}
```

The Real **Customer tiers / 客户等级与折扣** page is intentionally **UI preview only**:

- it displays the existing Bronze → Diamond levels, thresholds and discount rates;
- edit, cancel, validation (whole non-negative thresholds, ascending tier order, existing maximum 20%) and local preview are available;
- there is no save-to-server operation and no success claim; the banner says **界面预览，尚未应用于真实订单**;
- reloading restores the approved values.

Proposed contract for a later, separately approved backend:

| Item | Proposed shape |
| --- | --- |
| Read | `GET /api/admin/tiers` → `{ tiers: TierRule[] }` |
| Write | `PATCH /api/admin/tiers/:id` with `{ thresholdUsd, discountRate, expectedVersion }` |
| Permission | new `tiers.manage` granted only to the administrator role |
| Audit | existing audit action `UPDATE_TIER_RULE`, old/new values and actor |
| Concurrency | row version/`expectedVersion`, 409 on stale write |
| Persistence | schema change/migration required; not included in this PR |
| Order application | needs separate pricing/order decision; not included |

## 7. Tests

- `tests/round2Ui.test.tsx` — English date formatter/closed-state field, shipping draft fallback/override, CSV template/parser, shared language translation, tier preview validation and honest preview messaging.
- `tests/e2e/round2-customer.spec.ts` — Chromium context with `locale: zh-CN`; English date display and ISO internal value, `Sea` default, submit success and 375/390/430/768 overflow checks.
- `tests/e2e-real/round2-admin.spec.ts` — admin default Products, Chinese/English shell and page switching, persistence across reload, CSV download/header, tier preview, Grid/List state retention and responsive grids.
- Updated real E2E covers Sales default Orders, global language across Orders/Inventory, ISO3 combobox selection/invalid text rejection, Sea default and saved-choice reload.
- Existing PR #14 and #15 suites remain in place, including hover wheel, per-focus selection, status colours, tooltips, warehouse registration, duplicate 409, inventory concurrency and restricted permissions.

Screenshots: `docs/ui-review/round2/` (admin products grid/list at 1440/768/430/390/375, tier preview, customer order list with English date at 1440/768/430/390/375) plus refreshed Real catalogue/cart/orders/warehouse captures.

### Local results

| Check | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm test` | **21 files / 150 tests passed** |
| `npm run test:e2e` (dedicated port, strict reuse off) | **101 passed / 35 skipped** |
| `npm run test:e2e:preview` | **1 passed** |
| `npm run api:lint` / `api:build` | PASS (no API change) |
| PostgreSQL integration suite on isolated DB | **6 files / 101 tests passed** |
| Isolated Real-auth Playwright suite | **8 passed / 1 skipped** (desktop 1440, mobile 390/430) |

## 8. Not implemented / deliberate limits

- No Real tier/promotion persistence, pricing calculation, migration or permission was added.
- The tier page is a preview; it does not affect orders.
- No production deployment, PR merge or Phase 4B-05 work.
- Existing Real API validation messages remain server-authored English; Chinese mode shows a Chinese failure summary and exposes the raw technical detail rather than inventing a translation.
