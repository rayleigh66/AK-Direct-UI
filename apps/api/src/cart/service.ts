import type { PoolClient } from 'pg';
import type { DbPool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { writeAudit } from '../audit/audit.js';
import { HttpError } from '../http/errors.js';
import type { AuthContext } from '../auth/types.js';
import {
  PRICING_MODE,
  REFERENCE_PRICE_NOTE,
  validateOrderQuantity,
} from '../orders/validation.js';

export interface CartItemDto {
  skuId: string;
  productId: string;
  productCode: string;
  productTitle: string;
  productTitleEn: string;
  brandId: string;
  skuCode: string;
  colorName: string;
  colorNameEn: string;
  colorHex: string;
  imageUrl: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  available: number;
  isAvailable: boolean;
  issues: string[];
  updatedAt: string;
}

export interface CartDto {
  revision: number;
  updatedAt: string | null;
  items: CartItemDto[];
  itemCount: number;
  totalQuantity: number;
  referenceTotalCents: number;
  hasUnavailableItems: boolean;
  pricingMode: 'base_reference';
  isReferenceQuote: true;
  priceNote: string;
}

interface CartItemRow {
  sku_id: string;
  quantity: number;
  updated_at: Date;
  sku_code: string;
  color_name: string;
  color_name_en: string;
  color_hex: string;
  base_price_cents: number;
  sellable_status: 'active' | 'discontinued';
  product_id: string;
  product_code: string;
  title: string;
  title_en: string;
  published: boolean;
  brand_id: string;
  brand_granted: boolean;
  available: string;
  display_image_id: string | null;
}

export function requireCustomerCompany(auth: AuthContext): string {
  if (auth.user.type !== 'customer' || !auth.user.companyId) {
    throw new HttpError(403, 'forbidden', 'A customer company session is required.');
  }
  return auth.user.companyId;
}

async function assertCompanyAndUserActive(client: PoolClient, auth: AuthContext): Promise<void> {
  const companyId = requireCustomerCompany(auth);
  const result = await client.query<{
    company_status: string;
    user_status: string;
  }>(
    `SELECT c.status AS company_status, u.status AS user_status
     FROM customer_companies c
     JOIN customer_users u ON u.id = $2 AND u.company_id = c.id
     WHERE c.id = $1`,
    [companyId, auth.user.id]
  );
  const row = result.rows[0];
  if (!row || row.company_status !== 'active' || row.user_status !== 'active') {
    throw new HttpError(
      403,
      'account_inactive',
      'The customer company or account is no longer active.'
    );
  }
}

const CART_ITEMS_SELECT = `
  SELECT ci.sku_id, ci.quantity, ci.updated_at,
         s.sku_code, s.color_name, s.color_name_en, s.color_hex, s.base_price_cents,
         s.sellable_status, s.product_id,
         p.product_code, p.title, p.title_en, p.published, p.brand_id,
         EXISTS (
           SELECT 1 FROM brand_grants g
           WHERE g.company_id = ci.company_id AND g.brand_id = p.brand_id
         ) AS brand_granted,
         GREATEST(COALESCE(
           (SELECT SUM(b.on_hand - b.reserved - b.unsellable)
            FROM inventory_balances b WHERE b.sku_id = s.id), 0
         ), 0)::text AS available,
         COALESCE(
           s.image_id,
           (SELECT i.id FROM product_images i
            WHERE i.product_id = p.id AND i.is_primary AND i.removed_at IS NULL
            LIMIT 1)
         ) AS display_image_id
  FROM cart_items ci
  JOIN product_skus s ON s.id = ci.sku_id
  JOIN products p ON p.id = s.product_id
  WHERE ci.company_id = $1
  ORDER BY ci.updated_at, s.sku_code
`;

function itemIssues(row: CartItemRow): string[] {
  const issues: string[] = [];
  if (!row.published) issues.push('This product is no longer published.');
  if (row.sellable_status !== 'active') issues.push('This SKU is discontinued.');
  if (!row.brand_granted) issues.push('Your company is no longer authorized for this brand.');
  const available = Number(row.available);
  if (available < row.quantity) {
    issues.push(`Only ${available} PCS are currently available for this line.`);
  }
  return issues;
}

async function loadCart(db: Pick<DbPool, 'query'> | PoolClient, companyId: string): Promise<CartDto> {
  const cartRow = await db.query<{ revision: string; updated_at: Date }>(
    'SELECT revision, updated_at FROM company_carts WHERE company_id = $1',
    [companyId]
  );
  const items = await db.query<CartItemRow>(CART_ITEMS_SELECT, [companyId]);
  const dtos: CartItemDto[] = items.rows.map(row => {
    const issues = itemIssues(row);
    const lineTotalCents = row.base_price_cents * row.quantity;
    return {
      skuId: row.sku_id,
      productId: row.product_id,
      productCode: row.product_code,
      productTitle: row.title,
      productTitleEn: row.title_en,
      brandId: row.brand_id,
      skuCode: row.sku_code,
      colorName: row.color_name,
      colorNameEn: row.color_name_en,
      colorHex: row.color_hex,
      imageUrl: row.display_image_id ? `/api/media/${row.display_image_id}` : null,
      quantity: row.quantity,
      unitPriceCents: row.base_price_cents,
      lineTotalCents,
      available: Number(row.available),
      isAvailable: issues.length === 0,
      issues,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  });
  const availableItems = dtos.filter(item => item.isAvailable);
  return {
    revision: cartRow.rows[0] ? Number(cartRow.rows[0].revision) : 1,
    updatedAt: cartRow.rows[0] ? new Date(cartRow.rows[0].updated_at).toISOString() : null,
    items: dtos,
    itemCount: dtos.length,
    totalQuantity: dtos.reduce((sum, item) => sum + item.quantity, 0),
    referenceTotalCents: availableItems.reduce((sum, item) => sum + item.lineTotalCents, 0),
    hasUnavailableItems: dtos.some(item => !item.isAvailable),
    pricingMode: PRICING_MODE,
    isReferenceQuote: true,
    priceNote: REFERENCE_PRICE_NOTE,
  };
}

export async function getCart(pool: DbPool, auth: AuthContext): Promise<CartDto> {
  const companyId = requireCustomerCompany(auth);
  return loadCart(pool, companyId);
}

/** Cart snapshot for a version-conflict response from another service. */
export async function getCartForCompany(
  db: Pick<DbPool, 'query'> | PoolClient,
  companyId: string
): Promise<CartDto> {
  return loadCart(db, companyId);
}

function expectedRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new HttpError(
      400,
      'invalid_request',
      'expectedRevision is required and must be a positive whole number.'
    );
  }
  return value;
}

async function lockCart(client: PoolClient, companyId: string): Promise<number> {
  await client.query(
    'INSERT INTO company_carts (company_id) VALUES ($1) ON CONFLICT (company_id) DO NOTHING',
    [companyId]
  );
  const row = await client.query<{ revision: string }>(
    'SELECT revision FROM company_carts WHERE company_id = $1 FOR UPDATE',
    [companyId]
  );
  return Number(row.rows[0].revision);
}

async function requireRevision(
  client: PoolClient,
  companyId: string,
  expected: number,
  actual: number
): Promise<void> {
  if (expected !== actual) {
    const cart = await loadCart(client, companyId);
    throw new HttpError(
      409,
      'cart_version_conflict',
      'The company cart changed in another session. The latest cart has been returned.',
      undefined,
      { cart }
    );
  }
}

async function bumpCart(client: PoolClient, companyId: string): Promise<void> {
  await client.query(
    'UPDATE company_carts SET revision = revision + 1, updated_at = now() WHERE company_id = $1',
    [companyId]
  );
}

interface SkuForCartRow {
  id: string;
  sku_code: string;
  base_price_cents: number;
  sellable_status: 'active' | 'discontinued';
  published: boolean;
  brand_granted: boolean;
  available: string;
}

async function requireSellableSku(
  client: PoolClient,
  companyId: string,
  skuId: string,
  quantity: number
): Promise<SkuForCartRow> {
  const result = await client.query<SkuForCartRow>(
    `SELECT s.id, s.sku_code, s.base_price_cents, s.sellable_status, p.published,
            EXISTS (
              SELECT 1 FROM brand_grants g
              WHERE g.company_id = $2 AND g.brand_id = p.brand_id
            ) AS brand_granted,
            GREATEST(COALESCE(
              (SELECT SUM(b.on_hand - b.reserved - b.unsellable)
               FROM inventory_balances b WHERE b.sku_id = s.id), 0
            ), 0)::text AS available
     FROM product_skus s
     JOIN products p ON p.id = s.product_id
     WHERE s.id = $1`,
    [skuId, companyId]
  );
  const sku = result.rows[0];
  if (!sku) throw new HttpError(404, 'sku_not_found', 'SKU not found.');
  if (!sku.published) {
    throw new HttpError(409, 'product_unavailable', 'This product is no longer published.');
  }
  if (sku.sellable_status !== 'active') {
    throw new HttpError(409, 'sku_unavailable', 'This SKU is discontinued.');
  }
  if (!sku.brand_granted) {
    throw new HttpError(
      409,
      'brand_not_authorized',
      'Your company is no longer authorized for this brand.'
    );
  }
  const available = Number(sku.available);
  if (quantity > available) {
    throw new HttpError(
      409,
      'insufficient_stock',
      `Only ${available} PCS are currently available for ${sku.sku_code}.`,
      undefined,
      { skuCode: sku.sku_code, available }
    );
  }
  return sku;
}

function actor(auth: AuthContext) {
  return {
    actorType: auth.user.type,
    actorId: auth.user.id,
    actorLabel: auth.user.username,
  };
}

export interface SetCartItemInput {
  expectedRevision: number;
  quantity: number;
}

export async function setCartItem(
  pool: DbPool,
  auth: AuthContext,
  skuId: string,
  input: SetCartItemInput
): Promise<CartDto> {
  const companyId = requireCustomerCompany(auth);
  const expected = expectedRevision(input.expectedRevision);
  const quantity = validateOrderQuantity(input.quantity);
  return withTransaction(pool, async client => {
    await assertCompanyAndUserActive(client, auth);
    const actual = await lockCart(client, companyId);
    await requireRevision(client, companyId, expected, actual);
    const sku = await requireSellableSku(client, companyId, skuId, quantity);
    await client.query(
      `INSERT INTO cart_items (company_id, sku_id, quantity, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (company_id, sku_id)
       DO UPDATE SET quantity = EXCLUDED.quantity, updated_by = EXCLUDED.updated_by,
                     updated_at = now()`,
      [companyId, skuId, quantity, auth.user.id]
    );
    await bumpCart(client, companyId);
    await writeAudit(client, {
      ...actor(auth),
      action: 'SET_CART_ITEM',
      targetType: 'company_cart',
      targetId: companyId,
      details: { skuId, skuCode: sku.sku_code, quantity },
    });
    return loadCart(client, companyId);
  });
}

export async function removeCartItem(
  pool: DbPool,
  auth: AuthContext,
  skuId: string,
  expectedRevisionValue: number
): Promise<CartDto> {
  const companyId = requireCustomerCompany(auth);
  const expected = expectedRevision(expectedRevisionValue);
  return withTransaction(pool, async client => {
    await assertCompanyAndUserActive(client, auth);
    const actual = await lockCart(client, companyId);
    await requireRevision(client, companyId, expected, actual);
    const deleted = await client.query(
      'DELETE FROM cart_items WHERE company_id = $1 AND sku_id = $2',
      [companyId, skuId]
    );
    if (deleted.rowCount === 0) {
      throw new HttpError(404, 'cart_item_not_found', 'That SKU is not in the company cart.');
    }
    await bumpCart(client, companyId);
    await writeAudit(client, {
      ...actor(auth),
      action: 'REMOVE_CART_ITEM',
      targetType: 'company_cart',
      targetId: companyId,
      details: { skuId },
    });
    return loadCart(client, companyId);
  });
}

export async function clearCart(
  pool: DbPool,
  auth: AuthContext,
  expectedRevisionValue: number
): Promise<CartDto> {
  const companyId = requireCustomerCompany(auth);
  const expected = expectedRevision(expectedRevisionValue);
  return withTransaction(pool, async client => {
    await assertCompanyAndUserActive(client, auth);
    const actual = await lockCart(client, companyId);
    await requireRevision(client, companyId, expected, actual);
    const deleted = await client.query('DELETE FROM cart_items WHERE company_id = $1', [companyId]);
    if ((deleted.rowCount ?? 0) > 0) {
      await bumpCart(client, companyId);
      await writeAudit(client, {
        ...actor(auth),
        action: 'CLEAR_CART',
        targetType: 'company_cart',
        targetId: companyId,
        details: { removed: deleted.rowCount },
      });
    }
    return loadCart(client, companyId);
  });
}
