import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { DbPool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { writeAudit } from '../audit/audit.js';
import { HttpError } from '../http/errors.js';
import type { AuthContext } from '../auth/types.js';

const WAREHOUSE_CODE = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
const MAX_QUANTITY = 100_000_000;
const MAX_IMPORT_ROWS = 500;

export interface WarehouseDto {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  name_en: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function warehouseDto(row: WarehouseRow): WarehouseDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameEn: row.name_en,
    active: row.active,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function actor(auth: AuthContext) {
  return {
    actorType: auth.user.type,
    actorId: auth.user.id,
    actorLabel: auth.user.username,
  };
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'invalid_request', `${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, 'invalid_request', `${field} is too long.`);
  return trimmed;
}

function quantity(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_QUANTITY) {
    throw new HttpError(400, 'invalid_quantity', `${field} must be a non-negative whole number.`);
  }
  return value;
}

function checkBalance(onHand: number, unsellable: number, reserved: number): void {
  if (unsellable > onHand) {
    throw new HttpError(422, 'invalid_inventory', 'Unsellable quantity cannot exceed on-hand quantity.');
  }
  if (onHand - unsellable < reserved) {
    throw new HttpError(
      422,
      'invalid_inventory',
      'On-hand minus unsellable cannot be lower than the already reserved quantity.'
    );
  }
}

export async function listWarehouses(pool: DbPool): Promise<WarehouseDto[]> {
  const result = await pool.query<WarehouseRow>('SELECT * FROM warehouses ORDER BY code');
  return result.rows.map(warehouseDto);
}

export async function createWarehouse(
  pool: DbPool,
  auth: AuthContext,
  input: { code: string; name: string; nameEn: string; active?: boolean }
): Promise<WarehouseDto> {
  const code = text(input.code, 'code', 32).toUpperCase();
  if (!WAREHOUSE_CODE.test(code)) {
    throw new HttpError(400, 'invalid_warehouse_code', 'Warehouse code must be uppercase letters, digits or hyphens.');
  }
  const name = text(input.name, 'name', 200);
  const nameEn = text(input.nameEn, 'nameEn', 200);
  return withTransaction(pool, async client => {
    const duplicate = await client.query('SELECT 1 FROM warehouses WHERE code = $1', [code]);
    if (duplicate.rowCount) {
      throw new HttpError(409, 'duplicate_warehouse_code', `Warehouse ${code} already exists.`);
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO warehouses (id, code, name, name_en, active)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, code, name, nameEn, input.active ?? true]
    );
    await writeAudit(client, {
      ...actor(auth),
      action: 'CREATE_WAREHOUSE',
      targetType: 'warehouse',
      targetId: id,
      details: { code },
    });
    const rows = await client.query<WarehouseRow>('SELECT * FROM warehouses WHERE id = $1', [id]);
    return warehouseDto(rows.rows[0]);
  });
}

export async function updateWarehouse(
  pool: DbPool,
  auth: AuthContext,
  warehouseId: string,
  input: { name?: string; nameEn?: string; active?: boolean }
): Promise<WarehouseDto> {
  if (input.active !== undefined && typeof input.active !== 'boolean') {
    throw new HttpError(400, 'invalid_request', 'active must be a boolean.');
  }
  return withTransaction(pool, async client => {
    const existing = await client.query<WarehouseRow>(
      'SELECT * FROM warehouses WHERE id = $1 FOR UPDATE',
      [warehouseId]
    );
    if (!existing.rows[0]) throw new HttpError(404, 'warehouse_not_found', 'Warehouse not found.');
    await client.query(
      `UPDATE warehouses SET
        name = COALESCE($2, name),
        name_en = COALESCE($3, name_en),
        active = COALESCE($4, active),
        updated_at = now()
       WHERE id = $1`,
      [
        warehouseId,
        input.name === undefined ? null : text(input.name, 'name', 200),
        input.nameEn === undefined ? null : text(input.nameEn, 'nameEn', 200),
        input.active ?? null,
      ]
    );
    await writeAudit(client, {
      ...actor(auth),
      action: 'UPDATE_WAREHOUSE',
      targetType: 'warehouse',
      targetId: warehouseId,
      details: { fields: Object.keys(input) },
    });
    const rows = await client.query<WarehouseRow>('SELECT * FROM warehouses WHERE id = $1', [warehouseId]);
    return warehouseDto(rows.rows[0]);
  });
}

export interface InventoryRowDto {
  skuId: string;
  skuCode: string;
  productId: string;
  productCode: string;
  productTitle: string;
  colorHex: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  onHand: number;
  reserved: number;
  unsellable: number;
  available: number;
  version: number;
  updatedAt: string;
}

interface InventoryRow {
  sku_id: string;
  sku_code: string;
  product_id: string;
  product_code: string;
  product_title: string;
  color_hex: string;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  on_hand: number;
  reserved: number;
  unsellable: number;
  version: string;
  updated_at: Date;
}

function inventoryDto(row: InventoryRow): InventoryRowDto {
  return {
    skuId: row.sku_id,
    skuCode: row.sku_code,
    productId: row.product_id,
    productCode: row.product_code,
    productTitle: row.product_title,
    colorHex: row.color_hex,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name,
    onHand: row.on_hand,
    reserved: row.reserved,
    unsellable: row.unsellable,
    available: Math.max(0, row.on_hand - row.reserved - row.unsellable),
    version: Number(row.version),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const INVENTORY_SELECT = `
  SELECT b.sku_id, s.sku_code, s.product_id, p.product_code, p.title AS product_title,
         s.color_hex, b.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
         b.on_hand, b.reserved, b.unsellable, b.version, b.updated_at
  FROM inventory_balances b
  JOIN product_skus s ON s.id = b.sku_id
  JOIN products p ON p.id = s.product_id
  JOIN warehouses w ON w.id = b.warehouse_id
`;

export async function listInventory(
  pool: DbPool,
  filters: { warehouseId?: string; skuId?: string; search?: string } = {}
): Promise<InventoryRowDto[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let index = 1;
  if (filters.warehouseId) {
    conditions.push(`b.warehouse_id = $${index++}`);
    values.push(filters.warehouseId);
  }
  if (filters.skuId) {
    conditions.push(`b.sku_id = $${index++}`);
    values.push(filters.skuId);
  }
  if (filters.search) {
    conditions.push(
      `(s.sku_code ILIKE $${index} OR p.product_code ILIKE $${index} OR p.title ILIKE $${index} OR w.code ILIKE $${index})`
    );
    values.push(`%${filters.search}%`);
    index++;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query<InventoryRow>(
    INVENTORY_SELECT + ` ${where} ORDER BY p.product_code, s.sku_code, w.code`,
    values
  );
  return result.rows.map(inventoryDto);
}

async function requireSku(client: PoolClient, skuId: string): Promise<{ id: string; sku_code: string }> {
  const rows = await client.query<{ id: string; sku_code: string }>(
    'SELECT id, sku_code FROM product_skus WHERE id = $1',
    [skuId]
  );
  if (!rows.rows[0]) throw new HttpError(404, 'sku_not_found', 'SKU not found.');
  return rows.rows[0];
}

async function requireWarehouse(client: PoolClient, warehouseId: string): Promise<void> {
  const rows = await client.query('SELECT 1 FROM warehouses WHERE id = $1 AND active = true', [warehouseId]);
  if (!rows.rowCount) throw new HttpError(400, 'invalid_warehouse', 'Warehouse is invalid or inactive.');
}

export interface RegisterInventoryInput {
  skuId: string;
  warehouseId: string;
  onHand: number;
  unsellable?: number;
  reason: string;
}

export async function registerInventory(
  pool: DbPool,
  auth: AuthContext,
  input: RegisterInventoryInput
): Promise<InventoryRowDto> {
  const onHand = quantity(input.onHand, 'onHand');
  const unsellable = quantity(input.unsellable ?? 0, 'unsellable');
  const reason = text(input.reason, 'reason', 500);
  checkBalance(onHand, unsellable, 0);

  return withTransaction(pool, async client => {
    const sku = await requireSku(client, input.skuId);
    await requireWarehouse(client, input.warehouseId);
    const existing = await client.query(
      'SELECT 1 FROM inventory_balances WHERE sku_id = $1 AND warehouse_id = $2 FOR UPDATE',
      [input.skuId, input.warehouseId]
    );
    if (existing.rowCount) {
      throw new HttpError(409, 'inventory_exists', 'This SKU and warehouse already has an inventory row.');
    }
    await client.query(
      `INSERT INTO inventory_balances (sku_id, warehouse_id, on_hand, unsellable, updated_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.skuId, input.warehouseId, onHand, unsellable, auth.user.id]
    );
    await client.query(
      `INSERT INTO inventory_movements
        (id, sku_id, warehouse_id, movement_type, delta_on_hand, delta_unsellable,
         on_hand_before, on_hand_after, unsellable_before, unsellable_after,
         reserved_after, reason, actor_type, actor_id, actor_label)
       VALUES ($1, $2, $3, 'initial', $4, $5, 0, $4, 0, $5, 0, $6, 'internal', $7, $8)`,
      [randomUUID(), input.skuId, input.warehouseId, onHand, unsellable, reason, auth.user.id, auth.user.username]
    );
    await writeAudit(client, {
      ...actor(auth),
      action: 'REGISTER_INVENTORY',
      targetType: 'inventory_balance',
      targetId: `${input.skuId}:${input.warehouseId}`,
      details: { skuCode: sku.sku_code, onHand, unsellable, reason },
    });
    const rows = await client.query<InventoryRow>(
      INVENTORY_SELECT + ' WHERE b.sku_id = $1 AND b.warehouse_id = $2',
      [input.skuId, input.warehouseId]
    );
    return inventoryDto(rows.rows[0]);
  });
}

export interface AdjustInventoryInput {
  onHand?: number;
  unsellable?: number;
  expectedVersion: number;
  reason: string;
}

export async function adjustInventory(
  pool: DbPool,
  auth: AuthContext,
  skuId: string,
  warehouseId: string,
  input: AdjustInventoryInput
): Promise<InventoryRowDto> {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new HttpError(400, 'invalid_version', 'expectedVersion is required.');
  }
  const reason = text(input.reason, 'reason', 500);
  if (input.onHand === undefined && input.unsellable === undefined) {
    throw new HttpError(400, 'invalid_request', 'Provide onHand or unsellable to adjust.');
  }
  const nextOnHand = input.onHand === undefined ? undefined : quantity(input.onHand, 'onHand');
  const nextUnsellable =
    input.unsellable === undefined ? undefined : quantity(input.unsellable, 'unsellable');

  return withTransaction(pool, async client => {
    const current = await client.query<{ on_hand: number; reserved: number; unsellable: number; version: string }>(
      `SELECT on_hand, reserved, unsellable, version FROM inventory_balances
       WHERE sku_id = $1 AND warehouse_id = $2 FOR UPDATE`,
      [skuId, warehouseId]
    );
    if (!current.rows[0]) {
      throw new HttpError(404, 'inventory_not_found', 'Inventory row not found. Register it first.');
    }
    const row = current.rows[0];
    if (Number(row.version) !== input.expectedVersion) {
      throw new HttpError(409, 'version_conflict', 'Inventory changed since it was loaded. Reload and retry.');
    }
    const onHand = nextOnHand ?? row.on_hand;
    const unsellable = nextUnsellable ?? row.unsellable;
    checkBalance(onHand, unsellable, row.reserved);

    await client.query(
      `UPDATE inventory_balances SET
        on_hand = $3, unsellable = $4, version = version + 1,
        updated_at = now(), updated_by = $5
       WHERE sku_id = $1 AND warehouse_id = $2 AND version = $6`,
      [skuId, warehouseId, onHand, unsellable, auth.user.id, input.expectedVersion]
    );
    await client.query(
      `INSERT INTO inventory_movements
        (id, sku_id, warehouse_id, movement_type, delta_on_hand, delta_unsellable,
         on_hand_before, on_hand_after, unsellable_before, unsellable_after,
         reserved_after, reason, actor_type, actor_id, actor_label)
       VALUES ($1, $2, $3, 'adjustment', $4, $5, $6, $7, $8, $9, $10, $11, 'internal', $12, $13)`,
      [
        randomUUID(), skuId, warehouseId, onHand - row.on_hand, unsellable - row.unsellable,
        row.on_hand, onHand, row.unsellable, unsellable, row.reserved, reason,
        auth.user.id, auth.user.username,
      ]
    );
    await writeAudit(client, {
      ...actor(auth),
      action: 'ADJUST_INVENTORY',
      targetType: 'inventory_balance',
      targetId: `${skuId}:${warehouseId}`,
      details: { onHandBefore: row.on_hand, onHandAfter: onHand, unsellableBefore: row.unsellable, unsellableAfter: unsellable, reason },
    });
    const rows = await client.query<InventoryRow>(
      INVENTORY_SELECT + ' WHERE b.sku_id = $1 AND b.warehouse_id = $2',
      [skuId, warehouseId]
    );
    return inventoryDto(rows.rows[0]);
  });
}

// --- Import -----------------------------------------------------------------

export interface ImportLineInput {
  rowNumber: number;
  skuCode: string;
  warehouseCode: string;
  onHand: number;
  unsellable: number;
}

export interface ImportPreviewRow {
  rowNumber: number;
  skuId: string;
  skuCode: string;
  warehouseId: string;
  warehouseCode: string;
  onHandBefore: number;
  unsellableBefore: number;
  reserved: number;
  onHandNew: number;
  unsellableNew: number;
  versionBefore: number;
}

export interface ImportPreviewDto {
  batchId: string;
  idempotencyKey: string;
  status: 'previewed' | 'committed' | 'failed';
  sourceName: string | null;
  createdAt: string;
  rows: ImportPreviewRow[];
}

interface ImportBatchRow {
  id: string;
  idempotency_key: string;
  payload_digest: string | null;
  source_name: string | null;
  status: 'previewed' | 'committed' | 'failed';
  created_at: Date;
  committed_at: Date | null;
  created_by: string | null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  );
}

/**
 * Canonical payload digest: fixed key order, trimmed source name, rows sorted by
 * their business key. Re-ordering JSON object keys cannot create a false
 * mismatch; a genuinely different row set cannot reuse another batch.
 */
function importPayloadDigest(
  sourceName: string | null,
  rows: Array<{ rowNumber: number; skuCode: string; warehouseCode: string; onHand: unknown; unsellable: unknown }>
): string {
  const normalizedRows = rows
    .map(row => ({
      rowNumber: row.rowNumber,
      skuCode: row.skuCode,
      warehouseCode: row.warehouseCode,
      onHand: row.onHand,
      unsellable: row.unsellable,
    }))
    .sort((left, right) => {
      if (left.rowNumber !== right.rowNumber) return left.rowNumber - right.rowNumber;
      if (left.skuCode !== right.skuCode) return left.skuCode.localeCompare(right.skuCode);
      return left.warehouseCode.localeCompare(right.warehouseCode);
    });
  const canonical = JSON.stringify({ sourceName, rows: normalizedRows });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function normalizedImportRows(input: PreviewImportInput): Array<{
  rowNumber: number;
  skuCode: string;
  warehouseCode: string;
  onHand: unknown;
  unsellable: unknown;
}> {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  return rows.map((line, index) => ({
    rowNumber:
      Number.isInteger(line?.rowNumber) && Number(line.rowNumber) > 0
        ? Number(line.rowNumber)
        : index + 1,
    skuCode: String(line?.skuCode ?? '').trim().toUpperCase(),
    warehouseCode: String(line?.warehouseCode ?? '').trim().toUpperCase(),
    onHand: line?.onHand,
    unsellable: line?.unsellable,
  }));
}

async function resolveExistingPreview(
  db: PoolClient | DbPool,
  auth: AuthContext,
  idempotencyKey: string,
  digest: string
): Promise<ImportPreviewDto> {
  const existing = await db.query<ImportBatchRow>(
    'SELECT * FROM inventory_import_batches WHERE idempotency_key = $1',
    [idempotencyKey]
  );
  const batch = existing.rows[0];
  if (!batch) {
    throw new HttpError(
      409,
      'idempotency_conflict',
      'The import idempotency key could not be resolved. Use a new key.'
    );
  }
  if (batch.created_by !== auth.user.id || batch.payload_digest !== digest) {
    throw new HttpError(
      409,
      'idempotency_conflict',
      'This idempotency key was already used for another import payload or actor. Use a new key.'
    );
  }
  return loadPreview(db, batch.id);
}

async function loadPreview(client: PoolClient | DbPool, batchId: string): Promise<ImportPreviewDto> {
  const batch = await client.query<ImportBatchRow>(
    'SELECT * FROM inventory_import_batches WHERE id = $1',
    [batchId]
  );
  if (!batch.rows[0]) throw new HttpError(404, 'import_not_found', 'Import preview not found.');
  const rows = await client.query<{
    row_number: number;
    sku_id: string;
    sku_code: string;
    warehouse_id: string;
    warehouse_code: string;
    on_hand_before: number;
    unsellable_before: number;
    reserved_before: number;
    on_hand_new: number;
    unsellable_new: number;
    version_before: string;
  }>(
    `SELECT r.row_number, r.sku_id, s.sku_code, r.warehouse_id, w.code AS warehouse_code,
            r.on_hand_before, r.unsellable_before, r.reserved_before, r.on_hand_new,
            r.unsellable_new, r.version_before
     FROM inventory_import_rows r
     JOIN product_skus s ON s.id = r.sku_id
     JOIN warehouses w ON w.id = r.warehouse_id
     WHERE r.batch_id = $1 ORDER BY r.row_number`,
    [batchId]
  );
  return {
    batchId: batch.rows[0].id,
    idempotencyKey: batch.rows[0].idempotency_key,
    status: batch.rows[0].status,
    sourceName: batch.rows[0].source_name,
    createdAt: new Date(batch.rows[0].created_at).toISOString(),
    rows: rows.rows.map(row => ({
      rowNumber: row.row_number,
      skuId: row.sku_id,
      skuCode: row.sku_code,
      warehouseId: row.warehouse_id,
      warehouseCode: row.warehouse_code,
      onHandBefore: row.on_hand_before,
      unsellableBefore: row.unsellable_before,
      reserved: row.reserved_before,
      onHandNew: row.on_hand_new,
      unsellableNew: row.unsellable_new,
      versionBefore: Number(row.version_before),
    })),
  };
}

export interface PreviewImportInput {
  sourceName?: string;
  idempotencyKey: string;
  rows: ImportLineInput[];
}

export async function previewImport(
  pool: DbPool,
  auth: AuthContext,
  input: PreviewImportInput
): Promise<ImportPreviewDto> {
  const idempotencyKey = text(input.idempotencyKey, 'idempotencyKey', 128);
  const sourceName = input.sourceName?.trim() || null;
  const digest = importPayloadDigest(sourceName, normalizedImportRows(input));

  // A retried preview returns the stored batch only when the same actor sends
  // the same canonical payload. A different payload or actor is rejected.
  const existing = await pool.query<ImportBatchRow>(
    'SELECT * FROM inventory_import_batches WHERE idempotency_key = $1',
    [idempotencyKey]
  );
  if (existing.rows[0]) return resolveExistingPreview(pool, auth, idempotencyKey, digest);

  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new HttpError(400, 'empty_import', 'The import file has no data rows.');
  }
  if (input.rows.length > MAX_IMPORT_ROWS) {
    throw new HttpError(413, 'import_too_large', `A maximum of ${MAX_IMPORT_ROWS} rows is supported.`);
  }

  try {
    return await withTransaction(pool, async client => {
    const seen = new Set<string>();
    const resolved: Array<ImportLineInput & { skuId: string; warehouseId: string; onHandBefore: number; unsellableBefore: number; reserved: number; version: number }> = [];

    for (const [index, line] of input.rows.entries()) {
      const rowNumber = Number.isInteger(line.rowNumber) && line.rowNumber > 0 ? line.rowNumber : index + 1;
      const skuCode = text(line.skuCode, `row ${rowNumber} sku_code`, 64).toUpperCase();
      const warehouseCode = text(line.warehouseCode, `row ${rowNumber} warehouse_code`, 32).toUpperCase();
      const onHand = quantity(line.onHand, `row ${rowNumber} on_hand`);
      const unsellable = quantity(line.unsellable, `row ${rowNumber} unsellable`);
      const key = `${skuCode}::${warehouseCode}`;
      if (seen.has(key)) {
        throw new HttpError(422, 'duplicate_import_row', `Row ${rowNumber} repeats ${skuCode} at ${warehouseCode}.`);
      }
      seen.add(key);

      const sku = await client.query<{ id: string }>('SELECT id FROM product_skus WHERE sku_code = $1', [skuCode]);
      if (!sku.rows[0]) {
        throw new HttpError(422, 'unknown_sku', `Row ${rowNumber}: SKU ${skuCode} does not exist.`);
      }
      const warehouse = await client.query<{ id: string; active: boolean }>(
        'SELECT id, active FROM warehouses WHERE code = $1',
        [warehouseCode]
      );
      if (!warehouse.rows[0]) {
        throw new HttpError(422, 'unknown_warehouse', `Row ${rowNumber}: warehouse ${warehouseCode} does not exist.`);
      }
      if (!warehouse.rows[0].active) {
        throw new HttpError(422, 'inactive_warehouse', `Row ${rowNumber}: warehouse ${warehouseCode} is inactive.`);
      }
      const balance = await client.query<{
        on_hand: number;
        reserved: number;
        unsellable: number;
        version: string;
      }>(
        'SELECT on_hand, reserved, unsellable, version FROM inventory_balances WHERE sku_id = $1 AND warehouse_id = $2',
        [sku.rows[0].id, warehouse.rows[0].id]
      );
      if (!balance.rows[0]) {
        throw new HttpError(
          422,
          'unknown_inventory_row',
          `Row ${rowNumber}: no inventory row exists for ${skuCode} at ${warehouseCode}.`
        );
      }
      const current = balance.rows[0];
      try {
        checkBalance(onHand, unsellable, current.reserved);
      } catch (error) {
        const message = error instanceof HttpError ? error.message : 'Invalid quantities.';
        throw new HttpError(422, 'invalid_import_quantity', `Row ${rowNumber}: ${message}`);
      }
      resolved.push({
        rowNumber,
        skuCode,
        warehouseCode,
        onHand,
        unsellable,
        skuId: sku.rows[0].id,
        warehouseId: warehouse.rows[0].id,
        onHandBefore: current.on_hand,
        unsellableBefore: current.unsellable,
        reserved: current.reserved,
        version: Number(current.version),
      });
    }

    const batchId = randomUUID();
    await client.query(
      `INSERT INTO inventory_import_batches
        (id, idempotency_key, payload_digest, source_name, status, row_count, created_by)
       VALUES ($1, $2, $3, $4, 'previewed', $5, $6)`,
      [batchId, idempotencyKey, digest, sourceName, resolved.length, auth.user.id]
    );
    for (const row of resolved) {
      await client.query(
        `INSERT INTO inventory_import_rows
          (batch_id, row_number, sku_id, warehouse_id, on_hand_new, unsellable_new,
           on_hand_before, unsellable_before, reserved_before, version_before)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          batchId, row.rowNumber, row.skuId, row.warehouseId, row.onHand, row.unsellable,
          row.onHandBefore, row.unsellableBefore, row.reserved, row.version,
        ]
      );
    }
    await writeAudit(client, {
      ...actor(auth),
      action: 'PREVIEW_INVENTORY_IMPORT',
      targetType: 'inventory_import_batch',
      targetId: batchId,
      details: { rows: resolved.length, sourceName: input.sourceName ?? null },
    });
    return loadPreview(client, batchId);
    });
  } catch (error) {
    // Two concurrent requests with the same key: the loser re-reads the winner's
    // batch and applies the same actor/payload binding instead of returning 500.
    if (isUniqueViolation(error)) {
      return resolveExistingPreview(pool, auth, idempotencyKey, digest);
    }
    throw error;
  }
}

export interface CommitImportResult {
  batchId: string;
  status: 'committed';
  alreadyCommitted: boolean;
  committedAt: string;
  rows: Array<{ skuCode: string; warehouseCode: string; onHand: number; unsellable: number; version: number }>;
}

type CommitRow = CommitImportResult['rows'][number];

async function readStoredCommitResult(
  client: PoolClient,
  batchId: string
): Promise<{ committedAt: string; rows: CommitRow[] } | null> {
  const stored = await client.query<{ committed_at: Date; result: { rows?: CommitRow[] } }>(
    'SELECT committed_at, result FROM inventory_import_commit_results WHERE batch_id = $1',
    [batchId]
  );
  if (!stored.rows[0]) return null;
  return {
    committedAt: new Date(stored.rows[0].committed_at).toISOString(),
    rows: Array.isArray(stored.rows[0].result?.rows) ? stored.rows[0].result.rows : [],
  };
}

async function storeCommitResult(
  client: PoolClient,
  batchId: string,
  committedAt: Date,
  rows: CommitRow[]
): Promise<void> {
  await client.query(
    `INSERT INTO inventory_import_commit_results (batch_id, committed_at, result)
     VALUES ($1, $2, $3)
     ON CONFLICT (batch_id) DO NOTHING`,
    [batchId, committedAt, JSON.stringify({ rows })]
  );
}

/**
 * A committed batch created before Phase 4B-04 has no stored result, but its
 * immutable preview rows already record the exact post-commit values. Persist
 * that outcome once so later commits never return subsequently adjusted stock.
 */
async function legacyCommitResult(
  client: PoolClient,
  batchId: string,
  committedAt: Date
): Promise<CommitRow[]> {
  const rows = await client.query<{
    sku_code: string;
    warehouse_code: string;
    on_hand_new: number;
    unsellable_new: number;
    version_before: string;
  }>(
    `SELECT s.sku_code, w.code AS warehouse_code, r.on_hand_new, r.unsellable_new,
            r.version_before
     FROM inventory_import_rows r
     JOIN product_skus s ON s.id = r.sku_id
     JOIN warehouses w ON w.id = r.warehouse_id
     WHERE r.batch_id = $1 ORDER BY r.row_number`,
    [batchId]
  );
  const result = rows.rows.map(row => ({
    skuCode: row.sku_code,
    warehouseCode: row.warehouse_code,
    onHand: row.on_hand_new,
    unsellable: row.unsellable_new,
    version: Number(row.version_before) + 1,
  }));
  await storeCommitResult(client, batchId, committedAt, result);
  return result;
}

export async function commitImport(
  pool: DbPool,
  auth: AuthContext,
  batchId: string
): Promise<CommitImportResult> {
  return withTransaction(pool, async client => {
    const batch = await client.query<{
      id: string;
      status: string;
      committed_at: Date | null;
      source_name: string | null;
      row_count: number;
    }>('SELECT * FROM inventory_import_batches WHERE id = $1 FOR UPDATE', [batchId]);
    if (!batch.rows[0]) throw new HttpError(404, 'import_not_found', 'Import preview not found.');

    if (batch.rows[0].status === 'committed') {
      const committedAt = batch.rows[0].committed_at ?? new Date();
      const stored = await readStoredCommitResult(client, batchId);
      const rows = stored
        ? stored.rows
        : await legacyCommitResult(client, batchId, committedAt);
      return {
        batchId,
        status: 'committed',
        alreadyCommitted: true,
        committedAt: (stored?.committedAt ?? new Date(committedAt).toISOString()),
        rows,
      };
    }

    const previewRows = await client.query<{
      row_number: number;
      sku_id: string;
      sku_code: string;
      warehouse_id: string;
      warehouse_code: string;
      on_hand_new: number;
      unsellable_new: number;
      on_hand_before: number;
      unsellable_before: number;
      reserved_before: number;
      version_before: string;
    }>(
      `SELECT r.*, s.sku_code, w.code AS warehouse_code
       FROM inventory_import_rows r
       JOIN product_skus s ON s.id = r.sku_id
       JOIN warehouses w ON w.id = r.warehouse_id
       WHERE r.batch_id = $1
       ORDER BY r.sku_id, r.warehouse_id`,
      [batchId]
    );

    // Deterministic lock order prevents two imports from deadlocking.
    const locked = new Map<string, { on_hand: number; reserved: number; unsellable: number; version: number }>();
    for (const row of previewRows.rows) {
      const lock = await client.query<{
        on_hand: number;
        reserved: number;
        unsellable: number;
        version: string;
      }>(
        `SELECT on_hand, reserved, unsellable, version FROM inventory_balances
         WHERE sku_id = $1 AND warehouse_id = $2 FOR UPDATE`,
        [row.sku_id, row.warehouse_id]
      );
      if (!lock.rows[0]) {
        throw new HttpError(409, 'stale_preview', `Inventory row for ${row.sku_code} no longer exists.`);
      }
      const current = lock.rows[0];
      if (
        Number(current.version) !== Number(row.version_before) ||
        current.on_hand !== row.on_hand_before ||
        current.unsellable !== row.unsellable_before ||
        current.reserved !== row.reserved_before
      ) {
        throw new HttpError(
          409,
          'stale_preview',
          `Inventory for ${row.sku_code} at ${row.warehouse_code} changed after preview. Refresh and preview again.`
        );
      }
      try {
        checkBalance(row.on_hand_new, row.unsellable_new, current.reserved);
      } catch (error) {
        const message = error instanceof HttpError ? error.message : 'Invalid quantities.';
        throw new HttpError(409, 'invalid_import_quantity', `Row ${row.row_number}: ${message}`);
      }
      locked.set(`${row.sku_id}:${row.warehouse_id}`, {
        on_hand: current.on_hand,
        reserved: current.reserved,
        unsellable: current.unsellable,
        version: Number(current.version),
      });
    }

    for (const row of previewRows.rows) {
      const current = locked.get(`${row.sku_id}:${row.warehouse_id}`)!;
      await client.query(
        `UPDATE inventory_balances SET
          on_hand = $3, unsellable = $4, version = version + 1,
          updated_at = now(), updated_by = $5
         WHERE sku_id = $1 AND warehouse_id = $2 AND version = $6`,
        [row.sku_id, row.warehouse_id, row.on_hand_new, row.unsellable_new, auth.user.id, current.version]
      );
      await client.query(
        `INSERT INTO inventory_movements
          (id, sku_id, warehouse_id, movement_type, delta_on_hand, delta_unsellable,
           on_hand_before, on_hand_after, unsellable_before, unsellable_after,
           reserved_after, reason, actor_type, actor_id, actor_label, import_batch_id)
         VALUES ($1, $2, $3, 'import', $4, $5, $6, $7, $8, $9, $10, $11, 'internal', $12, $13, $14)`,
        [
          randomUUID(), row.sku_id, row.warehouse_id,
          row.on_hand_new - current.on_hand, row.unsellable_new - current.unsellable,
          current.on_hand, row.on_hand_new, current.unsellable, row.unsellable_new,
          current.reserved, `Inventory import ${batch.rows[0].source_name ?? batchId}`,
          auth.user.id, auth.user.username, batchId,
        ]
      );
    }

    const committed = await client.query<{ committed_at: Date }>(
      `UPDATE inventory_import_batches SET status = 'committed', committed_at = now()
       WHERE id = $1 RETURNING committed_at`,
      [batchId]
    );
    const resultRows: CommitRow[] = previewRows.rows.map(row => ({
      skuCode: row.sku_code,
      warehouseCode: row.warehouse_code,
      onHand: row.on_hand_new,
      unsellable: row.unsellable_new,
      version: locked.get(`${row.sku_id}:${row.warehouse_id}`)!.version + 1,
    }));
    await storeCommitResult(
      client,
      batchId,
      committed.rows[0].committed_at,
      resultRows
    );
    await writeAudit(client, {
      ...actor(auth),
      action: 'IMPORT_INVENTORY',
      targetType: 'inventory_import_batch',
      targetId: batchId,
      details: { rows: previewRows.rows.length, sourceName: batch.rows[0].source_name },
    });

    return {
      batchId,
      status: 'committed',
      alreadyCommitted: false,
      committedAt: new Date(committed.rows[0].committed_at).toISOString(),
      rows: resultRows,
    };
  });
}
