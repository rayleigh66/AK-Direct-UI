# Formal-version remaining modules — dependency and risk order

Status: planning baseline, partly superseded. Order confirmation and stock
reservation (items 1 and 3, plus the manual price-approval path inside item 2)
are implemented on the local `feat/phase-4b05-order-confirmation` branch; see
[Phase 4B-05](../PHASE_4B05_ORDER_CONFIRMATION.md). Payment, shipping, WMS,
promotions/tier pricing and external notification channels remain unimplemented
and unapproved. The frozen rules in `AKD-BD-3C-001` remain authoritative.
Modules marked **high risk** still require an approved contract, transaction
design and counterexample tests before further implementation.

The current formal slice adds administrator customer management on top of the
latest PR #16. It introduces no pricing, reservation, payment or fulfilment
semantics.

## Order (each item depends on the ones above it)

### 1. Sales order confirmation — high risk

- **Depends on:** existing customer order submission (`SUBMITTED`, pending
  confirmation), current order revisions and destructive-impact tokens.
- **Frozen rules needed:** who may confirm (`sales.write` vs `sales.read_all`),
  the exact confirmation status names, whether confirmation may change lines or
  prices, and which downstream actions a confirmation unlocks.
- **Contract to approve first:** `POST /api/sales/orders/:id/confirm` with
  `expectedRevision`, idempotency key, actor/audit record, allowed
  transitions and a stable error set (`revision_conflict`, `invalid_status`,
  `forbidden`).
- **Transaction design:** one transaction that locks the order, re-checks the
  revision and status, writes the transition and its audit row, and returns the
  updated order.
- **Counterexample tests:** confirm twice, confirm a cancelled order, two
  concurrent confirmations, confirmation after a brand revoke/company suspend,
  and an out-of-scope salesperson.
- **Gate:** do not implement until the state names and actor rules are approved.

### 2. Final pricing, customer tiers and promotions — high risk

- **Depends on:** confirmation semantics (pricing is snapshotted at or before
  confirmation) and the existing `base_reference` quote.
- **Frozen rules needed:** tier definition source, discount stacking/priority,
  rounding and currency, effective dates, whether prices are snapshotted at
  submission or confirmation, and override authority.
- **Contract to approve first:** a deterministic pricing function contract,
  versioned rule snapshots, and an explainable `priceSource` on every line.
- **Transaction design:** price calculation is a pure, tested function; the
  confirmed order stores the rule version and line snapshots atomically.
- **Counterexample tests:** boundary quantities, stacked discounts, rounding
  half-up/half-even, expired/overlapping rules, and a rule change between
  submission and confirmation.
- **Gate:** `TierPreviewView` stays a clearly labelled UI preview; no preview
  value may be written to an order.

### 3. Stock reservation — high risk

- **Depends on:** order confirmation and the existing inventory versions
  (`on_hand`, `reserved`, `unsellable`, `available`).
- **Frozen rules needed:** when reservation is taken (submission vs
  confirmation), reservation lifetime, partial availability, release on
  cancel/modify, and whether allocation is per warehouse or pooled.
- **Contract to approve first:** reserve/release commands keyed by order line
  and warehouse, an idempotency key, and a reconciliation endpoint.
- **Transaction design:** row locks on inventory, a reservation ledger with
  unique `(order_line, warehouse)` keys, and all-or-nothing reservation for
  the approved scope.
- **Counterexample tests:** two orders competing for the last unit, modify
  after reserve, cancel after reserve, duplicate callbacks, and negative
  `available`.
- **Gate:** do not deduct on-hand or invent a reservation lifetime.

### 4. Payment recording — high risk

- **Depends on:** confirmed orders and the approved reservation model.
- **Frozen rules needed:** supported methods, manual vs provider integration,
  currency/FX, partial payments, refunds and the paid/unpaid state machine.
- **Contract to approve first:** payment intent/record schema, idempotent
  external references, webhook signature handling (if any), and reconciliation.
- **Transaction design:** append-only payment ledger; order status derives from
  ledger totals, never from a mutable boolean.
- **Counterexample tests:** duplicate webhook, partial then full payment,
  refund after shipment, amount/currency mismatch, and replay attacks.
- **Gate:** no payment provider or accounting policy is chosen by engineering.

### 5. Shipping and delivery tracking

- **Depends on:** confirmation, reservation and payment status.
- **Frozen rules needed:** fulfilment states, partial shipment, carrier/tracking
  fields, delivery confirmation authority and customer-visible notes.
- **Contract to approve first:** shipment and shipment-line resources,
  idempotent status transitions, and the customer-visible projection.
- **Transaction design:** shipment creation locks the order lines and records
  quantities; status changes append audit rows.
- **Counterexample tests:** over-shipment, double shipment, cancel after
  shipment, and tracking updates after delivery.
- **Gate:** no carrier integration until the data contract is approved.

### 6. Notifications and audit visibility

- **Depends on:** the transitions above; the audit log already exists.
- **Frozen rules needed:** notification channels, recipients, templates,
  language and retry/retention policy.
- **Contract to approve first:** an outbox event envelope and a recipient
  projection that never leaks internal fields to customers.
- **Counterexample tests:** retry without duplication, recipient scope change,
  and customer-safe payloads.
- **Gate:** no email/SMS provider selection without approval.

### 7. Local WMS synchronization — high risk

- **Depends on:** reservation and inventory versioning.
- **Frozen rules needed:** source of truth, SKU/warehouse mapping, conflict
  resolution, sync frequency and failure handling.
- **Contract to approve first:** an idempotent batch contract with per-row
  results, a mapping table and a reconciliation report.
- **Transaction design:** apply per-row with version checks in a bounded
  transaction; never overwrite a newer local change silently.
- **Counterexample tests:** duplicate batch, out-of-order updates, unknown
  SKU/warehouse, and a version conflict.
- **Gate:** no automatic inventory write may bypass preview/confirm.

## Explicit non-goals for this slice

- No Phase 4B-05 work.
- No merge of any PR, no production deployment.
- No new pricing, reservation, payment, shipping or WMS policy.
- No Mock project, new Compose project, volume or database.
