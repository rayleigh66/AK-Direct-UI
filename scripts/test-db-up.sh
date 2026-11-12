#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

docker compose -f docker-compose.test.yml up -d --wait db-test
echo "Test database ready."
echo "TEST_DATABASE_URL=postgres://aoking_test:aoking_test_password@127.0.0.1:55433/aoking_direct_test"
