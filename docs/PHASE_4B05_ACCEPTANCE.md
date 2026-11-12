# Phase 4B-05 — Acceptance Evidence

Status: local review branch, not pushed, no PR, no merge, no deployment.
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

## 2. Local no-credential checks (2026-11-12)

Commands were run in the isolated worktree. No production config, database,
Compose project, secret or business data was read.

| Check | Result |
| --- | --- |
| `npm run lint` | pass |
| `npm run api:lint` | pass |
| `npm test` | 25 files / 181 tests pass |
| `npm run build` | pass (chunk-size warning only) |
| `npm run verify:assets` | pass (4 hashed images, no source-image references) |
| `npm run api:build` | pass |
| `npm run api:test` | 7 files / 30 tests pass |
| `npm run test:e2e` | 101 passed, 35 skipped by viewport, 0 failed |
| `npm run test:e2e:preview` | 1 passed |
| `git diff --check` | pass |

The API database suite requires an explicit loopback test database
(`TEST_DATABASE_URL` + destructive opt-in); it was not run from this shell.

## 3. Independent reviewer evidence

Recorded from Codex's isolated PostgreSQL/Compose runs, not re-labelled as local
runs:

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
- Latest full database suite: 116/118. The two remaining failures were test
  fixture errors, now fixed: the new concurrency barrier selected a non-existent
  `inventory_balances.id` (now `sku_id`), and the expiry scenario queried an
  extra unused product instead of the product returned by
  `createConfirmedOrder`.
- Latest complete Real regression: 20 passed and 9 skipped by existing viewport
  conditions. The new 1440 desktop and 390 mobile flows passed through
  buyer-authority grant/revoke/re-grant, price approval, acceptance,
  two-warehouse confirmation, extension, approved release and the customer
  `CANCELLED` state.

The two database fixture fixes and the final `git diff --check` were applied
after that run and are queued for the reviewer's re-run.

## 4. Acceptance matrix

| Area | Evidence |
| --- | --- |
| Migration | 007 applies after 001–006; readiness expects `4b05`; 006-only drift test updated |
| Order numbers | New `OD-YYMMDD-NNNN`, legacy accepted, shared sequence/9999 guard tested |
| Plans/prices | Epoch semantics, revert-to-reference, quantity-only inheritance, stale/rejected approvals, acceptance invalidation |
| Authorization | Per-account grant/revoke/re-grant, PENDING-only invalidation, plan restored to `SUBMITTED`, confirmed evidence retained |
| Confirmation | Allocation normalization/validation, two-warehouse split, deterministic locks, atomic final snapshot and idempotent replay |
| Concurrency | Company-lock permission barrier; two companies queued on one last-stock row (one 200, one 409, no failed reservation/ledger/audit/history) |
| Warehouse | Two-warehouse reserve/release, sellable formula, `on_hand`/`unsellable` unchanged, reconciliation endpoint |
| Deadline | 72h/240h/312h checks, DB clock after locks, at-expiry-only reminder, stock held, extension recovery |
| Release | Unpaid/not-shipped verification, approved-release binding in SQL, single ledger application, no double deduct |
| Security | Router-level CSRF probes on every new write entry; foreign salesperson/customer 404; runtime-role forbidden SQL |
| UI | Real plan/approval/acceptance/confirmation/extension/release at 1440 and 390, drawer-visible notices/alerts |
| Delivery | Local commit only; no push/PR/merge/deploy; isolated test stack required |

## 5. Remaining acceptance blockers

These are business decisions, not implementation defects; see PRD §9:

1. Exact 72h/240h/312h values and overdue-recovery policy.
2. Whether buyer-confirmation authority is capped at one account per company.
3. Production `business_admin` users and any extra `sales.write` grants.
4. Price policy beyond "any manual change needs approval".
5. Destructive product/brand/company exception policy (implementation allows
   the action, audits and alerts, but never releases stock; warehouse
   deactivation remains blocked).
6. External notification channels.

Production use also remains blocked on the reviewer's isolated re-run, CI, the
pending Owner business decisions and a separately authorised deployment.
