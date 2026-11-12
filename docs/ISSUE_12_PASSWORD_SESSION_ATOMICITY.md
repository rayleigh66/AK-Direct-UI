# Issue #12 — Password and session atomicity investigation

## Disposition and baseline

**REPRODUCED.** The inherited implementation permits sessions authenticated using replaced credentials to survive a subsequent password change. It also permits late session insertion after suspension has revoked the account's earlier sessions, and partial credential/session state after a database failure. These are confirmed confidentiality/session-revocation defects, beyond a source-indicated race; the original P1 investigation warrants security reprioritization by Owner/ChatGPT.

Accepted base: PR #10, `9b52367616ab6dcbef37c6844c9013b72d06c041`. Work is isolated on `fix/password-session-atomicity-issue12`, targeting a new stacked Draft PR with base `feat/cart-orders-4b04`. PR #10 and earlier branches, migrations and frozen business policies are unchanged. No merge or Phase 4B-05 implementation.

## Deterministic reproduction

`apps/api/tests/integration/passwordConcurrency.test.ts` uses PostgreSQL 16.4, a fresh exact `aoking_test/aoking_direct_test` database on loopback port 55442, and a provisioned restricted runtime role. Independent Express instances/pools have distinct PostgreSQL application names. HTTP authentication, CSRF, scrypt, database queries, token creation and audit persistence use production code and actual database results.

Test-only PostgreSQL triggers pause password updates and session inserts on advisory **transaction** locks held by independent coordinator connections. `pg_blocking_pids()` confirms actual row/advisory waits; sleeps only yield while polling an observed condition. No arbitrary delay determines the schedule, no hash/query/session mocks are used, and no production test hooks are introduced. Suspension is performed by an independent restricted-role SQL transaction using the existing update-and-revoke semantics. This covers internal account suspension even though no new internal administration endpoint is introduced; these particular suspension races do not test the customer admin HTTP endpoint (the existing auth/RBAC suite covers that endpoint).

### Two changes using the same original password

1. A verifies the original password and pauses in the password UPDATE, holding the account row.
2. B verifies the same original hash and waits on A's account row.
3. Release A's password UPDATE, but hold A immediately before inserting its new session.
4. On the old source, B replaces the password, revokes earlier sessions and commits its own session while A's new session does not yet exist.
5. Release A's insertion. The old source now has two live sessions even though only B's password is current.

Observed for **both customer and internal accounts** on the accepted source:

```text
change statuses: [200, 200]
active sessions: 2
password A matches final hash: false
password B matches final hash: true
session A HTTP status: 200
session B HTTP status: 200
PASSWORD_CHANGED audits: 2
```

The repaired flow produces A=200, B=401, one eligible replacement session and one password-change audit. A's new password matches the database, B's does not, and both original sessions are revoked.

### Verified login versus password replacement

An old-password login paused immediately before session INSERT can survive B's completed password change in the old source (two active sessions, late login HTTP 200). Conversely, if a password-replacement transaction wins the account lock while login is verifying the previous committed hash, the old source still issues a session after the replacement. Both directions are tested for both principal types. The repaired flow either commits login before the change (which then revokes its session), or rejects the stale verified hash with 401.

### Suspension and already-authenticated requests

For customer/internal accounts and customer companies, login or password-change session insertion can commit after suspension's revocation on the old source. A newly inserted row remains unrevoked and becomes usable again after reactivation without new authentication (HTTP 200). The repaired issuer and suspender serialize on the same account/company row: suspension either rejects issuance or revokes the issuer's committed session, and reactivation does not revive it (HTTP 401).

Additional barriers invalidate a password-change request's authenticating session after middleware authentication but before the account lock, using revocation, idle expiry and absolute expiry. The repaired service rejects all three and does not replace the password or issue a session.

### Database failures

Real triggers raise errors during session revocation, session insertion and success audit insertion. On the old source, a failed change can still replace the password and clear the first-login flag, revoke earlier sessions without replacement, or leave an unaudited session. A failed login can commit last-login state or an unaudited session. The repaired flow rolls back all these facts together. Failure responses never set a replacement session cookie; renewal of the existing double-submit CSRF cookie is expected and retained.

## Minimal repair

Production changes are restricted to `auth/service.ts` plus query-capable transaction-client parameter types in `auth/session.ts` and `auth/loginAttempts.ts`.

- Keep real scrypt verification and new-password hashing outside row locks.
- Enter one `withTransaction()` scope. For customers, lock the company `FOR SHARE` before the account; lock the account `FOR UPDATE` for both principal types. This matches existing company/account suspension writers and serializes all successful login/password-change session issuance for an account.
- Under that lock, re-read current status and compare the verified stored hash to the current stored hash. A changed password version or inactive account/company fails closed.
- For a password change, also revalidate and lock its authenticating session, checking owner, token hash, revocation, idle and absolute expiry. This handles middleware authentication that predates a concurrent revoke/expiry.
- Atomically update the password/first-login flag/timestamp, revoke earlier sessions, create the replacement and write `PASSWORD_CHANGED` audit using that same client. The HTTP cookie is only set after commit.
- Login uses the same lock/hash validation ordering; login timestamp, failure-counter cleanup, session insertion and `LOGIN_SUCCESS` audit share a transaction. A stale/invalid login still uses the existing login-failure/lockout accounting.
- Helpers accept a query-capable sink so a real `PoolClient` can be passed; runtime SQL grants and migrations do not change.

Login still allows multiple ordinary sessions. Password policy, scrypt parameters, first-login enforcement, role/permission checks, CSRF, cookie attributes, and configured idle/absolute lifetimes are unchanged. No token or password plaintext is persisted or included in audit details.

## Test evidence

The first 22 tests were executed **before any production edits**: 20 expected assertion failures and two existing-contract passes confirmed the defect. After expanding reverse-order and expiry coverage, the final 33-test file was also run against a separate untouched archive of accepted `9b52367`: **31 failed / 2 passed**, with no scheduling-barrier, connection or deadlock failures. The accepted working checkout was not reset or overwritten.

Final repaired database suite: **94/94 passed** (61 inherited integration cases plus 33 new cases), six files, including real runtime-role constraints and existing cross-module concurrency tests.

Reproduction command (only an isolated test database):

```sh
NODE_ENV=test TEST_DATABASE_DESTRUCTIVE=yes \
TEST_DATABASE_URL=postgres://aoking_test:aoking_test_password@127.0.0.1:55442/aoking_direct_test \
npx vitest run --config vitest.integration.config.ts apps/api/tests/integration/passwordConcurrency.test.ts
```

Run the final test file against the accepted base in a separate archive to observe the 31 failing cases; run it on the repair branch to observe 33 passing cases. Setup creates test-only trigger/fault objects; teardown removes them and the runtime role. Destructive test guards require the exact loopback database identity and explicit opt-in.

Local validation:

| Check | Result |
|---|---|
| Frontend lint / unit / build / asset verification | PASS — 101 tests |
| API lint / build / unit | PASS — 25 tests |
| Isolated PostgreSQL integration | PASS — 94 tests |
| Mock E2E / production preview | PASS — 90 passed, 18 existing intentional skips / 1 passed |
| Real-auth catalogue, forced change, cart/order/sales and revoked-cart flows | PASS — 4 tests, desktop 1440/mobile 390 |
| Isolated Docker Smoke / migration / persistence / backup-restore isolation | PASS |
| Media restore security | PASS |
| Independent read-only source/security review | No material production findings; reviewer did not rerun DB/E2E |

The unchanged Vite build reports its existing >500 kB advisory. Fault-injection tests intentionally exercise generic HTTP 500 responses; they do not expose internal database errors. Docker uses a separate temporary client config to avoid a previously identified local credential-helper stall; the user's Docker configuration is not edited.

Final exact SHA, push/PR four-job CI run URLs and actual conclusions are recorded in the new Draft PR delivery comment. Not run: production deployment, actual hardware devices, production load/performance or a general session/authorization redesign. ChatGPT acceptance is pending; development stops after delivery.
