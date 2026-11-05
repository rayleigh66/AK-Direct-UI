#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-http://127.0.0.1:18080}"
STAMP="$(date +%s)"
ADMIN_EMAIL="e2e-admin-${STAMP}@example.test"
ADMIN_PASSWORD="E2eAdminPass123-${STAMP}"
CUSTOMER_CODE="C$(printf '%06d' $(( (STAMP % 900000) + 100000 )))"
JAR="$(mktemp "${TMPDIR:-/tmp}/aoking-real-e2e-cookies.XXXXXX")"
trap 'rm -f "$JAR"' EXIT

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

echo "Checking stack readiness at $BASE_URL ..."
curl -fsS --max-time 10 "$BASE_URL/api/ready" | grep -q '"status":"ready"' || {
  echo "The stack is not ready. Start it with VITE_REAL_AUTH=true and try again." >&2
  exit 1
}

echo "Creating a fresh internal admin (no fixed/default password)..."
printf '%s\n' "$ADMIN_PASSWORD" | docker compose exec -T \
  -e MIGRATION_DATABASE_URL="${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}" \
  api node apps/api/dist/auth/create-admin.js \
  --email "$ADMIN_EMAIL" --name "E2E Admin" --password-stdin --no-must-change >/dev/null

TOKEN="$(curl -fsS -c "$JAR" "$BASE_URL/api/auth/csrf" | python3 -c 'import sys,json; print(json.load(sys.stdin)["csrfToken"])')"
curl -fsS -o /dev/null -b "$JAR" -c "$JAR" \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOKEN" \
  -d "{\"username\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$BASE_URL/api/auth/login"

create_customer() {
  local code="$1"
  local json
  json="$(curl -fsS -b "$JAR" -c "$JAR" \
    -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOKEN" \
    -d "{\"customerCode\":\"$code\",\"shortName\":\"E2E Customer $code\",\"countryAlpha3\":\"USA\",\"brandIds\":[\"brand-aoking\"]}" \
    "$BASE_URL/api/admin/companies")"
  printf '%s' "$json"
}

echo "Creating desktop customer company $CUSTOMER_CODE ..."
DESKTOP_JSON="$(create_customer "$CUSTOMER_CODE")"
CUSTOMER_USERNAME="$(printf '%s' "$DESKTOP_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["primaryUsername"])')"
CUSTOMER_PASSWORD="$(printf '%s' "$DESKTOP_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["temporaryPassword"])')"

MOBILE_CODE="C$(printf '%06d' $(( ((STAMP + 1) % 900000) + 100000 )))"
echo "Creating mobile customer company $MOBILE_CODE ..."
MOBILE_JSON="$(create_customer "$MOBILE_CODE")"
CUSTOMER_USERNAME_MOBILE="$(printf '%s' "$MOBILE_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["primaryUsername"])')"
CUSTOMER_PASSWORD_MOBILE="$(printf '%s' "$MOBILE_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["temporaryPassword"])')"

echo "Running real-auth Playwright flow ..."
REAL_E2E_BASE_URL="$BASE_URL" \
REAL_E2E_ADMIN_EMAIL="$ADMIN_EMAIL" \
REAL_E2E_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
REAL_E2E_CUSTOMER_USERNAME="$CUSTOMER_USERNAME" \
REAL_E2E_CUSTOMER_PASSWORD="$CUSTOMER_PASSWORD" \
REAL_E2E_CUSTOMER_USERNAME_MOBILE="$CUSTOMER_USERNAME_MOBILE" \
REAL_E2E_CUSTOMER_PASSWORD_MOBILE="$CUSTOMER_PASSWORD_MOBILE" \
npx playwright test --config=playwright.real.config.ts "$@"

echo "Real-auth catalogue E2E completed."
