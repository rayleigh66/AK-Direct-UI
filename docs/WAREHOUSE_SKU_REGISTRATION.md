# Warehouse SKU registration — review evidence

Stacked on PR #14, authorized synchronization baseline `6bb1bba5230df915f30edadd6b11dc44e1ae42db` (`feat/ui-ux-polish`). The feature branch does not modify that branch or `main`.

## Existing interfaces reused

| Interface | Use | Existing authority / constraints |
| --- | --- | --- |
| `GET /api/admin/catalog/products` | Search SKU/product codes, bilingual titles and colours, including SKUs with no balance | `catalog.read`; admin directory, not customer catalogue eligibility |
| `GET /api/admin/warehouses` | Codes, bilingual names, active state | `inventory.manage` |
| `GET /api/admin/inventory?skuId=…&warehouseId=…` | Fresh exact-pair lookup before confirmation or uncertain-result recovery | `inventory.manage`; DTO unchanged |
| `POST /api/admin/inventory/register` | First registration only, after explicit absolute on-hand quantity and reason | `inventory.manage`, CSRF, active warehouse, unique pair, existing quantity constraints |
| `PATCH /api/admin/inventory/:skuId/:warehouseId` | Separate existing-row adjustment | Existing mandatory `expectedVersion`, balance constraints, CSRF, authority, transaction |
| `PATCH /api/admin/warehouses/:id` | Shared name editor in Setup and warehouse cards | Name-only UI payload; existing code/ID rules and audit |

The view lives under Real Inventory for administrators. Sales retain the existing read-only list. Mock business behavior is unchanged. No endpoint, migration, runtime grant, role or permission was added. No package was added.

## Interaction and write boundaries

- Search selects an existing directory SKU. Only that directory preview is draggable; stock rows are not transfer sources. The drag payload contains only a SKU ID.
- Drop on an active warehouse and phone/keyboard selection call the same confirmation dialog. Both only perform a GET until an explicit valid submit.
- The dialog starts with blank on-hand quantity and reason. Zero is accepted when explicitly entered; quantities must be integers in the existing 0–100,000,000 range. Unsellable cannot exceed on hand. No customer MOQ or available-stock clamp is applied.
- An existing pair offers only viewing/separate adjustment. A competing registration returning `inventory_exists` triggers a fresh GET; it never becomes PATCH.
- A network/5xx result remains uncertain until an explicit status lookup. A found pair enters the existing-row branch. An absent pair permits a new explicit confirmation; the database unique constraint still arbitrates concurrent writes.
- POST success is marked committed before refreshing the list. A refresh failure shows a saved receipt and prevents another submit. Validation failures preserve the draft. Pending writes cannot be cancelled as if aborted; cancelled lookups cannot reopen the dialog.
- Modal focus is contained, Escape cancels before submission, and focus returns on close. Touch targets are at least 44px. Warehouse navigation filters the immutable warehouse ID, independently of text search.
- The legacy list form also requires explicit quantity/reason, preserves its existing selectors, and closes only after successful completion.

This is inventory registration after a physical count. It does not associate a SKU with warehouses independently of a balance, transfer stock, deduct another warehouse, reserve stock, or introduce capacity/location rules. Cards show actual balance records (first four per card, with a link to all records), not a physical warehouse map.

## PostgreSQL counterexamples before production changes

Dedicated PostgreSQL 16.4 database; independent HTTP sessions use a restricted runtime role/pool. An owner coordinator installs temporary test-only triggers/advisory barriers and observes actual blocking with `pg_blocking_pids`. Ordering is established by database barriers, not a timed request delay. Helpers remove test triggers/roles and release transactions.

At the original accepted baseline `270175a289970586374dedca2525b42da522ae49` (inventory service unchanged at the new PR #14 baseline), `warehouse registration:` cases produced **2 failed / 3 passed / 19 skipped**:

1. Two first registrations reach the missing-row insert together: actual statuses **201 + 500**, expected **201 + 409**. One transaction hit the unique tuple error outside the intended conflict response.
2. Registration validates an active warehouse and pauses before insert; concurrent deactivation completes before registration is released: actual **201 + 200** with deactivation already committed. The state check was not protected for the registration transaction.

Only after these failures were observed, the production fix:

- Locks the validated active warehouse `FOR SHARE` until registration commits/rolls back, respecting the existing warehouse update `FOR UPDATE` lock.
- Uses the existing `(sku_id, warehouse_id)` unique key with `ON CONFLICT DO NOTHING`, translating a lost insert to existing `409 inventory_exists` before any movement/audit write.

No migration, constraint, business rule or permission changed. The serial outcomes are explicit: registration first → registration commits, then deactivation; deactivation first → registration waits and rejects the inactive warehouse. An inactive warehouse may retain inventory under the existing rules.

## Regression coverage

`apps/api/tests/integration/catalogInventory.test.ts` adds seven cases: duplicate first registration, registration-first deactivation, deactivation-first registration, already-inactive rejection, invalid quantities/CSRF/customer/sales rejection, movement failure rollback, audit failure rollback. Assertions include exactly one balance/initial movement/audit for the winner, correct movement delta and audit quantity/reason, no facts after rejected/rolled-back registration, and another warehouse's quantity/version unchanged. Existing tests cover duplicate 409, stale expectedVersion, adjustment races, reserved protection and restricted database grants.

`tests/warehouseInventory.test.tsx` adds 22 rendered tests covering the shared flows, invalid quantities/reasons, zero, double-submit protection, existing-only branch, expectedVersion forwarding, validation/network/refresh failures, lost committed response recovery, cancelled late lookup, inactive/forged drops, name-only edits, exact warehouse navigation and read-only users. The initial feature tests were red before UI implementation. The warehouse-code-prefix counterexample also failed before the ID-filter correction.

`tests/e2e-real/warehouse-registration.spec.ts` runs against the real stack on desktop 1440 and touch/mobile 390/430: native drag, selection, keyboard, focus trap, Escape/no POST, explicit registration, existing-only branch, real concurrent adjustment/409, source balance unchanged, and bilingual name editing with stable code/ID. It captures 1440/390 and resized 768/430 views, checks horizontal overflow and browser errors. The Browser plugin is unavailable; the repository's Playwright is used.

## Local final validation

- TypeScript, production build and asset verification; API TypeScript/build/unit checks.
- Full database integration suite: **6 files / 101 passed** (accepted baseline: 94).
- Full unit suite: **20 files / 140 passed**, including 22 warehouse UI cases (accepted baseline: 113).
- Mock browser suite: **100 passed / 32 existing skips**; production preview smoke: **1 passed**.
- Real catalogue, shared-cart/order/sales and warehouse browser suite: **7 passed** across desktop 1440 and touch/mobile 390/430.
- Docker smoke T01–T12, isolation/persistence and media restore security regression.

Local test infrastructure incidents: initial restricted local port access was rerun with the required local test permission; concurrent browser suites initially shared the default report directory and lost temporary artifacts. Final runs use separate report directories. The native desktop test also records a diagnosed cross-screen automation failure: `dragTo` auto-scrolled before emitting dragstart. The final test initiates a real mouse drag before target scrolling and moves over the target twice, following [Playwright drag guidance](https://playwright.dev/docs/input#dragging-manually). Observed browser events included dragstart, dragover, drop and dragend. These infrastructure/automation incidents required no application/workflow workaround.

Final SHA, Draft PR, exact-head Push/PR CI links, logs and screenshots are attached in the delivery evidence. No merge, production deployment or Phase 4B-05 work is included.

## Authorized PR #14 synchronization

Authorization: [Owner / ChatGPT comment 6738913777](https://github.com/rayleigh66/AK-Direct-UI/pull/15#issuecomment-6738913777). Source PR #14 is exactly `6bb1bba5230df915f30edadd6b11dc44e1ae42db`; pre-sync PR #15 is exactly `66342ed3e185b04a3721a62888d6b410fb8b45e8`. Both open/Draft heads were checked before modifications. Source baseline [Push 42608597692](https://github.com/rayleigh66/AK-Direct-UI/actions/runs/42608597692) and [PR 42608608020](https://github.com/rayleigh66/AK-Direct-UI/actions/runs/42608608020) completed successfully.

Synchronization uses a normal merge commit, without history rewrite. The only conflict is the warehouse-name-editor hunk in `src/real/views/SetupView.tsx`: keep the shared `WarehouseNameEditor` call, retain upstream `SelectAllOnFocusInput` import and SimpleCreate changes, and migrate both shared name fields to that input component. Validation/save/cancel/API/error behavior stays in the shared component. No second inline editor is restored.

Two new name-focus counterexamples failed with plain inputs, then passed after component adoption; another test preserves required-name validation, failed-save draft/error and cancel behavior. The real warehouse test checks renewed focus and same-session caret placement on both name fields, using actual touch at 390/430. A dedicated 430 project runs the complete warehouse flow with the admin fixture, avoiding reuse of already-changed customer temporary passwords. It explicitly reloads after a real stale-version 409 and confirms a separate adjustment with the fresh version.

Upstream hovered/damped wheel, per-focus selection, Chinese audit with raw expansion, ISO3/promotion touch controls, order colours/language, cart quantities and tier-tag files/tests remain unchanged against the new source baseline. The inventory service and PostgreSQL regression tests are unchanged against pre-sync PR #15; no API, migration or permission synchronization was necessary.

For local provenance, Mock/preview run on dedicated 3015/4175 ports with temporary configs outside the repository, strict-port/reuse disabled and this checkout as server cwd. The default ports belonged to another checkout, so their initial local passes were superseded. GitHub CI uses its existing clean runners; no workflow was changed. The final Owner-facing evidence records the merge/head SHA, full changed-file list relative to the new baseline, exact CI results and screenshots.
