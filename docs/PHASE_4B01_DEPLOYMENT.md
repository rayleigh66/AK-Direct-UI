# Phase 4B-01 — Backend Infrastructure Deployment

Status: infrastructure only. No customer, order, inventory, pricing, WMS or authentication business modules are implemented in this phase.

## 1. Architecture

The deployment is a modular monolith consisting of:

| Service | Image / build | Exposure |
| --- | --- | --- |
| `web` | `Dockerfile.web` (React build + Caddy `2.9.1`) | `127.0.0.1:${WEB_PORT:-8080}` by default |
| `api` | `apps/api/Dockerfile` (Node.js 22 + Express 4) | Internal `api:4000`; no host port |
| `db` | `postgres:16.4-alpine` | Internal `db:5432`; no host port |
| `migrate` | Same API Dockerfile, dedicated migrate image tag, one-shot command | Runs once after `db` is healthy |
| `backup` | `postgres:16.4-alpine` + `scripts/backup-container.sh` | Internal only; writes to `./backups` |

Caddy serves the React SPA and proxies `/api/*` to `api:4000`. The API is never published directly to the host. PostgreSQL has a named persistent volume (`aoking-direct_postgres_data`) and no public port mapping.

Resource limits are deliberately small for the approved 2 vCPU / 4 GB Ubuntu 24.04 host:

| Service | Memory limit | CPU limit |
| --- | ---: | ---: |
| `db` | 768 MB | 1.0 |
| `api` | 256 MB | 0.5 |
| `migrate` | 256 MB | 0.5 |
| `web` | 128 MB | 0.25 |
| `backup` | 128 MB | 0.25 |

Total limits are about 1.5 GB, leaving headroom for the host. Do not add Redis, a message queue or a monitoring stack in this phase.

## 2. Environment setup

Requirements:

- Ubuntu 24.04 LTS (or a compatible development machine)
- Docker Engine with Docker Compose v2
- 2 vCPU / 4 GB RAM or more
- Outbound access for image and npm dependency pulls during build

Create the local environment file:

```bash
cp .env.example .env
# Edit .env:
# - set a strong POSTGRES_PASSWORD
# - keep DATABASE_URL consistent with POSTGRES_* values
# - URL-encode special password characters inside DATABASE_URL
```

Never commit `.env`. It is ignored by Git and Docker build context. `.env.example` contains local placeholders only.

`DATABASE_URL` uses the Docker service name `db`:

```text
postgres://USER:PASSWORD@db:5432/DB_NAME
```

The API validates `NODE_ENV`, `PORT`, `DATABASE_URL`, the URL protocol and the presence of a host/database name at startup. It never logs the password or full connection string.

## 3. First installation

```bash
docker compose up -d --build
```

For scripted/health-checked startup:

```bash
docker compose up -d --build --wait
```

Startup order:

1. PostgreSQL starts and becomes healthy.
2. `migrate` runs the versioned SQL migrations and exits.
3. `api` starts only after the migration service exits successfully.
4. `web` starts only after the API is healthy.
5. `backup` starts after PostgreSQL is healthy and creates an initial backup, then repeats daily.

If migration fails, the API and web services do not start. Check:

```bash
docker compose ps -a
docker compose logs migrate
docker compose logs api
```

Verify:

```bash
curl -fsS http://127.0.0.1:8080/api/health
curl -fsS http://127.0.0.1:8080/api/ready
curl -fsS http://127.0.0.1:8080/ >/dev/null
```

`/api/health` is a process liveness check. `/api/ready` verifies database connectivity, the expected `schema_version` (`4b01`) and the required `001_infrastructure.sql` migration row; it returns HTTP 503 when the database or migrations are unavailable or mismatched.

## 4. Database and migrations

Migrations live in `apps/api/migrations/` as numbered `.sql` files. The runner:

- acquires a PostgreSQL advisory lock;
- creates `schema_migrations` if missing (including legacy `checksum` column migration);
- stores a SHA-256 checksum per migration and refuses to continue if an applied file is edited;
- refuses to continue if an applied migration file is missing from the migrations directory;
- applies each unapplied file once in its own transaction;
- records the filename and checksum in `schema_migrations`;
- skips already-applied files with matching checksums;
- exits non-zero on failure.

The only Phase 4B-01 table is `system_metadata`, used for technical schema/deployment metadata and readiness verification. It is not a customer, order, inventory or pricing table.

Production starts with an empty business database. No Mock customer, product, inventory or order data is imported.

Run migrations manually:

```bash
docker compose run --rm migrate
```

Run the development seed (guarded; refuses production and requires `SEED_DEV_DATA=yes`):

```bash
docker compose exec -T api sh -c 'SEED_DEV_DATA=yes npm run api:seed:dev'
```

The Phase 4B-01 seed only writes an infrastructure marker; it does not create business data. Future seeds must remain idempotent and production-guarded.

### Independent test database

```bash
bash scripts/test-db-up.sh
export NODE_ENV=test
export TEST_DATABASE_DESTRUCTIVE=yes
export TEST_DATABASE_URL='postgres://aoking_test:aoking_test_password@127.0.0.1:55433/aoking_direct_test'
npm run api:test:db
bash scripts/test-db-down.sh
```

The destructive integration test refuses to connect unless **all** of these are true:

- `NODE_ENV=test`;
- `TEST_DATABASE_DESTRUCTIVE=yes` is explicitly set;
- the URL host is loopback (`127.0.0.1`, `localhost` or `::1`);
- the database name is exactly `aoking_direct_test`;
- the user is exactly `aoking_test`.

It fails before any connection or `DROP SCHEMA` when any check fails. A database name merely containing `test` is not accepted. The test Compose project has its own volume and never uses the production database.

## 5. API

Phase 4B-01 exposes only:

- `GET /api/health` — process liveness, no database dependency;
- `GET /api/ready` — database and migration readiness.

The API has JSON error handling, security headers, no `X-Powered-By`, no stack traces or connection strings in responses, and graceful shutdown on SIGTERM/SIGINT. Business APIs are intentionally absent.

## 6. Backups and restore

The `backup` service runs `scripts/backup-container.sh` immediately after startup and then every 24 hours. It uses `pg_dump -Fc`, writes files with mode `600` to `BACKUP_HOST_DIR` (default `./backups`), and prunes files older than `BACKUP_RETENTION_DAYS` (default 30 days).

Backups are local only. **Offsite copies are not configured or claimed.** The backup directory is a copy point for a future Owner-approved offsite destination.

Manual backup:

```bash
bash scripts/db-backup.sh
```

Restore is deliberately protected:

```bash
BACKUP_FILE=backups/aoking_direct_YYYY...dump \
CONFIRM_RESTORE=yes \
CONFIRM_DB=aoking_direct \
bash scripts/db-restore.sh
```

The restore script:

- refuses to run without `CONFIRM_RESTORE=yes`;
- requires `CONFIRM_DB` to exactly match `POSTGRES_DB`;
- stops API and web before restoring;
- uses `pg_restore --clean --if-exists --exit-on-error`;
- leaves API/web stopped if the restore fails, so an inconsistent database is not served.

Backups and restore operations require a maintenance window. Never use `docker compose down -v` on a production stack.

## 7. Updating

```bash
# 1. Take a backup
bash scripts/db-backup.sh

# 2. Review and pull the approved commit manually
git fetch && git checkout <approved-commit>

# 3. Rebuild and start; migrations run automatically
docker compose up -d --build --wait

# 4. Verify readiness
curl -fsS http://127.0.0.1:8080/api/ready
```

The PostgreSQL data volume is not removed by `up`, `down` (without `-v`), service recreation or image rebuild. Product images/audit data do not exist in Phase 4B-01; future storage designs must preserve the same volume/recovery guarantees.

GitHub Actions only checks, builds and tests. It does **not** push to or deploy the production server. Production release is a manual, reviewed Docker Compose operation.

## 8. Domain and HTTPS

Local validation uses `127.0.0.1:8080` and HTTP. The default stack does not require a domain and is not publicly exposed.

When the Owner confirms a domain and DNS plan:

1. Create A/AAAA DNS records for the confirmed domain.
2. Set `DOMAIN` in the production environment.
3. Use the production override and example Caddyfile:

```bash
DOMAIN=approved.example \
docker compose -f docker-compose.yml \
  -f deploy/docker-compose.production.example.yml \
  up -d --build --wait
```

Caddy will obtain and renew TLS certificates automatically. Do not hardcode a domain in source or commit a real production domain until confirmed. DNS management is out of scope.

## 9. Local development and tests

```bash
npm ci
npm run lint
npm test
npm run api:lint
npm run api:test
npm run api:build
```

Frontend Mock remains unchanged and does not depend on business API endpoints. The Vite dev server proxies `/api` to `http://127.0.0.1:4000` for future infrastructure calls; the production build uses the Caddy `/api` reverse proxy. The existing Vite/Playwright workflows remain available. API unit tests do not require a database; database integration tests require the independent test database described above.

### Destructive Docker smoke tests

Docker smoke tests stop/restart databases, mutate metadata, and restore a backup. Run them only through:

```bash
bash scripts/test-smoke-isolation.sh
```

The smoke harness:

- refuses the production project name and the production `./backups` directory;
- creates a unique `aoking-direct-smoke-*` Compose project, project-scoped PostgreSQL volume, independent `aoking_smoke`/`aoking_direct_smoke` credentials, unique API/migrate/web image tags and a temporary backup directory;
- runs **every** Compose command with a sanitized child environment (`env -i` allowlist for Docker runtime variables), so exported parent `DATABASE_URL`, `POSTGRES_*`, `BACKUP_*`, image or port values cannot override `--env-file`;
- validates the fully resolved Compose model before any `up`, `run`, migration, backup or restore: project, DB URL/name/user/host, API/migrate/web images, backup bind mount, database volume and web port must all be smoke-specific; any production path/volume/endpoint is rejected;
- never sources the application `.env` and never drops the production `aoking-direct_postgres_data` volume;
- includes negative guards and a P0-03 regression that exports production-style variables in the parent shell and proves the control Compose config would be polluted while the sanitized smoke still uses only generated values;
- uses a temporary simulated backup directory with a sentinel, verifies real `*.dump` files by read-only hashing, and fails if any production-named volume or backup changes.

Do not invoke destructive smoke commands against a deployed production stack.

## 10. Security and scope limits

- The React Mock portal is still a demonstration UI; it has no real authentication or server-side authorization.
- Phase 4B-01 exposes only health/readiness endpoints. Do not publish the web port publicly until authentication and authorization are implemented.
- PostgreSQL and the API have no host port mapping in the default stack.
- `.env`, backups and build output are excluded from Git and Docker build context.
- The API image does not contain the database password.
- No WMS, order, inventory, customer, pricing, payment or login business APIs exist yet.
- No Redis, message queue or monitoring service is added.
- Offsite disaster recovery is not implemented; local backups alone are not disaster recovery.
- Ubuntu 24.04/2 vCPU/4 GB is the approved target; Docker builds may need swap or should be run on CI if memory pressure is observed.

## 11. Troubleshooting

| Symptom | Check |
| --- | --- |
| `migrate` exits non-zero | `docker compose logs migrate`; verify `DATABASE_URL` and database health |
| API does not start | `docker compose ps -a`; migration must exit 0 first |
| `/api/ready` returns 503 | Check `docker compose logs api`, database health, and migration row |
| Web cannot reach API | Caddy proxies `api:4000`; verify both are on the same Compose network |
| Port 8080 already in use | Set `WEB_PORT` in `.env` |
| Backup missing | `docker compose logs backup`; check `./backups` and volume permissions |
| Restore refused | Set `CONFIRM_RESTORE=yes` and matching `CONFIRM_DB` |
| PostgreSQL data missing after rebuild | Never use `down -v`; inspect the `aoking-direct_postgres_data` volume |
