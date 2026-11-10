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
  local sales_user_id="${2:-}"
  local sales_field=""
  local json
  if [ -n "$sales_user_id" ]; then
    sales_field=",\"assignedSalesUserId\":\"$sales_user_id\""
  fi
  json="$(curl -fsS -b "$JAR" -c "$JAR" \
    -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOKEN" \
    -d "{\"customerCode\":\"$code\",\"shortName\":\"E2E Customer $code\",\"countryAlpha3\":\"USA\",\"brandIds\":[\"brand-aoking\"]$sales_field}" \
    "$BASE_URL/api/admin/companies")"
  printf '%s' "$json"
}

create_subaccount() {
  local company_id="$1"
  curl -fsS -b "$JAR" -c "$JAR" \
    -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOKEN" \
    -d '{}' \
    "$BASE_URL/api/admin/companies/$company_id/accounts"
}

json_field() {
  python3 -c "import sys,json; print(json.load(sys.stdin)[\"$1\"])"
}

echo "Creating desktop customer company $CUSTOMER_CODE ..."
DESKTOP_JSON="$(create_customer "$CUSTOMER_CODE")"
CUSTOMER_USERNAME="$(printf '%s' "$DESKTOP_JSON" | json_field primaryUsername)"
CUSTOMER_PASSWORD="$(printf '%s' "$DESKTOP_JSON" | json_field temporaryPassword)"

MOBILE_CODE="C$(printf '%06d' $(( ((STAMP + 1) % 900000) + 100000 )))"
echo "Creating mobile customer company $MOBILE_CODE ..."
MOBILE_JSON="$(create_customer "$MOBILE_CODE")"
CUSTOMER_USERNAME_MOBILE="$(printf '%s' "$MOBILE_JSON" | json_field primaryUsername)"
CUSTOMER_PASSWORD_MOBILE="$(printf '%s' "$MOBILE_JSON" | json_field temporaryPassword)"

# A dedicated salesperson is assigned to the order-flow companies so the
# Phase 4B-04 E2E can prove the assigned-customer data scope.
SALES_EMAIL="e2e-sales-${STAMP}@example.test"
SALES_PASSWORD="E2eSalesPass123-${STAMP}"
echo "Creating an assigned salesperson ..."
printf '%s\n' "$SALES_PASSWORD" | docker compose exec -T \
  -e MIGRATION_DATABASE_URL="${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}" \
  api node apps/api/dist/auth/create-admin.js \
  --email "$SALES_EMAIL" --name "E2E Sales" --password-stdin --no-must-change --role sales >/dev/null
SALES_ID="$(curl -fsS -b "$JAR" -c "$JAR" "$BASE_URL/api/admin/sales-users" \
  | python3 -c "import sys,json; print(next(u['id'] for u in json.load(sys.stdin)['users'] if u['email']=='$SALES_EMAIL'))")"

ORDER_CODE="C$(printf '%06d' $(( ((STAMP + 2) % 900000) + 100000 )))"
echo "Creating order-flow customer company $ORDER_CODE ..."
ORDER_JSON="$(create_customer "$ORDER_CODE" "$SALES_ID")"
ORDER_COMPANY_ID="$(printf '%s' "$ORDER_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["company"]["id"])')"
ORDER_CUSTOMER_USERNAME="$(printf '%s' "$ORDER_JSON" | json_field primaryUsername)"
ORDER_CUSTOMER_PASSWORD="$(printf '%s' "$ORDER_JSON" | json_field temporaryPassword)"
ORDER_B_JSON="$(create_subaccount "$ORDER_COMPANY_ID")"
ORDER_CUSTOMER_B_USERNAME="$(printf '%s' "$ORDER_B_JSON" | json_field username)"
ORDER_CUSTOMER_B_PASSWORD="$(printf '%s' "$ORDER_B_JSON" | json_field temporaryPassword)"

ORDER_MOBILE_CODE="C$(printf '%06d' $(( ((STAMP + 3) % 900000) + 100000 )))"
echo "Creating mobile order-flow company $ORDER_MOBILE_CODE ..."
ORDER_MOBILE_JSON="$(create_customer "$ORDER_MOBILE_CODE" "$SALES_ID")"
ORDER_MOBILE_COMPANY_ID="$(printf '%s' "$ORDER_MOBILE_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["company"]["id"])')"
ORDER_CUSTOMER_USERNAME_MOBILE="$(printf '%s' "$ORDER_MOBILE_JSON" | json_field primaryUsername)"
ORDER_CUSTOMER_PASSWORD_MOBILE="$(printf '%s' "$ORDER_MOBILE_JSON" | json_field temporaryPassword)"
ORDER_B_MOBILE_JSON="$(create_subaccount "$ORDER_MOBILE_COMPANY_ID")"
ORDER_CUSTOMER_B_USERNAME_MOBILE="$(printf '%s' "$ORDER_B_MOBILE_JSON" | json_field username)"
ORDER_CUSTOMER_B_PASSWORD_MOBILE="$(printf '%s' "$ORDER_B_MOBILE_JSON" | json_field temporaryPassword)"

echo "Running real-auth Playwright flow ..."
REAL_E2E_BASE_URL="$BASE_URL" \
REAL_E2E_ADMIN_EMAIL="$ADMIN_EMAIL" \
REAL_E2E_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
REAL_E2E_ADMIN_COMPANY_CODE="$CUSTOMER_CODE" \
REAL_E2E_ORDER_COMPANY_CODE="$ORDER_CODE" \
REAL_E2E_CUSTOMER_USERNAME="$CUSTOMER_USERNAME" \
REAL_E2E_CUSTOMER_PASSWORD="$CUSTOMER_PASSWORD" \
REAL_E2E_CUSTOMER_USERNAME_MOBILE="$CUSTOMER_USERNAME_MOBILE" \
REAL_E2E_CUSTOMER_PASSWORD_MOBILE="$CUSTOMER_PASSWORD_MOBILE" \
REAL_E2E_SALES_EMAIL="$SALES_EMAIL" \
REAL_E2E_SALES_PASSWORD="$SALES_PASSWORD" \
REAL_E2E_ORDER_CUSTOMER_USERNAME="$ORDER_CUSTOMER_USERNAME" \
REAL_E2E_ORDER_CUSTOMER_PASSWORD="$ORDER_CUSTOMER_PASSWORD" \
REAL_E2E_ORDER_CUSTOMER_B_USERNAME="$ORDER_CUSTOMER_B_USERNAME" \
REAL_E2E_ORDER_CUSTOMER_B_PASSWORD="$ORDER_CUSTOMER_B_PASSWORD" \
REAL_E2E_ORDER_CUSTOMER_USERNAME_MOBILE="$ORDER_CUSTOMER_USERNAME_MOBILE" \
REAL_E2E_ORDER_CUSTOMER_PASSWORD_MOBILE="$ORDER_CUSTOMER_PASSWORD_MOBILE" \
REAL_E2E_ORDER_CUSTOMER_B_USERNAME_MOBILE="$ORDER_CUSTOMER_B_USERNAME_MOBILE" \
REAL_E2E_ORDER_CUSTOMER_B_PASSWORD_MOBILE="$ORDER_CUSTOMER_B_PASSWORD_MOBILE" \
npx playwright test --config=playwright.real.config.ts "$@"

echo "Real-auth catalogue E2E completed."
