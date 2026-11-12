-- Phase 4B-03: persistent catalog, media metadata, warehouses and inventory.
-- No products, SKUs, series, tags, warehouses or stock are seeded. The existing
-- brands rows from 002 are reused. Historical migrations are not modified.

CREATE TABLE IF NOT EXISTS series_definitions (
  id text PRIMARY KEY,
  name_zh text NOT NULL,
  name_en text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feature_tags (
  id text PRIMARY KEY CHECK (id ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name_zh text NOT NULL,
  name_en text NOT NULL,
  tone text NOT NULL DEFAULT 'orange'
    CHECK (tone IN ('orange', 'blue', 'sky', 'green', 'grey', 'purple')),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY,
  brand_id text NOT NULL REFERENCES brands(id),
  product_code text NOT NULL UNIQUE CHECK (length(btrim(product_code)) BETWEEN 1 AND 64),
  title text NOT NULL,
  title_en text NOT NULL,
  description text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  category text NOT NULL,
  material text NOT NULL DEFAULT '',
  capacity_or_size text NOT NULL DEFAULT '',
  series_id text REFERENCES series_definitions(id),
  published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_by uuid REFERENCES internal_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_brand_idx ON products(brand_id);
CREATE INDEX IF NOT EXISTS products_series_idx ON products(series_id);
CREATE INDEX IF NOT EXISTS products_published_idx ON products(published);

CREATE TABLE IF NOT EXISTS product_images (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id),
  storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 4194304),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  sort_order integer NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  removed_at timestamptz,
  uploaded_by uuid REFERENCES internal_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_images_one_primary
  ON product_images(product_id)
  WHERE is_primary AND removed_at IS NULL;

CREATE TABLE IF NOT EXISTS product_skus (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id),
  sku_code text NOT NULL UNIQUE CHECK (length(btrim(sku_code)) BETWEEN 1 AND 64),
  color_name text NOT NULL,
  color_name_en text NOT NULL,
  color_hex text NOT NULL CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  base_price_cents integer NOT NULL CHECK (base_price_cents > 0),
  sellable_status text NOT NULL DEFAULT 'active'
    CHECK (sellable_status IN ('active', 'discontinued')),
  image_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (product_id, image_id) REFERENCES product_images(product_id, id)
);

CREATE INDEX IF NOT EXISTS product_skus_product_idx ON product_skus(product_id);

CREATE TABLE IF NOT EXISTS product_feature_tags (
  product_id uuid NOT NULL REFERENCES products(id),
  tag_id text NOT NULL REFERENCES feature_tags(id),
  PRIMARY KEY (product_id, tag_id)
);

CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
  name text NOT NULL,
  name_en text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_balances (
  sku_id uuid NOT NULL REFERENCES product_skus(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  on_hand integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  unsellable integer NOT NULL DEFAULT 0 CHECK (unsellable >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES internal_users(id),
  PRIMARY KEY (sku_id, warehouse_id),
  CHECK (on_hand >= reserved + unsellable)
);

CREATE TABLE IF NOT EXISTS inventory_import_batches (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  source_name text,
  status text NOT NULL DEFAULT 'previewed'
    CHECK (status IN ('previewed', 'committed', 'failed')),
  row_count integer NOT NULL CHECK (row_count >= 0 AND row_count <= 500),
  created_by uuid REFERENCES internal_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz
);

CREATE TABLE IF NOT EXISTS inventory_import_rows (
  batch_id uuid NOT NULL REFERENCES inventory_import_batches(id),
  row_number integer NOT NULL CHECK (row_number > 0),
  sku_id uuid NOT NULL REFERENCES product_skus(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  on_hand_new integer NOT NULL CHECK (on_hand_new >= 0),
  unsellable_new integer NOT NULL CHECK (unsellable_new >= 0),
  on_hand_before integer NOT NULL CHECK (on_hand_before >= 0),
  unsellable_before integer NOT NULL CHECK (unsellable_before >= 0),
  reserved_before integer NOT NULL CHECK (reserved_before >= 0),
  version_before bigint NOT NULL CHECK (version_before > 0),
  PRIMARY KEY (batch_id, row_number),
  CHECK (on_hand_new >= reserved_before + unsellable_new)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY,
  sku_id uuid NOT NULL REFERENCES product_skus(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  movement_type text NOT NULL
    CHECK (movement_type IN ('initial', 'adjustment', 'import')),
  delta_on_hand integer NOT NULL,
  delta_unsellable integer NOT NULL,
  on_hand_before integer NOT NULL CHECK (on_hand_before >= 0),
  on_hand_after integer NOT NULL CHECK (on_hand_after >= 0),
  unsellable_before integer NOT NULL CHECK (unsellable_before >= 0),
  unsellable_after integer NOT NULL CHECK (unsellable_after >= 0),
  reserved_after integer NOT NULL CHECK (reserved_after >= 0),
  reason text NOT NULL DEFAULT '',
  actor_type text NOT NULL CHECK (actor_type IN ('internal', 'system')),
  actor_id uuid,
  actor_label text NOT NULL,
  import_batch_id uuid REFERENCES inventory_import_batches(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (on_hand_after >= reserved_after + unsellable_after)
);

CREATE INDEX IF NOT EXISTS inventory_movements_sku_idx
  ON inventory_movements(sku_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_batch_idx
  ON inventory_movements(import_batch_id);

-- Phase 4B-03 permissions. Existing roles keep their 4B-02 permissions.
INSERT INTO permissions (id, description) VALUES
  ('catalog.read', 'Read the internal product catalogue'),
  ('inventory.read', 'Read warehouse stock without changing it')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('admin', 'catalog.read'),
  ('admin', 'inventory.read'),
  ('sales', 'catalog.read'),
  ('sales', 'inventory.read'),
  ('auditor', 'catalog.read')
ON CONFLICT DO NOTHING;

INSERT INTO system_metadata (key, value)
VALUES ('schema_version', '4b03')
ON CONFLICT (key)
DO UPDATE SET value = EXCLUDED.value, updated_at = now();
