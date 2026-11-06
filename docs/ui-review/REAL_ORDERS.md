# Real-Mode Shared Cart and Orders — UI Review

Phase 4B-04 real-auth screens. The default Mock application is unchanged.

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
- Sales confirmation is visibly disabled and labelled Phase 4B-05.
- The admin catalogue shows an impact dialog listing affected pending orders before unpublishing or discontinuing.

## Responsive verification

Playwright asserts `scrollWidth - clientWidth <= 1` at 375, 390, 430, 768 and 1440 px for the shared cart, and at 390/1440 for success, customer orders and sales orders. This is browser emulation, not real-device acceptance.
