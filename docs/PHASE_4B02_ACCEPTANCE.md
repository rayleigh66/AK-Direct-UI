# Phase 4B-02 Acceptance Report

**Branch:** `feat/auth-rbac-4b02`
**Base:** `feat/backend-foundation-4b01` (Phase 4B-01, PR #7)
**PR:** stacked Draft PR against `feat/backend-foundation-4b01` (link and exact Head SHA are reported in the PR body and in the final documentation commit)
**Scope:** PostgreSQL authentication, RBAC, data scopes, sessions, CSRF, login throttling, audit and runtime/migration database role separation. No orders, inventory reservation, cart, WMS or Phase 3C rule changes.

## 1. Delivered

| Area | Result |
| --- | --- |
| Schema | Migration `002_auth_rbac.sql`: customer companies, customer accounts, internal users, roles, permissions, brand grants, sessions, login attempts, audit logs |
| Authentication | scrypt password hashing, real login, logout, forced first-login password change |
| Password handling | Random one-time initial password shown once; only the hash is persisted; never written to audit logs or the API image |
| Admin | Company creation (`C` + 6 digits), subaccounts (`AK` + 6 digits + letter), status changes, brand grants, salesperson assignment |
| RBAC | Server-side role/permission checks plus company/sales data scopes |
| Sessions | Persistent DB sessions, hashed tokens, HttpOnly/SameSite cookie, idle + absolute expiry, revocation |
| Protections | Double-submit CSRF, DB-backed login rate limiting, generic credential errors and dummy hash for unknown users |
| Audit | `audit_logs` for login, logout, password change, company/account/brand/assignment changes and sales-write probe |
| DB roles | `aoking_runtime` least-privilege role provisioned after migration; API never receives the owner URL |
| React | Opt-in real auth gate (`VITE_REAL_AUTH=true`); default Mock app and its tests unchanged |

Explicitly **not** implemented: orders, inventory reservation, cart, WMS, product/catalogue APIs, payments, delivery, business dashboards on PostgreSQL. Company suspension records the future PENDING-order cancellation contract only; it does not cancel orders because the order module does not exist yet.

## 2. Database migration `002_auth_rbac.sql`

Created tables: `internal_users`, `roles`, `permissions`, `role_permissions`, `internal_user_roles`, `internal_user_permissions`, `customer_companies`, `customer_users`, `brands`, `brand_grants`, `auth_sessions`, `login_attempts`, `audit_logs`.

Constraints enforced in the database:

- `customer_companies.customer_code ~ '^C[0-9]{6}$'`
- `customer_users.username ~ '^AK[0-9]{6}[A-Z]$'`
- `customer_users.account_letter ~ '^[A-Z]$'`
- session rows must reference exactly one of customer user or internal user, with the matching company for customer sessions.

Seeded data is limited to the role/permission catalogue and the AOKING reference brand. No customers, customer accounts, internal users, passwords, products, inventory or orders are seeded. `system_metadata.schema_version` becomes `4b02` and readiness requires migration `002_auth_rbac.sql`.

## 3. RBAC and data scope results

| Rule | Result | Verification |
| --- | --- | --- |
| Customer can read only its own company | PASS | Cross-company `GET /api/companies/:id` returns 404; list contains only the session company |
| Sales sees only assigned companies | PASS | `GET /api/sales/companies` and `GET /api/companies` return only assigned companies |
| Admin supervises sales data | PASS | `sales.read_all` grants read scope across companies |
| Admin sales write needs extra permission | PASS | Without `sales.write`, `POST /api/sales/companies/:id/acknowledge` returns 403; with `sales.write` it succeeds and audits |
| Audit logs limited to management | PASS | Customers and sales users receive 403; `audit.read` holders succeed |
| Unauthenticated API access | PASS | 401 `authentication_required` on every business route |

All checks are enforced in the API, not by frontend visibility.

## 4. Authentication, session and protection results

- Passwords: Node `scrypt` (N=16384, r=8, p=1), 16-byte random salt, 64-byte derived key, `timingSafeEqual` comparison. Only the encoded hash is stored.
- Initial passwords: generated with `crypto.randomInt`, satisfy upper/lower/digit/symbol requirements, returned once in the creation response, never persisted in plaintext or in `audit_logs.details`.
- Login throttling: default 5 failures / 15-minute window / 15-minute lock, enforced in PostgreSQL with an advisory-locked transaction; lock returns 429 with `Retry-After`.
- Enumeration resistance: unknown usernames still run a dummy scrypt verification and return the same generic error.
- Sessions: 32-byte random token, only SHA-256 hash stored; sliding idle expiry and absolute expiry; session revoked and cookie cleared on logout, password change, user suspension or company suspension.
- First login: session is restricted to session/change-password/logout; business routes return 403 `password_change_required`; changing the password revokes all prior sessions and issues a new one.
- CSRF: `aoking_csrf` readable cookie + `X-CSRF-Token` header, timing-safe compare, required on login, logout, password change and all admin/sales writes.
- Internal idle timeout is 2 hours. Customer idle/absolute durations are configurable (`CUSTOMER_SESSION_IDLE_HOURS`, `CUSTOMER_SESSION_ABSOLUTE_DAYS`) and are deliberately **not frozen**; Owner approval is required.

## 5. Runtime and migration database roles

- `MIGRATION_DATABASE_URL` (owner) is used only by the one-shot `migrate` service.
- `DATABASE_URL` uses `aoking_runtime` / `RUNTIME_DB_PASSWORD`; `migrate` runs `migrate` then `provision-runtime-role`.
- The runtime role gets CONNECT, schema USAGE, SELECT on reference/auth tables, limited DML on companies/users/brand grants, session/login-attempt DML and audit INSERT only — no DDL.
- Verified in the integration suite and the Docker smoke test: `CREATE TABLE` as the runtime role is denied.
- Verified locally that neither the owner nor the runtime password is present in the API image.

### Restore interaction (defect found and fixed)

`pg_restore --no-privileges` drops the runtime role's table grants, so a restored stack would serve 503 until grants were re-provisioned. `scripts/db-restore.sh` and the smoke restore path now run `docker compose run --rm --no-deps migrate` (migrate + provision) after `pg_restore` and before starting API/web; the smoke path then waits for `/api/ready` 200.

Local reproduction: `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM aoking_runtime` → `/api/ready` **503**; re-running the `migrate` service → `/api/ready` **200**.

## 6. React integration

- `VITE_REAL_AUTH=false` (default) keeps the existing Mock application and its Playwright suite byte-for-byte in behaviour.
- `VITE_REAL_AUTH=true` renders the real auth gate: login (customer `AK…` username or internal e-mail), forced first-login password change, authenticated session summary, logout.
- Customer-facing auth copy is English; internal labels are English/Chinese.
- Verified via a Playwright run against the Docker/Caddy stack with `VITE_REAL_AUTH=true`: admin login showed bilingual labels and permissions; customer login showed the company scope; no password was rendered. The web image was rebuilt with `VITE_REAL_AUTH=false` afterwards.

## 7. Test results (local, actual)

| Command | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm test` | 16 files, **90 passed** |
| `npm run api:lint` | PASS |
| `npm run api:build` | PASS |
| `npm run api:test` | 4 files, **14 passed** |
| `npm run api:test:db` | 2 files, **17 passed** (6 infrastructure + 11 auth/RBAC) |
| `npm run build` | PASS |
| `npm run verify:assets` | PASS (4 hashed images, no `/src/assets/images`) |
| `npm run test:e2e` | **90 passed / 18 skipped** |
| `npm run test:e2e:preview` | **1 passed** |
| `bash scripts/test-smoke-isolation.sh` | PASS (see §8) |
| `docker compose up -d --build --wait` (default project) | PASS — `db`, `api`, `web` healthy; migrations 001+002 |
| Runtime role `CREATE TABLE` (Docker) | PASS — `permission denied` |
| Admin CLI bootstrap | PASS — created internal admin with a supplied password, no default/fixed password |
| End-to-end through Caddy | PASS — admin login → create `C000999` → customer temp login → 403 first-change gate → change password → own-company access |
| React real-auth Playwright | PASS |

Integration suite coverage (11 auth/RBAC tests): login/session/logout, CSRF rejection, cross-company isolation, sales assignment scope, admin sales-read vs sales-write, first-login forced change, suspended user and suspended company session revocation, internal idle expiry, login rate limiting, company/subaccount/brand creation with no plaintext password persistence, and runtime-role DDL denial.

Destructive database tests ran only against the isolated `aoking_direct_test` database on `127.0.0.1:55433` with the `aoking_test` user and the exact safety gate (`NODE_ENV=test`, `TEST_DATABASE_DESTRUCTIVE=yes`) validated before any connection.

## 8. Docker smoke and safety regressions

`scripts/test-smoke-isolation.sh` retains the Phase 4B-01 P0 protections and extends them:

- unique `aoking-direct-smoke-*` project, project-scoped volume, independent `aoking_smoke` credentials, unique image tags and a temporary backup directory;
- sanitized `env -i` Compose child environment for every smoke command, with the generated env file as the only source;
- resolved Compose config validated before any up/run/migration/backup/restore, including the owner `MIGRATION_DATABASE_URL` vs runtime `DATABASE_URL` distinction;
- polluted-parent-environment regression proving the smoke ignores injected production-style values;
- production-named volume and real backup files are inspected read-only and verified unchanged;
- runtime-role DDL denial and runtime read of `schema_migrations`;
- owner and runtime passwords absent from the API image;
- restore now re-provisions the runtime role and waits for `/api/ready` 200.

Actual result: **PASS** — `All isolated Phase 4B-01/4B-02 compose checks passed.` followed by `Smoke isolation regression PASSED: polluted parent env did not redirect the smoke; production volume, simulated backup sentinel and real backups were untouched.` The restore step printed `Migrations complete: 0 applied, 2 skipped.` and `Runtime role provisioned: aoking_runtime_smoke`, and `/api/ready` returned 200 afterwards.

## 9. Owner decisions still pending

1. Final customer session idle/absolute duration (implementation is configurable; the defaults are not an approval).
2. Final password policy (technical baseline: 12–128 characters, at least one letter and one number, must not contain the username).
3. How `sales.write` is granted to an admin in production (currently CLI `--sales-writer` or a controlled DB grant; no approval UI).
4. Audit retention and immutability design.
5. Brand catalogue management beyond the AOKING reference brand.
6. Company suspension must cancel future PENDING orders — the contract is recorded, implementation belongs to the order module.
7. Internal user lifecycle and password reset UI.

## 10. Not run / environment-limited

| Item | Status |
| --- | --- |
| Ubuntu 24.04 2 vCPU / 4 GB production host | **NOT RUN** |
| Production domain, DNS and Caddy automatic HTTPS | **NOT RUN** — no approved domain |
| Offsite backup destination | **NOT RUN / not configured** |
| 24-hour elapsed backup interval | **NOT RUN** — immediate backup and loop/config only |
| Real target-hardware performance under load | **NOT RUN** |
| Customer session duration acceptance | **PENDING Owner decision** |
| Order/inventory/cart/WMS behaviour | Out of scope; not implemented and not claimed |

## 11. Limitations and residual risks

- Secrets (owner and runtime database passwords, cookie configuration) remain environment-managed; no secret manager or key rotation automation.
- Temporary passwords are delivered manually by sales through existing channels; there is no e-mail delivery, expiry notification or self-service reset.
- Failed-login counters are stored in PostgreSQL; a compromised runtime credential could still read the auth tables the API needs.
- The Mock UI remains the default; business screens are not connected to PostgreSQL.
- `pg_restore --no-privileges` requires the post-restore provisioning step; both restore entrypoints now perform it, but any external restore procedure must do the same.
- CI uses placeholder local/test credentials only; no automatic production deployment exists.

## 12. CI

CI for this branch runs the three jobs in `.github/workflows/ci.yml`: `local-prototype`, `backend-foundation` (includes the 17 database integration tests) and `docker-smoke`. Push and PR run links are recorded in the PR body after the first push.
