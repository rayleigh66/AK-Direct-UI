# Phase 4B-01 Acceptance Report

**Branch:** `feat/backend-foundation-4b01`  
**Base:** `fix/react-mock-integrity` (PR #6)  
**PR:** https://github.com/rayleigh66/AK-Direct-UI/pull/7 (Draft)  
**Verification Head:** `e2ea102` (the final documentation commit and full SHA are reported in PR #7)  
**Scope:** backend infrastructure only. No business modules, WMS, authentication or Phase 3C rule changes.

## 1. Delivered infrastructure

- `apps/api`: Express 4 + TypeScript, environment validation, PostgreSQL pool, health/readiness endpoints, safe JSON errors and graceful shutdown.
- Versioned SQL migration runner with advisory lock and `schema_migrations`.
- `system_metadata` technical table for schema/deployment metadata and readiness checks.
- Docker Compose services: `db`, `migrate`, `api`, `web`, `backup`.
- Caddy web/static SPA + `/api` reverse proxy.
- Daily PostgreSQL backups with 30-day retention and guarded restore.
- Independent test database, API unit/integration tests and CI jobs.
- Deployment, upgrade, backup/restore and troubleshooting documentation.

## 2. Actual local environment

| Item | Value |
| --- | --- |
| Host | macOS arm64 development machine |
| Docker | Docker 29.1.3 + Compose v2.40.3 |
| Target production hardware | Ubuntu 24.04, 2 vCPU / 4 GB — **NOT RUN** |
| Local web port | `127.0.0.1:18080` (default `8080`; local 8080 was occupied by another service) |
| API | Internal `api:4000`, no host port |
| PostgreSQL | Internal `db:5432`, no host port, named volume `aoking-direct_postgres_data` |
| Test DB | `127.0.0.1:55433`, separate Compose project/volume |
| Production domain/TLS | **NOT RUN** — no Owner-approved domain; local HTTP only |

## 3. T01–T12 results

| ID | Result | Evidence |
| --- | --- | --- |
| T01 | **PASS** (local Docker + CI) | `docker compose up -d --build --wait`: `db`, `api`, `web` healthy; `migrate` exited 0; `backup` running. GitHub `docker-smoke` passed. |
| T02 | **PASS** (local Docker + CI) | Playwright through Caddy `http://127.0.0.1:18080`: 4 product cards, product detail, add-to-order, order list. CI smoke served `/` successfully. |
| T03 | **PASS** | `GET /api/health` returned `{"status":"ok","service":"aoking-direct-api",...}`. |
| T04 | **PASS** | With DB stopped, `/api/ready` returned **503** and API stayed running; after DB restore and API restart, `/api/ready` returned **200** with `database:ok, migrations:ok`. |
| T05 | **PASS** | First run: `1 applied, 0 skipped`; second run: `0 applied, 1 skipped`; `schema_migrations` count remained 1. |
| T06 | **PASS** | Inserted probe in `system_metadata`; restarted `db`; probe persisted; removed/recreated `api`/`web`; probe still present. |
| T07 | **PASS** | `docker compose rm -sf api web` + `up -d --wait api web` did not remove `aoking-direct_postgres_data`; probe persisted. |
| T08 | **PASS** | `db`/`api` have no host port (`:0` locally, `invalid IP:0` in CI treated as unpublished); `web` publishes only `127.0.0.1`. Database password not found inside `aoking-direct-api:4b01`. `docker compose config --quiet` passed. |
| T09 | **PASS** | `npm run lint`; `npm test` **86/86**; `npm run build`; `npm run verify:assets`; Playwright **90 passed / 18 skipped**; preview smoke **1/1**. |
| T10 | **PASS** | GitHub Actions run `41691514129` (PR) and `41691502883` (push): `local-prototype`, `backend-foundation`, `docker-smoke` all success. |
| T11 | **PASS** | Invalid DB migration exits 1. Separate failed-deployment project: `up` exit 1, `migrate` exited 1, `api`/`web` created but not running; API never became ready. |
| T12 | **PASS** | Local unit/integration tests and Compose run with local-only credentials; no cloud/production credentials required. Real target server not used. |

## 4. Commands and verification notes

### API and frontend

```bash
npm run lint
npm test                 # 86 tests; includes API unit/integration when TEST_DATABASE_URL is available
npm run build
npm run verify:assets
npm run test:e2e         # 90 passed / 18 skipped
npm run test:e2e:preview # 1 passed

npm run api:lint
npm run api:build
npm run api:test         # 9 unit tests
npm run api:test:db      # 4 integration tests against the independent test DB
```

### Compose

```bash
cp .env.example .env
docker compose up -d --build --wait
bash scripts/verify-compose.sh
```

`verify-compose.sh` covers T01–T08, T11 and backup/restore. It was run locally with `KEEP_STACK=1` and passed; GitHub `docker-smoke` also passed.

### API endpoints

```text
GET /api/health  -> 200 process liveness; no DB dependency
GET /api/ready   -> 200 ready; 503 when DB/migrations unavailable
```

### Persistence and backup

- PostgreSQL data: named volume `aoking-direct_postgres_data`.
- Backup service: immediate backup after DB healthy, then every 24 hours.
- Retention: `BACKUP_RETENTION_DAYS` default 30.
- Backup files: `./backups`, mode `600`, excluded from Git.
- Restore: `scripts/db-restore.sh`, `CONFIRM_RESTORE=yes` and exact `CONFIRM_DB` required; `pg_restore --clean --if-exists --exit-on-error` runs in a one-shot `db` container so protected 600 files remain readable without host-root access.
- Actual backup → delete probe → restore → probe present test passed locally and in CI.

### Resource limits

| Service | Memory | CPU |
| --- | ---: | ---: |
| db | 768 MB | 1.0 |
| api | 256 MB | 0.5 |
| migrate | 256 MB | 0.5 |
| web | 128 MB | 0.25 |
| backup | 128 MB | 0.25 |

Docker inspect confirmed `805306368`, `268435456`, `134217728` bytes and matching NanoCpus for the running services. Total limits are about 1.5 GB on the approved 4 GB host. Target 2 vCPU / 4 GB build performance was **not measured**.

## 5. Not run / environment-limited

| Item | Status |
| --- | --- |
| Ubuntu 24.04 2 vCPU / 4 GB production host | **NOT RUN** — local macOS Docker and GitHub Ubuntu runner only |
| Production domain, DNS A/AAAA and Caddy automatic HTTPS | **NOT RUN** — no Owner-approved domain; production override is documented but not activated |
| 24-hour elapsed backup interval | **NOT RUN** — immediate backup and loop/config verified; no 24-hour wall-clock test |
| Offsite backup destination | **NOT RUN / not configured** — local backups are not disaster recovery |
| Real WMS integration | Not in Phase 4B-01 scope |
| Real customer/order/inventory data | Not used; production business DB remains empty |
| Production data restore | Not run; restore tested on local/CI test stack only |
| Real device / browser matrix | Not applicable to this infrastructure phase |

## 6. Security and residual risks

- No authentication or server-side RBAC exists yet. The web port is bound to loopback by default and must not be exposed publicly until auth is implemented.
- `.env` contains the database password and must be protected on the host; it is ignored by Git and Docker build context. The API image was checked for the password and did not contain it.
- Backups are local only; offsite copy is a documented extension point, not an implemented capability.
- Backup files are root-owned mode 600. Restore uses a one-shot container; offsite copying requires privileged host access.
- API readiness can take up to the 5-second DB connection timeout before returning 503; Caddy may return 502 if the API process itself is unavailable.
- The backup service has no healthcheck; it is a long-running loop and logs failures, retrying hourly.
- Docker builds on a 4 GB server may need swap or should be performed in CI; this was not measured on the target.
- PostgreSQL and API have no host ports; web is loopback-only by default. Production HTTPS/domain is intentionally not activated.
- CI uses placeholder local/test credentials only. No automatic production deployment exists.

## 7. CI links

- Push run: https://github.com/rayleigh66/AK-Direct-UI/actions/runs/41691502883
- PR run: https://github.com/rayleigh66/AK-Direct-UI/actions/runs/41691514129
- All three jobs passed: `local-prototype`, `backend-foundation`, `docker-smoke`.

## 8. Next step

Phase 4B-02 is **not started**. Remaining work includes business schema/API contracts, authentication/RBAC, WMS contract, order/reservation state machines, and production domain/offsite operations. Those require Owner/ChatGPT review and explicit authorization.
