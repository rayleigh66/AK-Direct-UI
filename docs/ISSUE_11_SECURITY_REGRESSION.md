# Issue #11 security regression evidence

Scope: [Issue #11](https://github.com/rayleigh66/AK-Direct-UI/issues/11), Owner authorization [6679739876](https://github.com/rayleigh66/AK-Direct-UI/issues/11#issuecomment-6679739876). Authorized baseline: `d291092f93e41642727fd5bdffaa5d6d1de01e8d`. Only stacked Draft PR #10 is updated; no merge, Issue #12 work, policy amendment or Phase 4B-05 implementation.

## Existing sales fix review

Retained the valid current-owner list query, immutable submission-time assignee, separate current-assignee DTO, additive migration 006, readiness requirement and limited runtime notification UPDATE grant. Sales detail now also applies `c.assigned_sales_user_id = $2` inside its SQL query, returning 404 before loading order lines/history for non-owners. Administrator read-all is unchanged.

Notification insertion reads the current company assignee under `FOR SHARE`; reassignment locks the company `FOR UPDATE` and cancels former-owner pending rows in the same transaction. Existing pending rows are cleaned by migration 006. Customer/sent history is preserved. Submission and customer modify/cancel acquire the company lock before their order work; destructive actions lock affected companies before order cancellation. Existing concurrent admin/submit tests are retained. The new test observes a real PostgreSQL lock wait during an in-flight notification transaction and an HTTP reassignment, then verifies cancellation after release and routing of subsequent events only to the new owner. Unassigned companies generate customer notifications only.

There is **no notification sender** in the current source tree: notifications remain outbox rows. This change does not implement email delivery or certify a future sender. A future sender must process only eligible pending rows and revalidate current authorization before delivery, including races with reassignment; cancelled rows must never be retried as pending.

## Cart confidentiality contract

For missing brand authorization or unpublished products, the server constructs an explicit allowlist:

```json
{
  "detailsRestricted": true,
  "skuId": "opaque cart line identifier",
  "quantity": 10,
  "isAvailable": false,
  "issues": ["Your company is no longer authorized for this brand."],
  "updatedAt": "cart line timestamp"
}
```

No product/brand identifiers, product or SKU codes, titles, descriptions, colors, media URLs, unit/line prices or stock counts survive. Safe issues do not derive from restricted stock/SKU state. Restricted lines contribute no reference amount. The shared line/revision remains intact and explicit removal still requires company scope, CSRF and the expected revision. Re-grant rehydrates from current authorized data. Authorized discontinued SKUs remain visible but unorderable; unpublishing removes catalogue visibility and receives the restricted projection. Cart conflict DTOs from both cart writes and order submission use the same projection. Submission eligibility errors also use generic text after withdrawal of catalogue access.

The React client models restricted lines as a separate union member and renders only an unavailable explanation, quantity and remove control. It does not fabricate a line price or request protected media.

## Failure-before / pass-after

All DB tests use a dedicated PostgreSQL 16.4 container on loopback port 55441, exact `aoking_test/aoking_direct_test` identity, `NODE_ENV=test` and `TEST_DATABASE_DESTRUCTIVE=yes`. No existing database/volume was reused. Raw cart tests run HTTP operations through a provisioned non-owner runtime database role.

| Regression | Failure before repair | Passing evidence |
|---|---|---|
| Current company ownership | Existing current-owner regression copied into a separate archive of `00d92c6`; after A → B, A's list still included the order (1 failed, 15 skipped). The authorized checkout was not reset or overwritten. | Current integration suite: A excluded/direct 404, B list/detail allowed, admin unchanged, snapshot preserved, old pending rows cancelled, modify/cancel/admin-cancel route to B, unassigned new events have no sales recipient. |
| Revoked grant / unpublished cart | On `d291092`, the new tests returned price, title, color, stock and media instead of the restricted object (2 failed, 16 skipped). | Exact raw JSON equality plus protected-value absence; catalogue list/detail and direct media denied; cart and order conflict DTOs redacted; explicit removal and CSRF/company isolation; re-grant restores price/media. |
| Revoked-grant submit error | After cart projection repair, an extra negative case still exposed `AKO-0001` in the `brand_not_authorized` message (1 failed, 18 skipped). | Same HTTP submission returns a generic error without product/SKU code. |
| Open browser revoke → restore → remove | Previously the server supplied full commercial line data. | Real-order Playwright at desktop 1440 and mobile 390: an independently logged-in admin revokes while customer session remains open; refresh shows no protected line text, image, price or edit controls; re-grant restores $42.00; revoke/remove empties the cart; no page errors or horizontal overflow. |

## Local validation

- Authorized baseline: 58/58 DB tests passed before changes.
- Final DB suite: **61/61 passed** across five files, including real restricted-role writes, auth/RBAC, cross-company and concurrency cases.
- Frontend TypeScript, 101 tests, production build and asset verification: **PASS**.
- API TypeScript, build and 25 unit tests: **PASS**.
- Mock Playwright: **90 passed / 18 intentionally skipped**; production preview: **1 passed**. `VITE_REAL_AUTH=false` was explicit for Mock checks.
- Real-auth catalogue/shared-cart/order/sales and new revocation UI flow: **4/4 passed**, desktop 1440 and mobile 390, isolated Compose project `aoking-issue11-e2e`, port 18141.
- Docker smoke/persistence and media restore results, exact final SHA and both four-job GitHub CI run links are recorded in PR #10's final delivery comment.

Initial sandbox EPERM failures were rerun with local network permission. Docker Desktop's credential helper stalled public image resolution; a separate temporary Docker config using the existing context/plugins and no stored credentials resolved it. Repository Dockerfiles, credentials and user Docker configuration were not changed. The unchanged Vite build still emits its >500 kB chunk advisory.

Not run: production deployment, real outbound email, actual handheld devices, a future sender's delivery race behavior. ChatGPT acceptance remains pending; green tests are not acceptance.
