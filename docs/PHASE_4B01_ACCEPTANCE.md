# Phase 4B-01 Acceptance Report

**Branch:** `feat/backend-foundation-4b01`  
**Base:** `fix/react-mock-integrity` (PR #6)  
**PR:** https://github.com/rayleigh66/AK-Direct-UI/pull/7 (Draft)  
**Verification Head:** `7031f63fed77ab262d39ef65776d80cc088eab69` (P0 safety fix; the final documentation commit and exact PR Head are reported in PR #7)  
**Scope:** backend infrastructure only. No business modules, WMS, authentication or Phase 3C rule changes.

## 1. Delivered infrastructure

- `apps/api`: Express 4 + TypeScript, environment validation, PostgreSQL pool, health/readiness endpoints, safe JSON errors and graceful shutdown.
- Versioned SQL migration runner with advisory lock, per-migration transactions, SHA-256 checksums and drift detection.
- `system_metadata` technical table; readiness verifies the expected schema version and required migration.
- Docker Compose services: `db`, `migrate`, `api`, `web`, `backup`.
- Caddy web/static SPA + `/api` reverse proxy.
- Daily PostgreSQL backups with 30-day retention and guarded restore.
- Isolated destructive smoke harness and test-database safety gate.
- Deployment, upgrade, backup/restore and troubleshooting documentation.

## 2. Actual local environment

| Item | Value |
| --- | --- |
| Host | macOS arm64 development machine |
| Docker | Docker 29.1.3 + Compose v2.40.3 |
| Target production hardware | Ubuntu 24.04, 2 vCPU / 4 GB — **NOT RUN** |
| Local default web port | `127.0.0.1:18080` (default `8080`; local 8080 was occupied by another service) |
| API | Internal `api:4000`, no host port |
| PostgreSQL | Internal `db:5432`, no host port, named volume `aoking-direct_postgres_data` |
| Test DB | `127.0.0.1:55433`, separate Compose project/volume |
| Production domain/TLS | **NOT RUN** — no Owner-approved domain; local HTTP only |

## 3. P0 safety fixes (review follow-up)

### P0-01 — destructive Compose smoke isolated from production

`scripts/verify-compose.sh` no longer sources `.env`, no longer targets the default `aoking-direct` project, and no longer uses `./backups` or the production volume.

It now uses:

- unique `aoking-direct-smoke-*` project name;
- project-scoped PostgreSQL volume (`<smoke-project>_postgres_data`);
- independent `aoking_smoke` / `aoking_direct_smoke` credentials and database;
- unique `aoking-direct-api-smoke:*` / `aoking-direct-web-smoke:*` image tags;
- a dynamically selected loopback web port;
- a temporary isolated backup directory (never `./backups`).

It fails closed if `SMOKE_PROJECT` is not a smoke-prefixed project, if `SMOKE_BACKUP_DIR` is the production backup directory, or if Compose resolves a different project name. Cleanup only removes the smoke project/volume/temp backup directory.

`scripts/test-smoke-isolation.sh` adds the regression evidence:

- negative guard: production backup directory is refused;
- negative guard: `SMOKE_PROJECT=aoking-direct` is refused;
- runs the full isolated smoke;
- inspects a pre-existing production-named volume `aoking-direct_postgres_data` **without modifying it** and verifies its identity is unchanged;
- creates a sentinel production backup file, runs the smoke, and verifies the sentinel and every pre-existing `*.dump` remain byte-identical.

Actual result: **PASS** — “production-named volume and backup files were not touched.”

### P0-02 — database integration test safety gate

`apps/api/tests/support/testDatabaseSafety.ts` now requires all of the following before any connection or destructive SQL:

- `NODE_ENV=test` exactly;
- explicit `TEST_DATABASE_DESTRUCTIVE=yes`;
- loopback host only (`127.0.0.1`, `localhost`, `::1`);
- database name exactly `aoking_direct_test`;
- user exactly `aoking_test`;
- valid `postgres://` / `postgresql://` URL.

The integration test validates at module load, before any `Client` connection or `DROP SCHEMA`. A name merely containing “test” is not accepted.

`apps/api/tests/unit/testDatabaseSafety.test.ts` covers valid input plus wrong host, wrong database, wrong user, missing destructive sentinel, wrong `NODE_ENV`, invalid protocol and malformed URL.

Runtime negative evidence:

- wrong database name (`production`) exited 1 before connection;
- missing `TEST_DATABASE_DESTRUCTIVE=yes` exited 1 before connection;
- a `safety_marker` table inserted before both attempts still had count **1** afterward, proving no destructive SQL executed.

### P1 follow-ups addressed

- Migration runner stores SHA-256 checksums, rejects edited historical migrations, rejects applied migrations missing from the directory, and backfills legacy null checksums.
- Readiness verifies `schema_version = 4b01` and the required `001_infrastructure.sql` row; a version mismatch returns `version_mismatch`.
- Integration test includes checksum-drift and version-mismatch cases.
- Least-privilege runtime vs migration database roles remain a future design item (not implemented in this phase).

## 4. T01–T12 results

| ID | Result | Evidence |
| --- | --- | --- |
| T01 | **PASS** (local Docker + CI) | Isolated `aoking-direct-smoke-*` stack: `db`/`api`/`web` healthy, `migrate` exited 0, `backup` running. Default production-named stack also started and `/api/ready` returned 200. |
| T02 | **PASS** (local Docker + CI) | Playwright through Caddy `http://127.0.0.1:18080`: 4 product cards, product detail, add-to-order, order list. CI smoke served `/` successfully. |
| T03 | **PASS** | `GET /api/health` returned `{"status":"ok","service":"aoking-direct-api",...}`. |
| T04 | **PASS** | With DB stopped, `/api/ready` returned **503** and API stayed running; after DB restore and API restart, `/api/ready` returned **200** with `database:ok, migrations:ok`. |
| T05 | **PASS** | First run `1 applied, 0 skipped`; second `0 applied, 1 skipped`; `schema_migrations` count remained 1. Checksum drift test also passed. |
| T06 | **PASS** | Probe persisted across DB restart in the isolated smoke project/volume. |
| T07 | **PASS** | Recreating api/web did not remove the isolated smoke PostgreSQL volume; production-named volume identity sentinel unchanged. |
| T08 | **PASS** | db/api have no host ports (`:0` / `invalid IP:0`); web publishes loopback only; DB password absent from the smoke API image; `docker compose config --quiet` passed. |
| T09 | **PASS** | `npm run lint`; `npm test` **87 passed / 6 skipped**; `npm run build`; `npm run verify:assets`; Playwright **90 passed / 18 skipped**; preview smoke **1/1**. API unit **14/14**, DB integration **6/6**. |
| T10 | **PASS** | Push run `41833381169` and PR run `41833388574`: `local-prototype`, `backend-foundation`, `docker-smoke` all success. |
| T11 | **PASS** | Invalid migration exits 1. Failed deployment project: `up` exit 1, `migrate` exit 1, `api`/`web` created but not running; API never ready. |
| T12 | **PASS** | Local unit/integration tests and isolated smoke use local-only credentials; no cloud/production credentials required. Real target server not used. |

## 5. Commands and verification notes

### API and frontend

```bash
npm run lint
npm test                 # 87 passed / 6 skipped (destructive DB suite skipped without explicit gate)
npm run build
npm run verify:assets
npm run test:e2e         # 90 passed / 18 skipped
npm run test:e2e:preview # 1 passed

npm run api:lint
npm run api:build
npm run api:test         # 14 unit tests
```

Guarded destructive integration tests:

```bash
bash scripts/test-db-up.sh
export NODE_ENV=test
export TEST_DATABASE_DESTRUCTIVE=yes
export TEST_DATABASE_URL='postgres://aoking_test:aoking_test_password@127.0.0.1:55433/aoking_direct_test'
npm run api:test:db      # 6 tests
bash scripts/test-db-down.sh
```

### Docker smoke

```bash
bash scripts/test-smoke-isolation.sh
```

This is the only supported destructive smoke entrypoint. `verify-compose.sh` is internally isolated but should still be run through the isolation harness.

### API endpoints

```text
GET /api/health  -> 200 process liveness; no DB dependency
GET /api/ready   -> 200 ready; 503 when DB/migrations/expected version unavailable
```

### Persistence and backup

- PostgreSQL data: production default volume `aoking-direct_postgres_data`; smoke uses a unique project-scoped volume.
- Backup service: immediate backup after DB healthy, then every 24 hours.
- Retention: `BACKUP_RETENTION_DAYS` default 30.
- Backup files: `BACKUP_HOST_DIR` (default `./backups`), mode `600`, excluded from Git.
- Restore: `scripts/db-restore.sh`, `CONFIRM_RESTORE=yes` and exact `CONFIRM_DB` required; protected 600 files are read by `pg_restore` in a one-shot db container.
- Actual backup → delete probe → restore → probe present test passed locally and in CI.

### Resource limits

| Service | Memory | CPU |
| --- | ---: | ---: |
| db | 768 MB | 1.0 |
| api | 256 MB | 0.5 |
| migrate | 256 MB | 0.5 |
| web | 128 MB | 0.25 |
| backup | 128 MB | 0.25 |

Total limits are about 1.5 GB on the approved 4 GB host. Target 2 vCPU / 4 GB build performance was **not measured**.

## 6. Not run / environment-limited

| Item | Status |
| --- | --- |
| Ubuntu 24.04 2 vCPU / 4 GB production host | **NOT RUN** — local macOS Docker and GitHub Ubuntu runner only |
| Production domain, DNS A/AAAA and Caddy automatic HTTPS | **NOT RUN** — no Owner-approved domain; production override documented but not activated |
| 24-hour elapsed backup interval | **NOT RUN** — immediate backup and loop/config verified; no 24-hour wall-clock test |
| Offsite backup destination | **NOT RUN / not configured** — local backups are not disaster recovery |
| Real WMS integration | Not in Phase 4B-01 scope |
| Real customer/order/inventory data | Not used; production business DB remains empty |
| Production data restore | Not run; restore tested on local/CI test stack only |
| Real device / browser matrix | Not applicable to this infrastructure phase |

## 7. Security and residual risks

- No authentication or server-side RBAC exists yet. The web port is bound to loopback by default and must not be exposed publicly until auth is implemented.
- `.env` contains the database password and must be protected on the host; it is ignored by Git and Docker build context. The API image was checked for the password and did not contain it.
- Backups are local only; offsite copy is a documented extension point, not an implemented capability.
- Backup files are root-owned mode 600. Restore uses a one-shot container; offsite copying requires privileged host access.
- API readiness can take up to the 5-second DB connection timeout before returning 503; Caddy may return 502 if the API process itself is unavailable.
- The backup service has no healthcheck; it is a long-running loop and logs failures, retrying hourly.
- Docker builds on a 4 GB server may need swap or should be performed in CI; this was not measured on the target.
- PostgreSQL and API have no host ports; web is loopback-only by default. Production HTTPS/domain is intentionally not activated.
- CI uses placeholder local/test credentials only. No automatic production deployment exists.
- The API and migrator still use the same PostgreSQL owner role; least-privilege runtime credentials are a future design item.

## 8. CI links

- Push run: https://github.com/rayleigh66/AK-Direct-UI/actions/runs/41833381169
- PR run: https://github.com/rayleigh66/AK-Direct-UI/actions/runs/41833388574
- All three jobs passed: `local-prototype`, `backend-foundation`, `docker-smoke`.

## 9. Next step

Phase 4B-02 is **not started**. Remaining work includes business schema/API contracts, authentication/RBAC, WMS contract, order/reservation state machines, least-privilege DB roles, and production domain/offsite operations. Those require Owner/ChatGPT review and explicit authorization.
