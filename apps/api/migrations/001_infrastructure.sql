-- Phase 4B-01 infrastructure metadata only.
-- This table stores non-business deployment/schema metadata used by readiness checks.
CREATE TABLE IF NOT EXISTS system_metadata (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system_metadata (key, value)
VALUES ('schema_version', '4b01')
ON CONFLICT (key)
DO UPDATE SET value = EXCLUDED.value, updated_at = now();
