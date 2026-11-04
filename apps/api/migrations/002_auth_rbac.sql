-- Phase 4B-02: authentication, roles, permissions, sessions and audit.
-- No customer/internal users, passwords, orders or inventory are seeded here.

CREATE TABLE IF NOT EXISTS internal_users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  last_login_at timestamptz,
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_.]{1,79}$'),
  description text NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id text NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id text NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS internal_user_roles (
  internal_user_id uuid NOT NULL REFERENCES internal_users(id) ON DELETE CASCADE,
  role_id text NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (internal_user_id, role_id)
);

CREATE TABLE IF NOT EXISTS internal_user_permissions (
  internal_user_id uuid NOT NULL REFERENCES internal_users(id) ON DELETE CASCADE,
  permission_id text NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (internal_user_id, permission_id)
);

CREATE TABLE IF NOT EXISTS customer_companies (
  id uuid PRIMARY KEY,
  customer_code text NOT NULL UNIQUE CHECK (customer_code ~ '^C[0-9]{6}$'),
  short_name text NOT NULL,
  country_alpha3 char(3) NOT NULL CHECK (country_alpha3 ~ '^[A-Z]{3}$'),
  internal_nickname text,
  assigned_sales_user_id uuid REFERENCES internal_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_users (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES customer_companies(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE CHECK (username ~ '^AK[0-9]{6}[A-Z]$'),
  account_letter char(1) NOT NULL CHECK (account_letter ~ '^[A-Z]$'),
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  last_login_at timestamptz,
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, account_letter)
);

CREATE TABLE IF NOT EXISTS brands (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  name_en text,
  is_default_granted boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS brand_grants (
  company_id uuid NOT NULL REFERENCES customer_companies(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, brand_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  user_type text NOT NULL CHECK (user_type IN ('customer', 'internal')),
  customer_user_id uuid REFERENCES customer_users(id) ON DELETE CASCADE,
  internal_user_id uuid REFERENCES internal_users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES customer_companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_hash text,
  user_agent_hash text,
  CHECK (
    (user_type = 'customer' AND customer_user_id IS NOT NULL AND internal_user_id IS NULL AND company_id IS NOT NULL)
    OR
    (user_type = 'internal' AND internal_user_id IS NOT NULL AND customer_user_id IS NULL AND company_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS auth_sessions_customer_idx ON auth_sessions(customer_user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_internal_idx ON auth_sessions(internal_user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_company_idx ON auth_sessions(company_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(absolute_expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  login_key text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  window_start timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY,
  actor_type text NOT NULL CHECK (actor_type IN ('customer', 'internal', 'system')),
  actor_id uuid,
  actor_label text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor_id);

INSERT INTO roles (id, name) VALUES
  ('admin', 'Administrator'),
  ('sales', 'Salesperson'),
  ('sales_writer', 'Sales writer (extra write grant)'),
  ('auditor', 'Auditor')
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (id, description) VALUES
  ('companies.manage', 'Create and manage customer companies'),
  ('accounts.manage', 'Create and manage customer accounts'),
  ('brands.manage', 'Grant and revoke brand authorization'),
  ('catalog.manage', 'Manage product catalogue'),
  ('inventory.manage', 'Manage inventory'),
  ('promotions.manage', 'Manage promotions and tier rules'),
  ('audit.read', 'Read audit logs'),
  ('sales.read_assigned', 'Read assigned customer companies'),
  ('sales.read_all', 'Read all customer companies for supervision'),
  ('sales.write', 'Execute sales write operations')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('admin', 'companies.manage'),
  ('admin', 'accounts.manage'),
  ('admin', 'brands.manage'),
  ('admin', 'catalog.manage'),
  ('admin', 'inventory.manage'),
  ('admin', 'promotions.manage'),
  ('admin', 'audit.read'),
  ('admin', 'sales.read_all'),
  ('sales', 'sales.read_assigned'),
  ('sales_writer', 'sales.write'),
  ('auditor', 'audit.read')
ON CONFLICT DO NOTHING;

-- AOKING is the platform reference brand. No mock customers/products/orders.
INSERT INTO brands (id, code, name, name_en, is_default_granted, active) VALUES
  ('brand-aoking', 'AOKING', 'AOKING (奥王)', 'AOKING', true, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO system_metadata (key, value)
VALUES ('schema_version', '4b02')
ON CONFLICT (key)
DO UPDATE SET value = EXCLUDED.value, updated_at = now();
