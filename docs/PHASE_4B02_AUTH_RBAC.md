# Phase 4B-02 — Authentication, RBAC and Session Foundation

Status: implementation for review. It does **not** implement orders, inventory, cart, WMS or business catalogue APIs. The existing React business screens remain the Phase 4B Mock unless the real-auth gate is enabled.

## 1. Scope

Implemented:

- PostgreSQL tables for customer companies, customer accounts, internal users, roles, permissions and sessions.
- Real password login, scrypt password hashing, first-login forced password change and logout.
- Random one-time initial passwords, shown once and stored only as a hash.
- Admin APIs to create companies and subaccounts using `C+6 digits` and `AK+6 digits + letter`.
- Company/account activation and suspension, brand grants, salesperson assignment.
- Server-side RBAC and company/sales data scopes.
- Persistent sessions, HttpOnly/SameSite cookies, double-submit CSRF, DB-backed login rate limiting, password error protection and audit events.
- Separate least-privilege API database role and privileged migration/owner role.
- React real-auth gate (`VITE_REAL_AUTH=true`) for login, forced password change, session display and logout. The default remains the existing Mock app for the existing Playwright suite.

Not implemented: order lifecycle, inventory reservation, cart, WMS, product/catalogue APIs, delivery, payment, refunds or business dashboards against PostgreSQL. Company suspension records the future PENDING-order cancellation contract but cannot cancel orders because the order module does not exist yet.

## 2. Database model (migration `002_auth_rbac.sql`)

| Table | Purpose |
| --- | --- |
| `internal_users` | Internal sales/admin identities, password hash, status, first-login flag |
| `roles` / `permissions` | Role and permission catalogue |
| `role_permissions` | Permission set per role |
| `internal_user_roles` | Roles assigned to internal users |
| `internal_user_permissions` | Optional direct grants |
| `customer_companies` | Company code, country, status, assigned salesperson |
| `customer_users` | `AK` usernames, password hashes, status, company |
| `brands` / `brand_grants` | Reference brands and company authorization |
| `auth_sessions` | Hashed session tokens, user/company, idle/absolute expiry, revocation |
| `login_attempts` | DB-backed failed-login windows and lockouts |
| `audit_logs` | Actor, action, target, sanitized JSON details, timestamp |

The only seeded business reference data is the AOKING brand and the role/permission catalogue. No customers, customer accounts, internal users, passwords, products, inventory or orders are seeded.

`system_metadata.schema_version` is `4b02`; readiness requires migration `002_auth_rbac.sql`.

## 3. Roles and data scope

| Role | Permissions |
| --- | --- |
| `admin` | `companies.manage`, `accounts.manage`, `brands.manage`, `catalog.manage`, `inventory.manage`, `promotions.manage`, `audit.read`, `sales.read_all` |
| `sales` | `sales.read_assigned` |
| `sales_writer` | `sales.write` (extra grant; not assigned to admins by default) |
| `auditor` | `audit.read` |
| customer | Implicit `customer.self`; only own company |

Server-side rules:

- Customer company resources are limited to the session company; another company returns 404.
- Sales users see/read only companies where `assigned_sales_user_id` matches their internal user ID.
- Admin keeps `sales.read_all` oversight, but `POST /api/sales/companies/:id/acknowledge` (the Phase 4B-02 sales-write probe) requires the separate `sales.write` permission.
- Audit logs require `audit.read`; customers and sales users are rejected.
- All checks are enforced by the API, not by frontend visibility.

## 4. Authentication and sessions

- Passwords use Node `scrypt` (N=16384, r=8, p=1) with a random 16-byte salt and timing-safe comparison. Only the encoded hash is stored.
- Initial passwords are generated with `crypto.randomInt` from a 16+ character alphabet and returned once in the admin creation response. They are never persisted in plaintext or audit details.
- Login failures return one generic message; unknown users still run a dummy hash comparison. Repeated failures are rate-limited in PostgreSQL (default 5 attempts / 15-minute window / 15-minute lock, configurable).
- Session tokens are random 32-byte values; only their SHA-256 hash is stored. Cookie `aoking_session` is HttpOnly, SameSite=Lax, Secure when configured, and rotated on login/password change.
- CSRF uses a readable `aoking_csrf` double-submit cookie plus `X-CSRF-Token`; login, logout, password change and all admin/sales writes require it.
- First-login accounts receive a session that can only call session/change-password/logout; business routes return `403 password_change_required` until the password is changed. Changing the password revokes all prior sessions and issues a new one.
- Internal idle timeout is 2 hours (configurable within a bounded range). Customer idle/absolute durations are configurable and not frozen by the implementation:
  - `CUSTOMER_SESSION_IDLE_HOURS` default 24
  - `CUSTOMER_SESSION_ABSOLUTE_DAYS` default 30
  - Owner must confirm final customer session policy.
- Sessions are validated on every request against revocation, idle expiry, absolute expiry and current user/company status. Suspended companies/users revoke active sessions.
- `COOKIE_SECURE` defaults to `true` in `docker-compose.yml` (fail secure behind Caddy HTTPS). Local HTTP validation sets `COOKIE_SECURE=false` explicitly; `.env.example` ships that local value. Set `TRUST_PROXY=1` behind Caddy HTTPS in production; local validation uses `TRUST_PROXY=0`.
- Logout revokes the session and clears the cookie.

## 5. Admin bootstrap (no fixed password)

Create the first internal admin without a default password:

```bash
printf '%s\n' 'A-strong-initial-password' | \
  docker compose exec -T -e MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" api \
  node apps/api/dist/auth/create-admin.js \
  --email admin@example.com --name "Admin Name" --password-stdin --no-must-change
```

Add `--sales-writer` to grant the extra `sales.write` permission. Without it, an admin can supervise sales data but receives 403 on sales write operations. The CLI uses the privileged migration connection; it never prints the password.

## 6. API surface (Phase 4B-02)

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/auth/csrf` | Anonymous; sets CSRF cookie |
| POST | `/api/auth/login` | Anonymous + CSRF |
| GET | `/api/auth/session` | Authenticated |
| POST | `/api/auth/logout` | Authenticated + CSRF |
| POST | `/api/auth/change-password` | Authenticated + CSRF |
| GET | `/api/companies`, `/api/companies/:id` | Customer own / sales assigned / admin read-all |
| GET | `/api/sales/companies`, `/api/sales/companies/:id` | Internal + sales scope |
| POST | `/api/sales/companies/:id/acknowledge` | `sales.write` + assignment/read-all |
| GET/POST | `/api/admin/companies` | `companies.manage` |
| GET | `/api/admin/companies/:id` | `companies.manage` + read-all |
| POST | `/api/admin/companies/:id/accounts` | `accounts.manage` |
| PATCH | `/api/admin/companies/:id/status` | `companies.manage` |
| PATCH | `/api/admin/customers/:id/status` | `accounts.manage` |
| PUT | `/api/admin/companies/:id/brands/:brandId` | `brands.manage` |
| PATCH | `/api/admin/companies/:id/sales-assignment` | `companies.manage` |
| GET | `/api/admin/sales-users` | `companies.manage` |
| GET | `/api/admin/audit-logs` | `audit.read` |

The `/api/sales/companies/:id/acknowledge` route is intentionally a minimal RBAC probe: it records an audit event and implements no order/cart/inventory business logic.

## 7. Runtime database role separation

- `MIGRATION_DATABASE_URL` uses the owner/migration connection and is available only to the one-shot `migrate` service.
- `DATABASE_URL` uses `RUNTIME_DB_USER`/`RUNTIME_DB_PASSWORD`; the migrate service provisions this role after migrations.
- The runtime role has SELECT on reference/auth tables, limited DML on companies/users/brand grants/sessions/login attempts, INSERT on audit logs, and **no DDL**. Database connection, schema usage, table grants and role creation are explicit.
- The API never receives the owner/migration URL.
- Future migrations must add/update runtime grants for new tables; this is a required migration-review step.
- Least-privilege separation is verified by an integration test and the Docker smoke test (runtime role gets `permission denied` on `CREATE TABLE`).

## 8. React integration

- Set `VITE_REAL_AUTH=true` for the real login/session gate; default `false` preserves the existing Mock app and its Playwright tests.
- The gate implements login, forced first password change, authenticated session display (customer company; internal roles/permissions), and logout using `/api/auth/*` with cookies and CSRF.
- Customer-facing auth copy is English; internal labels are English/Chinese. Business screens remain the Phase 4B Mock and are not connected to PostgreSQL yet.

## 9. Verification commands

```bash
npm run lint
npm test
npm run api:lint
npm run api:build
npm run api:test
npm run api:test:db   # requires NODE_ENV=test, TEST_DATABASE_DESTRUCTIVE=yes, exact test DB/user
npm run build
npm run verify:assets
npm run test:e2e
npm run test:e2e:preview
bash scripts/test-smoke-isolation.sh
```

The auth integration suite covers cross-company isolation, sales assignment, unauthorized API rejection, admin sales-write permission, first-login password change, suspended users/companies, idle session expiry, CSRF, login rate limiting, password non-leak, company/account creation, brand grants and runtime-role DDL denial.

## 10. Owner decisions still pending

- Final customer session idle/absolute duration (implementation is configurable; defaults are not business approval).
- Final password policy (current technical baseline: 12–128 chars, at least one letter and one number, not containing the username).
- How `sales.write` is granted to an admin in production (currently CLI `--sales-writer` or a controlled DB grant; no approval UI).
- Audit retention and immutability design.
- Brand catalogue management beyond the AOKING reference brand.
- Company suspension workflow for future PENDING orders: the contract is recorded, but the order module must implement whole-order cancellation in Phase 4B-03.
- Internal user lifecycle/password reset UI.

## 11. Limitations

- No orders, inventory, cart, WMS, products, payments, delivery or business dashboards are connected.
- No real email delivery; admin/sales delivery of temporary passwords remains an offline responsibility.
- No offsite backup, production domain/TLS or Ubuntu target-hardware acceptance.
- The runtime/migration role separation is implemented for PostgreSQL; secrets remain environment-managed.
- The customer session policy is intentionally configurable and not frozen.
