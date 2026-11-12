# Real-Mode Shared Cart and Orders — UI Review

Phase 4B-04 real-auth screens, extended by the Phase 4B-05 confirmation flow.
The default Mock application is unchanged.

## Phase 4B-05 screens and states

| Screen | Desktop 1440 | Mobile 390 |
| --- | --- | --- |
| Buyer-authority grant/revoke (Approvals) | `real-orders/approvals-confirmers-real-desktop-1440.png` | `real-orders/approvals-confirmers-real-mobile-390.png` |
| Sales plan with changed price pending approval | `real-orders/sales-plan-pending-real-desktop-1440.png` | `real-orders/sales-plan-pending-real-mobile-390.png` |
| Customer plan accepted | `real-orders/customer-plan-accepted-real-desktop-1440.png` | `real-orders/customer-plan-accepted-real-mobile-390.png` |
| Two-warehouse confirmation | `real-orders/sales-confirmed-real-desktop-1440.png` | `real-orders/sales-confirmed-real-mobile-390.png` |
| Confirmed then fully released, customer view | `real-orders/customer-released-real-desktop-1440.png` | `real-orders/customer-released-real-mobile-390.png` |

Screenshots are emitted only when `REAL_E2E_SCREENSHOTS=1` is set.

## Phase 4B-05 interaction notes

- Business administrators and system administrators manage buyer-confirmation
  authority from the Approvals screen, selecting the company by customer code
  and the account by username.
- Sales build the complete plan in the shared order drawer. Quantity-only edits
  keep the current approval state; a price change shows the pending approval
  and blocks customer acceptance until decided.
- Customer acceptance is inline on the order detail. The customer sees plan
  lines, totals, pending approval and the confirmed reservation deadline.
- Confirmation is performed in the shared drawer with explicit per-line,
  per-warehouse allocation rows. A second warehouse row can be added per SKU.
- Extension and release success/error feedback is rendered **inside the active
  drawer** (`role="status"` / `role="alert"` with
  `data-testid="order-drawer-notice"` and `order-drawer-error`), so it is
  visible on both desktop and mobile.
- The customer sees the final cancelled state and released reservation after
  the approved full release.

## Screens

| Screen | Desktop 1440 | Mobile 390 |
| --- | --- | --- |
| Company shared cart + delivery form | `real-orders/shared-cart-real-desktop-1440.png` | `real-orders/shared-cart-real-mobile-390.png` |
| Order success (real order number) | `real-orders/order-success-real-desktop-1440.png` | `real-orders/order-success-real-mobile-390.png` |
| Customer company orders + pending edit | `real-orders/customer-orders-real-desktop-1440.png` | `real-orders/customer-orders-real-mobile-390.png` |
| Customer cancelled order + history | `real-orders/customer-orders-cancelled-real-desktop-1440.png` | `real-orders/customer-orders-cancelled-real-mobile-390.png` |
| Assigned sales pending order (read-only) | `real-orders/sales-pending-orders-real-desktop-1440.png` | `real-orders/sales-pending-orders-real-mobile-390.png` |

Additional width checks for the shared cart: `shared-cart-375.png`, `shared-cart-430.png`, `shared-cart-768.png`.

## Interaction notes

- Customer pages are English-only. Internal sales/admin pages keep bilingual labels.
- The header cart badge shows line count and total pieces; the sign-out button collapses to an icon on phone widths.
- Quantity changes require the MOQ (10) and use a server-returned revision; version conflicts show the latest cart.
- Unavailable lines stay visible with an explicit issue message and block submission.
- The delivery draft is stored locally per company and cleared only after a successful submission; the server snapshot is authoritative.
- The success page shows the real `OD + YYMMDD + sequence` number, total pieces and reference amount. It states clearly that stock is not reserved.
- Sales confirmation is enabled only for the current assigned salesperson with `sales.write`; the Phase 4B-04 disabled placeholder has been replaced by the 4B-05 plan/confirmation flow.
- The admin catalogue shows an impact dialog listing affected pending orders before unpublishing or discontinuing.

## Responsive verification

Playwright asserts `scrollWidth - clientWidth <= 1` at 375, 390, 430, 768 and 1440 px for the shared cart, and at 390/1440 for success, customer orders and sales orders. This is browser emulation, not real-device acceptance.
