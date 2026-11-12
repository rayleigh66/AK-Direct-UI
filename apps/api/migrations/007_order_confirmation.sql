-- Phase 4B-05: order confirmation, price approval, buyer acceptance,
-- warehouse reservations, reservation expiry/extension and approved release.
--
-- Additive only. Migrations 001-006 are byte-identical and are never edited.
-- Historical order numbers keep their original ODYYMMDDNNNN form; the widened
-- CHECK accepts both the old and the new OD-YYMMDD-NNNN form and the existing
-- UNIQUE constraint is retained.

-- --- Roles and permissions -------------------------------------------------

INSERT INTO roles (id, name) VALUES
  ('business_admin', 'Business administrator')
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (id, description) VALUES
  ('orders.approve_price', 'Approve or reject a changed-price order plan'),
  ('orders.approve_extension', 'Approve reservation extensions and run the expiry scan'),
  ('orders.approve_release', 'Approve whole-order release or exception cancellation'),
  ('orders.manage_confirmers', 'Grant and revoke buyer confirmation authority')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('business_admin', 'orders.approve_price'),
  ('business_admin', 'orders.approve_extension'),
  ('business_admin', 'orders.approve_release'),
  ('business_admin', 'orders.manage_confirmers'),
  ('admin', 'orders.manage_confirmers')
ON CONFLICT DO NOTHING;

-- --- Order number compatibility -------------------------------------------

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_no_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_order_no_check
  CHECK (order_no ~ '^(OD[0-9]{10}|OD-[0-9]{6}-[0-9]{4})$');

-- --- Order confirmation / plan columns ------------------------------------

ALTER TABLE orders ADD COLUMN IF NOT EXISTS current_plan_version integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_epoch bigint NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS first_confirmed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_by_user_id uuid REFERENCES internal_users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS final_total_cents bigint;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS final_plan_id uuid;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS final_plan_version integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_kind text;

ALTER TABLE orders
  ADD CONSTRAINT orders_current_plan_version_check CHECK (current_plan_version >= 0);
ALTER TABLE orders
  ADD CONSTRAINT orders_price_epoch_check CHECK (price_epoch >= 0);
ALTER TABLE orders
  ADD CONSTRAINT orders_final_total_check
  CHECK (final_total_cents IS NULL OR (final_total_cents > 0 AND final_total_cents <= 9000000000000));
ALTER TABLE orders
  ADD CONSTRAINT orders_cancellation_kind_check
  CHECK (cancellation_kind IS NULL OR cancellation_kind IN ('CUSTOMER', 'ADMIN_IMPACT', 'RELEASE'));

-- --- Buyer confirmation authority ----------------------------------------

CREATE TABLE IF NOT EXISTS buyer_confirmation_authorizations (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES customer_companies(id),
  customer_user_id uuid NOT NULL REFERENCES customer_users(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  authorized_by_user_id uuid NOT NULL REFERENCES internal_users(id),
  authorized_at timestamptz NOT NULL DEFAULT now(),
  revoked_by_user_id uuid REFERENCES internal_users(id),
  revoked_at timestamptz,
  revoke_reason text CHECK (revoke_reason IS NULL OR length(revoke_reason) <= 500),
  CHECK (status = 'revoked' OR (revoked_at IS NULL AND revoked_by_user_id IS NULL)),
  CHECK (status = 'active' OR revoked_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS buyer_confirmation_authorizations_active
  ON buyer_confirmation_authorizations(company_id, customer_user_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS buyer_confirmation_authorizations_company_idx
  ON buyer_confirmation_authorizations(company_id, authorized_at DESC);

-- --- Plans ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS order_plans (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  plan_version integer NOT NULL CHECK (plan_version > 0),
  status text NOT NULL CHECK (
    status IN ('SUBMITTED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'CONFIRMED')
  ),
  created_by_user_id uuid NOT NULL REFERENCES internal_users(id),
  created_by_label text NOT NULL,
  plan_digest text NOT NULL CHECK (plan_digest ~ '^[a-f0-9]{64}$'),
  price_fingerprint text NOT NULL CHECK (price_fingerprint ~ '^[a-f0-9]{64}$'),
  price_epoch bigint NOT NULL CHECK (price_epoch >= 0),
  requires_price_approval boolean NOT NULL,
  quantity_total integer NOT NULL CHECK (quantity_total > 0 AND quantity_total <= 100000000),
  total_cents bigint NOT NULL CHECK (total_cents > 0 AND total_cents <= 9000000000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (order_id, plan_version)
);

CREATE INDEX IF NOT EXISTS order_plans_order_idx ON order_plans(order_id, plan_version DESC);
CREATE INDEX IF NOT EXISTS order_plans_status_idx ON order_plans(status, created_at);

CREATE TABLE IF NOT EXISTS order_plan_lines (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES order_plans(id),
  line_number integer NOT NULL CHECK (line_number > 0),
  order_item_id uuid NOT NULL REFERENCES order_items(id),
  sku_id uuid NOT NULL REFERENCES product_skus(id),
  product_id uuid NOT NULL REFERENCES products(id),
  brand_id text NOT NULL REFERENCES brands(id),
  product_code text NOT NULL,
  product_title text NOT NULL,
  product_title_en text NOT NULL,
  sku_code text NOT NULL,
  color_name text NOT NULL,
  color_name_en text NOT NULL,
  color_hex text NOT NULL CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  quantity integer NOT NULL CHECK (quantity >= 10 AND quantity <= 1000000),
  reference_unit_price_cents integer NOT NULL
    CHECK (reference_unit_price_cents > 0 AND reference_unit_price_cents <= 100000000),
  unit_price_cents integer NOT NULL
    CHECK (unit_price_cents > 0 AND unit_price_cents <= 100000000),
  line_total_cents bigint NOT NULL
    CHECK (line_total_cents > 0 AND line_total_cents <= 9000000000000),
  price_changed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, line_number),
  UNIQUE (plan_id, sku_id),
  CHECK (line_total_cents = unit_price_cents::bigint * quantity),
  CHECK (price_changed = (unit_price_cents <> reference_unit_price_cents))
);

CREATE INDEX IF NOT EXISTS order_plan_lines_plan_idx ON order_plan_lines(plan_id, line_number);

-- --- Price approvals ------------------------------------------------------

CREATE TABLE IF NOT EXISTS order_price_approvals (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  requested_plan_id uuid NOT NULL REFERENCES order_plans(id),
  requested_plan_version integer NOT NULL CHECK (requested_plan_version > 0),
  price_fingerprint text NOT NULL CHECK (price_fingerprint ~ '^[a-f0-9]{64}$'),
  price_epoch bigint NOT NULL CHECK (price_epoch >= 0),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  requested_by_user_id uuid NOT NULL REFERENCES internal_users(id),
  requested_by_label text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 1000),
  decided_by_user_id uuid REFERENCES internal_users(id),
  decided_by_label text,
  decided_at timestamptz,
  decided_plan_version integer,
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 1000),
  CHECK (status = 'PENDING' OR decided_at IS NOT NULL),
  CHECK (status <> 'APPROVED' OR decided_by_user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS order_price_approvals_queue_idx
  ON order_price_approvals(status, requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS order_price_approvals_approved
  ON order_price_approvals(order_id, price_fingerprint, price_epoch)
  WHERE status = 'APPROVED';

-- --- Customer plan acceptance --------------------------------------------

CREATE TABLE IF NOT EXISTS order_plan_acceptances (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  plan_id uuid NOT NULL REFERENCES order_plans(id),
  plan_version integer NOT NULL CHECK (plan_version > 0),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^[a-f0-9]{64}$'),
  company_id uuid NOT NULL REFERENCES customer_companies(id),
  customer_user_id uuid NOT NULL REFERENCES customer_users(id),
  customer_username text NOT NULL,
  authorization_id uuid NOT NULL REFERENCES buyer_confirmation_authorizations(id),
  authorization_version bigint NOT NULL CHECK (authorization_version > 0),
  outcome text NOT NULL CHECK (outcome IN ('ACCEPTED', 'REJECTED')),
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  invalidation_reason text CHECK (invalidation_reason IS NULL OR length(invalidation_reason) <= 200)
);

CREATE INDEX IF NOT EXISTS order_plan_acceptances_order_idx
  ON order_plan_acceptances(order_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS order_plan_acceptances_active_accepted
  ON order_plan_acceptances(order_id)
  WHERE outcome = 'ACCEPTED' AND invalidated_at IS NULL;

-- --- Reservations ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS order_reservations (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  company_id uuid NOT NULL REFERENCES customer_companies(id),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'EXPIRED', 'RELEASED')),
  reservation_version bigint NOT NULL DEFAULT 1 CHECK (reservation_version > 0),
  confirmed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  hard_deadline_at timestamptz NOT NULL,
  total_extension_hours integer NOT NULL DEFAULT 0
    CHECK (total_extension_hours >= 0 AND total_extension_hours <= 240),
  released_at timestamptz,
  released_by_user_id uuid REFERENCES internal_users(id),
  release_reason text CHECK (release_reason IS NULL OR length(release_reason) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at <= hard_deadline_at),
  CHECK (status <> 'RELEASED' OR released_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS order_reservations_status_idx
  ON order_reservations(status, expires_at);
CREATE INDEX IF NOT EXISTS order_reservations_company_idx
  ON order_reservations(company_id, confirmed_at DESC);

CREATE TABLE IF NOT EXISTS order_reservation_lines (
  id uuid PRIMARY KEY,
  reservation_id uuid NOT NULL REFERENCES order_reservations(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  plan_line_id uuid NOT NULL REFERENCES order_plan_lines(id),
  line_number integer NOT NULL CHECK (line_number > 0),
  sku_id uuid NOT NULL REFERENCES product_skus(id),
  product_code text NOT NULL,
  sku_code text NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  warehouse_code text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
  unit_price_cents integer NOT NULL
    CHECK (unit_price_cents > 0 AND unit_price_cents <= 100000000),
  line_total_cents bigint NOT NULL CHECK (line_total_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id, line_number, warehouse_id),
  CHECK (line_total_cents = unit_price_cents::bigint * quantity)
);

CREATE INDEX IF NOT EXISTS order_reservation_lines_reservation_idx
  ON order_reservation_lines(reservation_id, line_number);
CREATE INDEX IF NOT EXISTS order_reservation_lines_stock_idx
  ON order_reservation_lines(sku_id, warehouse_id);

-- Immutable application ledger for reserve/release. The runtime role may only
-- SELECT it; the narrow SECURITY DEFINER functions below insert one row per
-- (reservation_line, action). This is the SQL-level guard against replaying
-- reserve/release with a newer inventory version.
CREATE TABLE IF NOT EXISTS order_reservation_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES order_reservations(id),
  reservation_line_id uuid NOT NULL REFERENCES order_reservation_lines(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  action text NOT NULL CHECK (action IN ('reserve', 'release')),
  quantity integer NOT NULL CHECK (quantity > 0),
  inventory_before integer NOT NULL CHECK (inventory_before >= 0),
  inventory_after integer NOT NULL CHECK (inventory_after >= 0),
  version_after bigint NOT NULL CHECK (version_after > 0),
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_line_id, action)
);

CREATE INDEX IF NOT EXISTS order_reservation_ledger_order_idx
  ON order_reservation_ledger(order_id, created_at);

-- --- Immutable confirmed transaction snapshot -----------------------------

CREATE TABLE IF NOT EXISTS order_final_lines (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  line_number integer NOT NULL CHECK (line_number > 0),
  sku_id uuid NOT NULL REFERENCES product_skus(id),
  product_id uuid NOT NULL REFERENCES products(id),
  brand_id text NOT NULL REFERENCES brands(id),
  product_code text NOT NULL,
  product_title text NOT NULL,
  product_title_en text NOT NULL,
  sku_code text NOT NULL,
  color_name text NOT NULL,
  color_name_en text NOT NULL,
  color_hex text NOT NULL CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  quantity integer NOT NULL CHECK (quantity >= 10 AND quantity <= 1000000),
  reference_unit_price_cents integer NOT NULL CHECK (reference_unit_price_cents > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents > 0),
  line_total_cents bigint NOT NULL CHECK (line_total_cents > 0),
  price_changed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, line_number),
  UNIQUE (order_id, sku_id),
  CHECK (line_total_cents = unit_price_cents::bigint * quantity)
);

CREATE TABLE IF NOT EXISTS order_confirmations (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  plan_id uuid NOT NULL REFERENCES order_plans(id),
  plan_version integer NOT NULL CHECK (plan_version > 0),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^[a-f0-9]{64}$'),
  acceptance_id uuid NOT NULL REFERENCES order_plan_acceptances(id),
  reservation_id uuid NOT NULL UNIQUE REFERENCES order_reservations(id),
  confirmed_by_user_id uuid NOT NULL REFERENCES internal_users(id),
  confirmed_by_label text NOT NULL,
  confirmed_at timestamptz NOT NULL,
  total_cents bigint NOT NULL CHECK (total_cents > 0),
  quantity_total integer NOT NULL CHECK (quantity_total > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE orders
  ADD CONSTRAINT orders_final_plan_fk
  FOREIGN KEY (final_plan_id) REFERENCES order_plans(id) ON DELETE SET NULL;

-- --- Extension / release requests ----------------------------------------

CREATE TABLE IF NOT EXISTS order_extension_requests (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  company_id uuid NOT NULL REFERENCES customer_companies(id),
  requested_by_user_id uuid NOT NULL REFERENCES internal_users(id),
  requested_by_label text NOT NULL,
  additional_hours integer NOT NULL CHECK (additional_hours > 0 AND additional_hours <= 240),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  expected_expires_at timestamptz NOT NULL,
  expected_reservation_version bigint NOT NULL CHECK (expected_reservation_version > 0),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by_user_id uuid REFERENCES internal_users(id),
  decided_by_label text,
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 1000),
  previous_expires_at timestamptz,
  new_expires_at timestamptz,
  CHECK (status = 'PENDING' OR decided_at IS NOT NULL),
  CHECK (status <> 'APPROVED' OR (decided_by_user_id IS NOT NULL AND new_expires_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS order_extension_requests_queue_idx
  ON order_extension_requests(status, requested_at);
CREATE INDEX IF NOT EXISTS order_extension_requests_order_idx
  ON order_extension_requests(order_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS order_release_requests (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  company_id uuid NOT NULL REFERENCES customer_companies(id),
  requested_by_user_id uuid NOT NULL REFERENCES internal_users(id),
  requested_by_label text NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  payment_verification text NOT NULL CHECK (payment_verification = 'unpaid'),
  shipment_verification text NOT NULL CHECK (shipment_verification = 'not_shipped'),
  verification_note text NOT NULL CHECK (length(verification_note) BETWEEN 1 AND 1000),
  verified_by_user_id uuid NOT NULL REFERENCES internal_users(id),
  verified_at timestamptz NOT NULL DEFAULT now(),
  expected_reservation_version bigint NOT NULL CHECK (expected_reservation_version > 0),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by_user_id uuid REFERENCES internal_users(id),
  decided_by_label text,
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 1000),
  executed_at timestamptz,
  CHECK (status = 'PENDING' OR decided_at IS NOT NULL),
  CHECK (status <> 'APPROVED' OR (decided_by_user_id IS NOT NULL AND executed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS order_release_requests_queue_idx
  ON order_release_requests(status, requested_at);
CREATE INDEX IF NOT EXISTS order_release_requests_order_idx
  ON order_release_requests(order_id, requested_at DESC);

-- --- Deadline reminders (idempotent, per real deadline) -------------------

CREATE TABLE IF NOT EXISTS order_deadline_reminders (
  id uuid PRIMARY KEY,
  reservation_id uuid NOT NULL REFERENCES order_reservations(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  deadline_at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('EXPIRING', 'EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id, deadline_at, kind)
);

CREATE INDEX IF NOT EXISTS order_deadline_reminders_order_idx
  ON order_deadline_reminders(order_id, created_at DESC);

-- --- Action idempotency ---------------------------------------------------

CREATE TABLE IF NOT EXISTS order_action_idempotency (
  id uuid PRIMARY KEY,
  operation text NOT NULL CHECK (length(operation) BETWEEN 1 AND 64),
  actor_type text NOT NULL CHECK (actor_type IN ('customer', 'internal')),
  actor_id uuid NOT NULL,
  order_id uuid REFERENCES orders(id),
  company_id uuid NOT NULL REFERENCES customer_companies(id),
  authorization_id uuid REFERENCES buyer_confirmation_authorizations(id),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation, actor_id, idempotency_key)
);

-- --- Extend existing event vocabularies -----------------------------------

ALTER TABLE order_status_history
  DROP CONSTRAINT IF EXISTS order_status_history_event_type_check;
ALTER TABLE order_status_history
  ADD CONSTRAINT order_status_history_event_type_check
  CHECK (event_type IN (
    'SUBMITTED', 'LINES_MODIFIED', 'CANCELLED', 'ADMIN_CANCELLED',
    'PLAN_SUBMITTED', 'PLAN_ACCEPTED', 'PLAN_REJECTED',
    'PRICE_APPROVED', 'PRICE_REJECTED', 'CONFIRMED',
    'RESERVATION_EXPIRED', 'RESERVATION_EXTENDED', 'RESERVATION_RELEASED'
  ));

ALTER TABLE order_notifications
  DROP CONSTRAINT IF EXISTS order_notifications_event_type_check;
ALTER TABLE order_notifications
  ADD CONSTRAINT order_notifications_event_type_check
  CHECK (event_type IN (
    'ORDER_SUBMITTED', 'ORDER_MODIFIED', 'ORDER_CANCELLED', 'ORDER_CANCELLED_BY_ADMIN',
    'PLAN_READY', 'PLAN_ACCEPTED', 'PLAN_REJECTED',
    'PRICE_APPROVAL_REQUIRED', 'PRICE_APPROVED', 'PRICE_REJECTED',
    'ORDER_CONFIRMED', 'RESERVATION_EXPIRING', 'RESERVATION_EXPIRED',
    'RESERVATION_EXTENDED', 'RESERVATION_RELEASED',
    'EXTENSION_REQUESTED', 'EXTENSION_DECIDED',
    'RELEASE_REQUESTED', 'RELEASE_DECIDED',
    'CONFIRMED_RESERVATION_EXCEPTION',
    'ORDER_CANCELLED_AFTER_CONFIRMATION'
  ));

-- --- Inventory movement reservation ledger --------------------------------

ALTER TABLE inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_movement_type_check
  CHECK (movement_type IN ('initial', 'adjustment', 'import', 'reserve', 'release'));

ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS reserved_before integer
  CHECK (reserved_before IS NULL OR reserved_before >= 0);

-- --- Narrow reservation bridge --------------------------------------------
-- The generic runtime role must never be able to run
--   UPDATE inventory_balances SET reserved = ...
-- directly. It keeps its original on_hand/unsellable column grants for ordinary
-- inventory work, while reservation mutation goes through these two
-- SECURITY DEFINER functions. They have a fixed search_path, validate the
-- order/reservation/line and the expected inventory version/reserved values,
-- and are executable only by the provisioned runtime role.

CREATE OR REPLACE FUNCTION aoking_reserve_inventory(
  p_reservation_id uuid,
  p_order_id uuid,
  p_sku_id uuid,
  p_warehouse_id uuid,
  p_quantity integer,
  p_expected_reservation_version bigint,
  p_expected_inventory_version bigint,
  p_expected_reserved integer,
  p_actor_id uuid
) RETURNS TABLE(reserved_before integer, reserved_after integer, version_after bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
  v_reservation_version bigint;
  v_line_id uuid;
  v_line_quantity integer;
  v_on_hand integer;
  v_reserved integer;
  v_unsellable integer;
  v_version bigint;
  v_ledger_id uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;
  SELECT r.status, r.reservation_version
    INTO v_status, v_reservation_version
    FROM public.order_reservations r
   WHERE r.id = p_reservation_id AND r.order_id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found';
  END IF;
  IF v_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'reservation_not_active';
  END IF;
  IF v_reservation_version <> p_expected_reservation_version THEN
    RAISE EXCEPTION 'reservation_version_conflict';
  END IF;
  SELECT rl.id, rl.quantity
    INTO v_line_id, v_line_quantity
    FROM public.order_reservation_lines rl
   WHERE rl.reservation_id = p_reservation_id
     AND rl.order_id = p_order_id
     AND rl.sku_id = p_sku_id
     AND rl.warehouse_id = p_warehouse_id;
  IF NOT FOUND OR v_line_quantity <> p_quantity THEN
    RAISE EXCEPTION 'reservation_line_mismatch';
  END IF;
  SELECT b.on_hand, b.reserved, b.unsellable, b.version
    INTO v_on_hand, v_reserved, v_unsellable, v_version
    FROM public.inventory_balances b
   WHERE b.sku_id = p_sku_id AND b.warehouse_id = p_warehouse_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory_not_found';
  END IF;
  IF v_version <> p_expected_inventory_version OR v_reserved <> p_expected_reserved THEN
    RAISE EXCEPTION 'inventory_conflict';
  END IF;
  IF v_on_hand - v_reserved - v_unsellable < p_quantity THEN
    RAISE EXCEPTION 'insufficient_stock';
  END IF;
  INSERT INTO public.order_reservation_ledger
    (reservation_id, reservation_line_id, order_id, action, quantity,
     inventory_before, inventory_after, version_after, actor_id)
  VALUES
    (p_reservation_id, v_line_id, p_order_id, 'reserve', p_quantity,
     v_reserved, v_reserved + p_quantity, v_version + 1, p_actor_id)
  ON CONFLICT (reservation_line_id, action) DO NOTHING
  RETURNING id INTO v_ledger_id;
  IF v_ledger_id IS NULL THEN
    RAISE EXCEPTION 'reservation_already_applied';
  END IF;
  UPDATE public.inventory_balances
     SET reserved = v_reserved + p_quantity,
         version = v_version + 1,
         updated_at = now(),
         updated_by = p_actor_id
   WHERE sku_id = p_sku_id AND warehouse_id = p_warehouse_id;
  reserved_before := v_reserved;
  reserved_after := v_reserved + p_quantity;
  version_after := v_version + 1;
  RETURN NEXT;
END;
$$;

DROP FUNCTION IF EXISTS aoking_release_inventory(
  uuid, uuid, uuid, uuid, integer, bigint, integer, uuid
);

CREATE OR REPLACE FUNCTION aoking_release_inventory(
  p_reservation_id uuid,
  p_order_id uuid,
  p_release_request_id uuid,
  p_sku_id uuid,
  p_warehouse_id uuid,
  p_quantity integer,
  p_expected_inventory_version bigint,
  p_expected_reserved integer,
  p_actor_id uuid
) RETURNS TABLE(reserved_before integer, reserved_after integer, version_after bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
  v_line_count integer;
  v_line_quantity integer;
  v_inserted integer;
  v_on_hand integer;
  v_reserved integer;
  v_unsellable integer;
  v_version bigint;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;
  SELECT r.status
    INTO v_status
    FROM public.order_reservations r
   WHERE r.id = p_reservation_id AND r.order_id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found';
  END IF;
  IF v_status NOT IN ('ACTIVE', 'EXPIRED') THEN
    RAISE EXCEPTION 'reservation_not_releasable';
  END IF;
  -- Release is only executable against the same order's approved execution
  -- record. A direct SQL caller cannot release stock without that approval.
  IF NOT EXISTS (
    SELECT 1
      FROM public.order_release_requests q
     WHERE q.id = p_release_request_id
       AND q.order_id = p_order_id
       AND q.status = 'APPROVED'
       AND q.executed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'release_not_approved';
  END IF;
  SELECT COUNT(*)::int, COALESCE(SUM(rl.quantity), 0)::int
    INTO v_line_count, v_line_quantity
    FROM public.order_reservation_lines rl
   WHERE rl.reservation_id = p_reservation_id
     AND rl.order_id = p_order_id
     AND rl.sku_id = p_sku_id
     AND rl.warehouse_id = p_warehouse_id;
  IF v_line_count = 0 OR v_line_quantity <> p_quantity THEN
    RAISE EXCEPTION 'reservation_line_mismatch';
  END IF;
  SELECT b.on_hand, b.reserved, b.unsellable, b.version
    INTO v_on_hand, v_reserved, v_unsellable, v_version
    FROM public.inventory_balances b
   WHERE b.sku_id = p_sku_id AND b.warehouse_id = p_warehouse_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory_not_found';
  END IF;
  IF v_version <> p_expected_inventory_version OR v_reserved <> p_expected_reserved THEN
    RAISE EXCEPTION 'inventory_conflict';
  END IF;
  IF v_reserved < p_quantity THEN
    RAISE EXCEPTION 'reservation_inconsistent';
  END IF;
  INSERT INTO public.order_reservation_ledger
    (reservation_id, reservation_line_id, order_id, action, quantity,
     inventory_before, inventory_after, version_after, actor_id)
  SELECT p_reservation_id, rl.id, p_order_id, 'release', rl.quantity,
         v_reserved, v_reserved - p_quantity, v_version + 1, p_actor_id
    FROM public.order_reservation_lines rl
   WHERE rl.reservation_id = p_reservation_id
     AND rl.order_id = p_order_id
     AND rl.sku_id = p_sku_id
     AND rl.warehouse_id = p_warehouse_id
  ON CONFLICT (reservation_line_id, action) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> v_line_count THEN
    RAISE EXCEPTION 'reservation_already_released';
  END IF;
  UPDATE public.inventory_balances
     SET reserved = v_reserved - p_quantity,
         version = v_version + 1,
         updated_at = now(),
         updated_by = p_actor_id
   WHERE sku_id = p_sku_id AND warehouse_id = p_warehouse_id;
  reserved_before := v_reserved;
  reserved_after := v_reserved - p_quantity;
  version_after := v_version + 1;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION aoking_reserve_inventory(
  uuid, uuid, uuid, uuid, integer, bigint, bigint, integer, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION aoking_release_inventory(
  uuid, uuid, uuid, uuid, uuid, integer, bigint, integer, uuid
) FROM PUBLIC;

INSERT INTO system_metadata (key, value)
VALUES ('schema_version', '4b05')
ON CONFLICT (key)
DO UPDATE SET value = EXCLUDED.value, updated_at = now();
