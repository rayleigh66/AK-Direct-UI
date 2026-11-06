-- Phase 4B-04: company shared cart, customer order submission, order history
-- and a pending-notification outbox. No cart, order or notification rows are
-- seeded. Historical migrations 001-004 are not modified.
--
-- This phase can only produce PENDING_CONFIRMATION and CANCELLED orders. The
-- remaining frozen statuses are present in order_statuses as the explicit
-- extension contract for Phase 4B-05 (confirmation, payment, shipment); no API
-- writes them here.

CREATE TABLE IF NOT EXISTS order_statuses (
  id text PRIMARY KEY CHECK (id ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  customer_label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

INSERT INTO order_statuses (id, customer_label, sort_order) VALUES
  ('DRAFT', 'Draft', 10),
  ('PENDING_CONFIRMATION', 'Pending confirmation', 20),
  ('CONFIRMED', 'Confirmed', 30),
  ('PAYMENT_RECORDED', 'Payment recorded', 40),
  ('PREPARING_SHIPMENT', 'Preparing shipment', 50),
  ('SHIPPED', 'Shipped', 60),
  ('DELIVERED', 'Delivered', 70),
  ('COMPLETED', 'Completed', 80),
  ('CANCELLED', 'Cancelled', 90),
  ('RESERVATION_EXPIRED', 'Reservation expired', 100)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS company_carts (
  company_id uuid PRIMARY KEY REFERENCES customer_companies(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cart_items (
  company_id uuid NOT NULL REFERENCES company_carts(company_id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES product_skus(id),
  quantity integer NOT NULL CHECK (quantity >= 10 AND quantity <= 1000000),
  updated_by uuid REFERENCES customer_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, sku_id)
);

CREATE INDEX IF NOT EXISTS cart_items_sku_idx ON cart_items(sku_id);

CREATE TABLE IF NOT EXISTS order_sequences (
  order_date date PRIMARY KEY,
  -- 10000 is reachable only to detect exhaustion; the API never issues it.
  next_seq integer NOT NULL CHECK (next_seq >= 1 AND next_seq <= 10000)
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  order_no text NOT NULL UNIQUE CHECK (order_no ~ '^OD[0-9]{10}$'),
  company_id uuid NOT NULL REFERENCES customer_companies(id),
  submitted_by_user_id uuid NOT NULL REFERENCES customer_users(id),
  assigned_sales_user_id uuid REFERENCES internal_users(id) ON DELETE SET NULL,
  status text NOT NULL REFERENCES order_statuses(id),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  shipping_method text NOT NULL CHECK (
    shipping_method IN ('Express', 'Air', 'Sea', 'Customer Pickup', 'Other')
  ),
  destination_country_alpha3 char(3) NOT NULL
    CHECK (destination_country_alpha3 ~ '^[A-Z]{3}$'),
  expected_ship_date date NOT NULL,
  shipping_requirements text NOT NULL DEFAULT ''
    CHECK (length(shipping_requirements) <= 1000),
  pricing_mode text NOT NULL CHECK (pricing_mode IN ('base_reference')),
  pricing_version text NOT NULL CHECK (length(pricing_version) BETWEEN 1 AND 64),
  is_reference_quote boolean NOT NULL DEFAULT true,
  reference_total_cents bigint NOT NULL
    CHECK (reference_total_cents > 0 AND reference_total_cents <= 9000000000000),
  customer_visible_note text NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancel_reason text CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 500),
  CHECK (status = 'CANCELLED' OR cancelled_at IS NULL),
  CHECK (cancelled_at IS NULL OR status = 'CANCELLED')
);

CREATE INDEX IF NOT EXISTS orders_company_idx ON orders(company_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS orders_sales_idx ON orders(assigned_sales_user_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
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
  base_unit_price_cents integer NOT NULL
    CHECK (base_unit_price_cents > 0 AND base_unit_price_cents <= 100000000),
  reference_unit_price_cents integer NOT NULL
    CHECK (reference_unit_price_cents > 0 AND reference_unit_price_cents <= 100000000),
  line_reference_cents bigint NOT NULL
    CHECK (line_reference_cents > 0 AND line_reference_cents <= 9000000000000),
  price_source text NOT NULL CHECK (price_source IN ('base_price')),
  pricing_version text NOT NULL CHECK (length(pricing_version) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, line_number),
  UNIQUE (order_id, sku_id),
  CHECK (line_reference_cents = reference_unit_price_cents::bigint * quantity)
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id, line_number);
CREATE INDEX IF NOT EXISTS order_items_sku_idx ON order_items(sku_id);

CREATE TABLE IF NOT EXISTS order_idempotency (
  company_id uuid NOT NULL REFERENCES customer_companies(id),
  submitted_by_user_id uuid NOT NULL REFERENCES customer_users(id),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, submitted_by_user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  event_type text NOT NULL CHECK (
    event_type IN ('SUBMITTED', 'LINES_MODIFIED', 'CANCELLED', 'ADMIN_CANCELLED')
  ),
  from_status text REFERENCES order_statuses(id),
  to_status text NOT NULL REFERENCES order_statuses(id),
  actor_type text NOT NULL CHECK (actor_type IN ('customer', 'internal', 'system')),
  actor_id uuid,
  actor_label text NOT NULL,
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 1000),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_status_history_order_idx
  ON order_status_history(order_id, created_at);

CREATE TABLE IF NOT EXISTS order_notifications (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  company_id uuid NOT NULL REFERENCES customer_companies(id),
  audience text NOT NULL CHECK (audience IN ('customer', 'sales')),
  internal_user_id uuid REFERENCES internal_users(id),
  event_type text NOT NULL CHECK (
    event_type IN ('ORDER_SUBMITTED', 'ORDER_MODIFIED', 'ORDER_CANCELLED', 'ORDER_CANCELLED_BY_ADMIN')
  ),
  title text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CHECK (
    (audience = 'customer' AND internal_user_id IS NULL)
    OR
    (audience = 'sales' AND internal_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS order_notifications_order_idx ON order_notifications(order_id);
CREATE INDEX IF NOT EXISTS order_notifications_pending_idx
  ON order_notifications(status, created_at);

-- Phase 4B-03 P1 fixes ------------------------------------------------------

-- Bind an inventory-import idempotency key to the actor and a canonical digest
-- of the full payload. Existing preview batches keep a NULL digest and are
-- refused for reuse because their original payload cannot be verified.
ALTER TABLE inventory_import_batches
  ADD COLUMN IF NOT EXISTS payload_digest text;

-- Persist the immutable committed result so a repeated commit returns the
-- original outcome instead of later inventory adjustments.
CREATE TABLE IF NOT EXISTS inventory_import_commit_results (
  batch_id uuid PRIMARY KEY REFERENCES inventory_import_batches(id),
  committed_at timestamptz NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system_metadata (key, value)
VALUES ('schema_version', '4b04')
ON CONFLICT (key)
DO UPDATE SET value = EXCLUDED.value, updated_at = now();
