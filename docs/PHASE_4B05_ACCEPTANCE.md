# Phase 4B-05 — Acceptance Evidence

Status: local branch prepared for Draft PR review. Push, PR and CI status are
determined by the actual GitHub state; this document does not assert them.
Authoritative contract: [Phase 4B-05 Order Confirmation](PHASE_4B05_ORDER_CONFIRMATION.md).
Baseline: `main` at `9d0d3bce992384e9fa93fb638ff3d619f4c4a3b4`.
Branch: `feat/phase-4b05-order-confirmation`.

## 1. Work delivered

- Additive migration `007_order_confirmation.sql`: `business_admin`, approval
  permissions, widened order-number CHECK, plan/approval/acceptance,
  authorization instances, reservation lines/ledger, final snapshots,
  extension/release/deadline/idempotency tables, and two narrow
  `SECURITY DEFINER` functions for reserve/release accounting.
- Real backend: plan epochs and price approval, buyer authority lifecycle,
  formal confirmation with per-warehouse allocations, deadline extension,
  expiry scan/reminders, verified full release, audit/notification/outbox and
  idempotency.
- Runtime-role least privilege: no generic `UPDATE reserved`, no `FOR SHARE` on
  immutable plan lines, SELECT-only ledger, `EXECUTE` on the narrow functions.
- Real UI: sales plan/confirmation and allocation editor, customer
  accept/reject and reservation display, approvals queue/detail, buyer-authority
  grant/revoke, extension/release requests, drawer-scoped feedback.
- Tests and ops: unit/integration/component/Real Playwright coverage, isolated
  Real stack image tags/project/port and forced real-auth mode.
- Compatibility evidence: a new 006 → 007 upgrade rehearsal seeds historical
  `ODYYMMDDNNNN` orders, status history, an outbox row and the daily sequence,
  applies 007 (and again as a no-op) and verifies they are byte-for-byte
  unchanged. New-format numbers coexist with legacy numbers under the shared
  UNIQUE/CHECK and daily sequence.
- This review round also fixed the defects listed in §2.1 and added regressions
  for each one.

## 2. Local verification on this head (2026-11-12)

Commands were run in the isolated worktree. The database suite used the
dedicated loopback test database (`aoking_test` / `aoking_direct_test`) with the
explicit destructive opt-in; the Real suite used an isolated Compose project
(`akd4b05-verify`, image tags `akd4b05-verify-*`, port `18705`) and rebuilt its
own volumes. No production config, database, Compose project, secret or
business data was read.

| Check | Result |
| --- | --- |
| `npm run lint` | pass |
| `npm run api:lint` | pass |
| `npm test` | 25 files / 181 tests pass |
| `npm run build` | pass (chunk-size warning only) |
| `npm run verify:assets` | pass (4 hashed images, no source-image references) |
| `npm run api:build` | pass |
| `npm run api:test` | 7 files / 30 tests pass |
| `npm run api:test:db` | 8 files / **138 tests pass** (isolated PostgreSQL 16.4) |
| Real E2E, isolated Compose at 18705 | **31 tests: 22 passed, 9 viewport skips, 0 failed** |
| `npm run test:e2e` | 101 passed, 35 skipped by viewport, 0 failed |
| `npm run test:e2e:preview` | 1 passed |
| `git diff --check` | pass |

### 2.1 Defects found and fixed in this review round

1. **Price approval stranded after a quantity-only edit.** The approval queue
   sends the request-time plan version; the decision service required the
   current plan version, so a quantity-only v(n+1) made the pending approval
   undecidable. The decision now accepts the request-time or current version and
   still requires the current plan's price fingerprint/epoch to match.
   Regression: `decides a pending price approval that survived a quantity-only
   plan edit`.
2. **The buyer could not reject a price-pending plan.** The price-approval gate
   ran before the outcome branch. It now applies only to `ACCEPTED`; rejection
   records a plan outcome and never cancels the order. The DTO exposes
   `canReject`/`canRejectPlan`, and the UI shows reject while acceptance stays
   gated. Regression: `lets the buyer reject a plan while its price change is
   pending approval`.
3. **Destroying pending orders left an ACCEPTED plan and an active acceptance.**
   Administrative cancellation now supersedes the current plan, invalidates
   acceptances and supersedes pending price approvals in the same transaction.
   Regression: `supersedes plans, acceptances and pending price approvals ...`.
4. **Server errors were cleared immediately by the follow-up refresh.** The
   drawer now preserves the error while refreshing authoritative state, keeps
   the user's drafts, scrolls the drawer body to the feedback, and the E2E
   asserts the visible `order-drawer-error` for missing release verification.
5. **Approval decision errors were not visible inside the drawer.** They are
   now rendered in the open approval drawer; already-decided requests are
   read-only instead of offering buttons that return 409.
6. **Release/extension forms did not enforce the API's required evidence.**
   Extension requires a reason and a 1–240 hour integer; release requires a
   reason, a verification note and explicit “unpaid”/“not shipped” checkboxes.
7. **Reservation deadlines were date-only.** The customer and approval views now
   show date and time for the 72h/312h continuous instants.
8. **Expiry scan races and reminder idempotency.** Scans are serialised with a
   transaction-scoped advisory lock, the reminder deadline is read from the
   row (PostgreSQL microseconds preserved), and a pre-existing reminder no
   longer suppresses the `EXPIRED` transition. The scan response reports
   `scanned/expired/reminded/skipped`. Regressions cover repeated scans,
   pre-existing reminders and the full extension/release flow.
9. **Internal release text could reach customer outputs.** A release reason over
   500 characters caused a 500 at approval; the request now rejects it as a 400.
   The customer-facing cancellation fields are generic, `releaseReason` is
   internal-only in the DTO, and the customer-addressed outbox message no longer
   interpolates the release reason. A marker regression
   (`keeps internal release reasons and verification notes out of every customer
   output`) runs the full two-warehouse release and asserts the marker is absent
   from every `audience='customer'` notification, the customer DTO and history,
   while the internal request, reservation, audit and authorized sales view
   retain it.
10. **Malformed identifiers returned 500.** Order/approval `:id` parameters and
    allocation `skuId`/`warehouseId`/`acceptanceId` are validated as UUIDs and
    return 400 `invalid_request`.
11. **Order-number date used the application clock.** The business date and
    `YYMMDD` part now come from one PostgreSQL `clock_timestamp()` evaluation
    in the configured business time zone, consistent with `submitted_at`.
12. **Frozen timestamps could predate the locked confirmation.** The immutable
    confirmation and approval timestamps now use the same database-clock value
    or `clock_timestamp()` after locks.
13. **Database hardening.** `order_reservations` now enforces
    `hard_deadline_at = confirmed_at + 312h` and `expires_at <= hard_deadline_at`
    in SQL; the runtime role's `order_release_requests` INSERT grant is
    column-restricted so it cannot forge an approved request; the release
    bridge drops both historical function signatures.
14. **Test evidence added:** 006→007 historical-data rehearsal, shared daily
    sequence and 9999 exhaustion, unknown/inactive warehouse rejection,
    two-warehouse release + customer reorder, revoke-before-confirm,
    quantity-only acceptance invalidation, self-approval, rejected and buyer-
    rejected plans, duplicate extension replay/pending refusal, 72/240/312
    boundaries, reconciliation, runtime least-privilege full flow (including
    DELETE and forged-release denial), and the ordinary-buyer/revoke/re-accept
    Real UI flow at 1440 and 390.

## 3. Earlier independent reviewer evidence (pre-fix head)

Recorded from Codex's isolated PostgreSQL/Compose runs on the earlier head, not
re-labelled as this round's local runs:

- Earlier 4B-05 PostgreSQL regression: 103/103 pass.
- Runtime HTTP flow: submit → price change → self-approval → buyer acceptance
  → two warehouses 12/8 reserved with `on_hand`/`unsellable` unchanged →
  same-key confirmation replay → 72h + 24h extension → repeated expiry scans
  produce one reminder while stock stays held → unknown payment verification
  rejected → approved full release and replay → customer `CANCELLED` with
  `reserved` zero.
- Permission barrier: after the company lock wait, deleting the sales role
  makes confirmation return 403 and reserve no stock (session/permission
  re-read inside the transaction).
- Cross-company last-stock race: one confirmation succeeds, the other returns
  409 with no reservation; revoke-first/confirm-first and re-grant/old-key
  barriers pass.
- Final independent full database suite: **118/118 pass across 7 files** on
  the committed head, including the fixed concurrency barrier. The barrier now
  walks the recursive blocker chain so the inventory row is released only after
  both HTTP confirmation transactions are queued; the assertion remains exactly
  one success and one `409 insufficient_stock`, with no reservation, ledger,
  success audit or `CONFIRMED` history for the failed order. Earlier fixture
  fixes in the same suite were the non-existent `inventory_balances.id`
  (`SELECT sku_id`) and an extra unused product in the expiry scenario (now uses
  the product returned by `createConfirmedOrder`).
- Latest complete Real regression: 20 passed and 9 skipped by existing viewport
  conditions. The new 1440 desktop and 390 mobile flows passed through
  buyer-authority grant/revoke/re-grant, price approval, acceptance,
  two-warehouse confirmation, extension, approved release and the customer
  `CANCELLED` state.

The committed tree passes `git diff --check`. The §2 runs above were executed
on the final head; §3 is retained only as earlier independent evidence.

## 4. Acceptance matrix

| Area | Evidence |
| --- | --- |
| Migration | 007 applies after 001–006; a 006 fixture with historical orders, history, outbox and sequence applies 007 twice with no rewrite; readiness expects `4b05` |
| Order numbers | New `OD-YYMMDD-NNNN` and legacy `ODYYMMDDNNNN` coexist; shared daily sequence; 9999 succeeds and the 10000th is refused `503 order_sequence_exhausted`; DB-clock business date; malformed format rejected |
| Plans/prices | Raise/lower/revert epochs, quantity-only inheritance, pending approval surviving a quantity-only edit, stale/rejected approvals, self-approval with both roles, buyer rejection, quantity-only acceptance invalidation |
| Authorization | Per-account grant/revoke/re-grant, PENDING-only acceptance invalidation, plan restored to `SUBMITTED`, confirm-after-revoke blocked without stock, confirmed evidence retained, customer DTO hides internal release evidence |
| Confirmation | Allocation UUID/duplicate/sum validation, unknown/inactive warehouse rejection, two-warehouse split, deterministic locks, atomic final snapshot and idempotent replay |
| Concurrency | Company-lock permission barrier; two companies queued on one last-stock row using a recursive blocker chain (one 200, one 409, no failed reservation/ledger/audit/history); scan serialisation |
| Warehouse | Two-warehouse reserve **and release**, sellable formula, `on_hand`/`unsellable` unchanged, reconciliation endpoint returns no mismatches, customer can reorder |
| Deadline | 72h/240h/312h boundary tests, DB clock after locks, advisory-locked at-expiry scan, pre-existing reminder does not suppress expiry, stock held, extension recovery |
| Release | Unpaid/not-shipped verification (unknown/paid/shipped refused), over-long reason 400, approved-release binding in SQL, column-restricted request INSERT, single ledger application, no double deduct; release reason/verification note/decision note absent from every customer notification, DTO and history while retained in internal evidence |
| Security | Router-level CSRF probes on every new write entry; foreign salesperson/customer 404; malformed UUID 400s; runtime-role DELETE and forged-release denial; full extension/release flow under the runtime role |
| UI | Real plan/approval/acceptance/confirmation/extension/release at 1440 and 390; ordinary buyer has no accept/reject control; revoke invalidates acceptance and re-grant requires fresh acceptance; required release evidence; visible in-drawer errors/notices |
| Delivery | Local commits prepared for Draft PR review; push/PR/CI state per GitHub; no merge/deploy in this worktree; isolated test stack required |

## 5. Remaining acceptance blockers

These are business decisions, not implementation defects; see PRD §9:

1. Overdue-recovery policy only. The Owner-confirmed 3 + 10 day rule (72h
   initial, at most 240h additional, 312h hard ceiling) is implemented as
   continuous hours and is no longer an open duration question.
2. Whether buyer-confirmation authority is capped at one account per company.
3. Production `business_admin` users and any extra `sales.write` grants.
4. Price policy beyond "any manual change needs approval".
5. Destructive product/brand/company exception policy (implementation allows
   the action, audits and alerts, but never releases stock; warehouse
   deactivation remains blocked).
6. External notification channels.

Production use also remains blocked on the GitHub PR/CI result, the pending
Owner business decisions and a separately authorised deployment.
