import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { DbPool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { writeAudit } from '../audit/audit.js';
import { HttpError } from '../http/errors.js';
import type { AuthContext } from '../auth/types.js';
import { storeImage, removeStoredImage } from '../media/storage.js';

export type Queryable = Pick<DbPool, 'query'>;

export interface ProductRow {
  id: string;
  brand_id: string;
  brand_code: string;
  brand_name: string;
  product_code: string;
  title: string;
  title_en: string;
  description: string;
  description_en: string;
  category: string;
  material: string;
  capacity_or_size: string;
  series_id: string | null;
  published: boolean;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SkuRow {
  id: string;
  product_id: string;
  sku_code: string;
  color_name: string;
  color_name_en: string;
  color_hex: string;
  base_price_cents: number;
  sellable_status: 'active' | 'discontinued';
  image_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ImageRow {
  id: string;
  product_id: string;
  storage_key: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  sort_order: number;
  is_primary: boolean;
  removed_at: Date | null;
  created_at: Date;
}

export interface SkuDto {
  id: string;
  productId: string;
  skuCode: string;
  colorName: string;
  colorNameEn: string;
  colorHex: string;
  basePriceCents: number;
  sellableStatus: 'active' | 'discontinued';
  imageId: string | null;
  imageUrl: string | null;
}

export interface ImageDto {
  id: string;
  productId: string;
  url: string;
  mimeType: string;
  byteSize: number;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: string;
}

export interface ProductDto {
  id: string;
  brandId: string;
  brandCode: string;
  brandName: string;
  productCode: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  category: string;
  material: string;
  capacityOrSize: string;
  seriesId: string | null;
  tagIds: string[];
  published: boolean;
  publishedAt: string | null;
  skus: SkuDto[];
  images: ImageDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomerSkuDto extends SkuDto {
  available: number;
}

export interface CustomerProductDto extends Omit<ProductDto, 'skus'> {
  skus: CustomerSkuDto[];
}

const TONES = ['orange', 'blue', 'sky', 'green', 'grey', 'purple'];
const TAG_CODE = /^[A-Z][A-Z0-9_]{1,39}$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const MAX_PRICE_CENTS = 100_000_000;
const MAX_TEXT = 4000;

function actor(auth: AuthContext) {
  return {
    actorType: auth.user.type,
    actorId: auth.user.id,
    actorLabel: auth.user.username,
  };
}

function requiredText(value: unknown, field: string, max = MAX_TEXT): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'invalid_request', `${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, 'invalid_request', `${field} is too long.`);
  return trimmed;
}

function optionalText(value: unknown, field: string, max = MAX_TEXT): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_request', `${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, 'invalid_request', `${field} is too long.`);
  return trimmed;
}

function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, 'invalid_request', `${field} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function optionalInteger(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  return integer(value, field, min, max);
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new HttpError(400, 'invalid_request', `${field} must be a boolean.`);
  }
  return value;
}

async function queryRows<T>(
  db: Queryable,
  text: string,
  values: unknown[] = []
): Promise<T[]> {
  const result = await db.query(text, values);
  return result.rows as T[];
}

async function loadSkus(db: Queryable, productId: string): Promise<SkuRow[]> {
  return queryRows<SkuRow>(
    db,
    `SELECT * FROM product_skus WHERE product_id = $1 ORDER BY created_at, id`,
    [productId]
  );
}

async function loadImages(db: Queryable, productId: string, includeRemoved = false): Promise<ImageRow[]> {
  return queryRows<ImageRow>(
    db,
    `SELECT * FROM product_images
     WHERE product_id = $1 ${includeRemoved ? '' : 'AND removed_at IS NULL'}
     ORDER BY sort_order, created_at, id`,
    [productId]
  );
}

async function loadTagIds(db: Queryable, productId: string): Promise<string[]> {
  const rows = await queryRows<{ tag_id: string }>(
    db,
    'SELECT tag_id FROM product_feature_tags WHERE product_id = $1 ORDER BY tag_id',
    [productId]
  );
  return rows.map(row => row.tag_id);
}

function imageDto(row: ImageRow): ImageDto {
  return {
    id: row.id,
    productId: row.product_id,
    url: `/api/media/${row.id}`,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sortOrder: row.sort_order,
    isPrimary: row.is_primary,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function skuDto(row: SkuRow): SkuDto {
  return {
    id: row.id,
    productId: row.product_id,
    skuCode: row.sku_code,
    colorName: row.color_name,
    colorNameEn: row.color_name_en,
    colorHex: row.color_hex,
    basePriceCents: row.base_price_cents,
    sellableStatus: row.sellable_status,
    imageId: row.image_id,
    imageUrl: row.image_id ? `/api/media/${row.image_id}` : null,
  };
}

function productDto(row: ProductRow, skus: SkuRow[], images: ImageRow[], tagIds: string[]): ProductDto {
  return {
    id: row.id,
    brandId: row.brand_id,
    brandCode: row.brand_code,
    brandName: row.brand_name,
    productCode: row.product_code,
    title: row.title,
    titleEn: row.title_en,
    description: row.description,
    descriptionEn: row.description_en,
    category: row.category,
    material: row.material,
    capacityOrSize: row.capacity_or_size,
    seriesId: row.series_id,
    tagIds,
    published: row.published,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    skus: skus.map(skuDto),
    images: images.map(imageDto),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const PRODUCT_SELECT = `
  SELECT p.*, b.code AS brand_code, COALESCE(b.name_en, b.name) AS brand_name
  FROM products p
  JOIN brands b ON b.id = p.brand_id
`;

async function getProductRow(db: Queryable, id: string): Promise<ProductRow> {
  const rows = await queryRows<ProductRow>(db, `${PRODUCT_SELECT} WHERE p.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'product_not_found', 'Product not found.');
  return rows[0];
}

async function buildProductDto(db: Queryable, row: ProductRow): Promise<ProductDto> {
  // Sequential on purpose: `db` may be a single transaction client, and pg
  // does not support concurrent queries on one client.
  const skus = await loadSkus(db, row.id);
  const images = await loadImages(db, row.id);
  const tags = await loadTagIds(db, row.id);
  return productDto(row, skus, images, tags);
}

export async function listAdminProducts(pool: DbPool): Promise<ProductDto[]> {
  const rows = await queryRows<ProductRow>(pool, `${PRODUCT_SELECT} ORDER BY p.created_at DESC, p.id`);
  return Promise.all(rows.map(row => buildProductDto(pool, row)));
}

export async function getAdminProduct(pool: DbPool, id: string): Promise<ProductDto> {
  return buildProductDto(pool, await getProductRow(pool, id));
}

async function validateBrand(db: Queryable, brandId: string): Promise<void> {
  const rows = await queryRows(db, 'SELECT 1 FROM brands WHERE id = $1 AND active = true', [brandId]);
  if (!rows[0]) throw new HttpError(400, 'invalid_brand', 'Brand is invalid or inactive.');
}

async function validateSeries(db: Queryable, seriesId: string | null): Promise<void> {
  if (!seriesId) return;
  const rows = await queryRows(db, 'SELECT 1 FROM series_definitions WHERE id = $1', [seriesId]);
  if (!rows[0]) throw new HttpError(400, 'invalid_series', 'Series does not exist.');
}

async function validateTags(db: Queryable, tagIds: string[]): Promise<string[]> {
  const unique = [...new Set(tagIds)];
  if (!unique.length) return [];
  const rows = await queryRows<{ id: string }>(
    db,
    'SELECT id FROM feature_tags WHERE id = ANY($1::text[])',
    [unique]
  );
  if (rows.length !== unique.length) {
    throw new HttpError(400, 'invalid_tag', 'One or more feature tags do not exist.');
  }
  return unique;
}

async function replaceTags(
  client: PoolClient,
  productId: string,
  tagIds: string[]
): Promise<void> {
  await client.query('DELETE FROM product_feature_tags WHERE product_id = $1', [productId]);
  for (const tagId of tagIds) {
    await client.query(
      'INSERT INTO product_feature_tags (product_id, tag_id) VALUES ($1, $2)',
      [productId, tagId]
    );
  }
}

export interface CreateProductInput {
  brandId: string;
  productCode: string;
  title: string;
  titleEn: string;
  description?: string;
  descriptionEn?: string;
  category: string;
  material?: string;
  capacityOrSize?: string;
  seriesId?: string | null;
  tagIds?: string[];
}

export async function createProduct(
  pool: DbPool,
  auth: AuthContext,
  input: CreateProductInput
): Promise<ProductDto> {
  const productCode = requiredText(input.productCode, 'productCode', 64).toUpperCase();
  const title = requiredText(input.title, 'title', 300);
  const titleEn = requiredText(input.titleEn, 'titleEn', 300);
  const category = requiredText(input.category, 'category', 120);
  const seriesId = input.seriesId ?? null;
  const tagIds = input.tagIds ?? [];

  return withTransaction(pool, async client => {
    await validateBrand(client, input.brandId);
    await validateSeries(client, seriesId);
    const validTags = await validateTags(client, tagIds);
    const duplicate = await client.query('SELECT 1 FROM products WHERE product_code = $1', [
      productCode,
    ]);
    if (duplicate.rowCount) {
      throw new HttpError(409, 'duplicate_product_code', `Product code ${productCode} already exists.`);
    }
    const id = randomUUID();
    const result = await client.query<ProductRow>(
      `INSERT INTO products
        (id, brand_id, product_code, title, title_en, description, description_en,
         category, material, capacity_or_size, series_id, published, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12)
       RETURNING id`,
      [
        id,
        input.brandId,
        productCode,
        title,
        titleEn,
        optionalText(input.description, 'description') ?? '',
        optionalText(input.descriptionEn, 'descriptionEn') ?? '',
        category,
        optionalText(input.material, 'material') ?? '',
        optionalText(input.capacityOrSize, 'capacityOrSize') ?? '',
        seriesId,
        auth.user.id,
      ]
    );
    await replaceTags(client, id, validTags);
    await writeAudit(client, {
      ...actor(auth),
      action: 'CREATE_PRODUCT',
      targetType: 'product',
      targetId: id,
      details: { productCode, brandId: input.brandId },
    });
    const rows = await queryRows<ProductRow>(client, `${PRODUCT_SELECT} WHERE p.id = $1`, [result.rows[0].id]);
    return buildProductDto(client, rows[0]);
  });
}

export interface UpdateProductInput {
  brandId?: string;
  productCode?: string;
  title?: string;
  titleEn?: string;
  description?: string;
  descriptionEn?: string;
  category?: string;
  material?: string;
  capacityOrSize?: string;
  seriesId?: string | null;
  tagIds?: string[];
}

export async function updateProduct(
  pool: DbPool,
  auth: AuthContext,
  productId: string,
  input: UpdateProductInput
): Promise<ProductDto> {
  return withTransaction(pool, async client => {
    const existing = await client.query<ProductRow>('SELECT * FROM products WHERE id = $1 FOR UPDATE', [
      productId,
    ]);
    if (!existing.rows[0]) throw new HttpError(404, 'product_not_found', 'Product not found.');
    const current = existing.rows[0];

    const productCode =
      input.productCode === undefined
        ? current.product_code
        : requiredText(input.productCode, 'productCode', 64).toUpperCase();
    if (productCode !== current.product_code) {
      const duplicate = await client.query(
        'SELECT 1 FROM products WHERE product_code = $1 AND id <> $2',
        [productCode, productId]
      );
      if (duplicate.rowCount) {
        throw new HttpError(409, 'duplicate_product_code', `Product code ${productCode} already exists.`);
      }
    }
    if (input.brandId !== undefined) await validateBrand(client, input.brandId);
    if (input.seriesId !== undefined) await validateSeries(client, input.seriesId ?? null);
    const tagIds = input.tagIds === undefined ? undefined : await validateTags(client, input.tagIds);

    await client.query(
      `UPDATE products SET
        brand_id = COALESCE($2, brand_id),
        product_code = $3,
        title = COALESCE($4, title),
        title_en = COALESCE($5, title_en),
        description = COALESCE($6, description),
        description_en = COALESCE($7, description_en),
        category = COALESCE($8, category),
        material = COALESCE($9, material),
        capacity_or_size = COALESCE($10, capacity_or_size),
        series_id = $11,
        updated_at = now()
       WHERE id = $1`,
      [
        productId,
        input.brandId ?? null,
        productCode,
        input.title === undefined ? null : requiredText(input.title, 'title', 300),
        input.titleEn === undefined ? null : requiredText(input.titleEn, 'titleEn', 300),
        input.description === undefined ? null : optionalText(input.description, 'description') ?? '',
        input.descriptionEn === undefined
          ? null
          : optionalText(input.descriptionEn, 'descriptionEn') ?? '',
        input.category === undefined ? null : requiredText(input.category, 'category', 120),
        input.material === undefined ? null : optionalText(input.material, 'material') ?? '',
        input.capacityOrSize === undefined
          ? null
          : optionalText(input.capacityOrSize, 'capacityOrSize') ?? '',
        input.seriesId === undefined ? current.series_id : input.seriesId,
      ]
    );
    if (tagIds !== undefined) await replaceTags(client, productId, tagIds);

    await writeAudit(client, {
      ...actor(auth),
      action: 'UPDATE_PRODUCT',
      targetType: 'product',
      targetId: productId,
      details: { fields: Object.keys(input).filter(key => input[key as keyof UpdateProductInput] !== undefined) },
    });
    const rows = await queryRows<ProductRow>(client, `${PRODUCT_SELECT} WHERE p.id = $1`, [productId]);
    return buildProductDto(client, rows[0]);
  });
}

export async function setProductPublished(
  pool: DbPool,
  auth: AuthContext,
  productId: string,
  published: boolean
): Promise<ProductDto> {
  return withTransaction(pool, async client => {
    const rows = await client.query<ProductRow>('SELECT * FROM products WHERE id = $1 FOR UPDATE', [
      productId,
    ]);
    if (!rows.rows[0]) throw new HttpError(404, 'product_not_found', 'Product not found.');

    if (published) {
      const counts = await client.query<{ active_skus: string; images: string }>(
        `SELECT
           (SELECT count(*)::text FROM product_skus WHERE product_id = $1 AND sellable_status = 'active') AS active_skus,
           (SELECT count(*)::text FROM product_images WHERE product_id = $1 AND removed_at IS NULL) AS images`,
        [productId]
      );
      if (Number(counts.rows[0].active_skus) < 1) {
        throw new HttpError(409, 'publish_requires_sku', 'A product needs at least one active SKU to be published.');
      }
      if (Number(counts.rows[0].images) < 1) {
        throw new HttpError(409, 'publish_requires_image', 'A product needs at least one image to be published.');
      }
    }

    await client.query(
      `UPDATE products SET published = $2,
         published_at = CASE WHEN $2 THEN now() ELSE published_at END,
         updated_at = now()
       WHERE id = $1`,
      [productId, published]
    );
    await writeAudit(client, {
      ...actor(auth),
      action: published ? 'PUBLISH_PRODUCT' : 'UNPUBLISH_PRODUCT',
      targetType: 'product',
      targetId: productId,
      details: { published },
    });
    const updated = await queryRows<ProductRow>(client, `${PRODUCT_SELECT} WHERE p.id = $1`, [productId]);
    return buildProductDto(client, updated[0]);
  });
}

export interface CreateSkuInput {
  skuCode: string;
  colorName: string;
  colorNameEn: string;
  colorHex: string;
  basePriceCents: number;
  sellableStatus?: 'active' | 'discontinued';
  imageId?: string | null;
  initialInventory?: { warehouseId: string; onHand: number; unsellable?: number };
}

async function validateSkuImage(
  client: Queryable,
  productId: string,
  imageId: string | null | undefined
): Promise<void> {
  if (!imageId) return;
  const rows = await queryRows(
    client,
    'SELECT 1 FROM product_images WHERE id = $1 AND product_id = $2 AND removed_at IS NULL',
    [imageId, productId]
  );
  if (!rows[0]) throw new HttpError(400, 'invalid_sku_image', 'SKU image must be an active image of the same product.');
}

export async function createSku(
  pool: DbPool,
  auth: AuthContext,
  productId: string,
  input: CreateSkuInput
): Promise<SkuDto> {
  const skuCode = requiredText(input.skuCode, 'skuCode', 64).toUpperCase();
  const colorName = requiredText(input.colorName, 'colorName', 120);
  const colorNameEn = requiredText(input.colorNameEn, 'colorNameEn', 120);
  if (!HEX.test(input.colorHex)) {
    throw new HttpError(400, 'invalid_color', 'colorHex must look like #RRGGBB.');
  }
  const price = integer(input.basePriceCents, 'basePriceCents', 1, MAX_PRICE_CENTS);

  return withTransaction(pool, async client => {
    const product = await client.query('SELECT 1 FROM products WHERE id = $1 FOR UPDATE', [productId]);
    if (!product.rowCount) throw new HttpError(404, 'product_not_found', 'Product not found.');
    const duplicate = await client.query('SELECT 1 FROM product_skus WHERE sku_code = $1', [skuCode]);
    if (duplicate.rowCount) throw new HttpError(409, 'duplicate_sku_code', `SKU code ${skuCode} already exists.`);
    await validateSkuImage(client, productId, input.imageId);

    const id = randomUUID();
    await client.query(
      `INSERT INTO product_skus
        (id, product_id, sku_code, color_name, color_name_en, color_hex,
         base_price_cents, sellable_status, image_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        productId,
        skuCode,
        colorName,
        colorNameEn,
        input.colorHex,
        price,
        input.sellableStatus ?? 'active',
        input.imageId ?? null,
      ]
    );

    if (input.initialInventory) {
      const { warehouseId, onHand } = input.initialInventory;
      const unsellable = input.initialInventory.unsellable ?? 0;
      integer(onHand, 'initialInventory.onHand', 0, 100_000_000);
      integer(unsellable, 'initialInventory.unsellable', 0, 100_000_000);
      if (unsellable > onHand) {
        throw new HttpError(400, 'invalid_inventory', 'unsellable cannot exceed onHand.');
      }
      const warehouse = await client.query('SELECT 1 FROM warehouses WHERE id = $1 AND active = true', [
        warehouseId,
      ]);
      if (!warehouse.rowCount) {
        throw new HttpError(400, 'invalid_warehouse', 'Initial stock requires an active warehouse.');
      }
      await client.query(
        `INSERT INTO inventory_balances (sku_id, warehouse_id, on_hand, unsellable, updated_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, warehouseId, onHand, unsellable, auth.user.id]
      );
      await client.query(
        `INSERT INTO inventory_movements
          (id, sku_id, warehouse_id, movement_type, delta_on_hand, delta_unsellable,
           on_hand_before, on_hand_after, unsellable_before, unsellable_after,
           reserved_after, reason, actor_type, actor_id, actor_label)
         VALUES ($1, $2, $3, 'initial', $4, $5, 0, $4, 0, $5, 0, $6, 'internal', $7, $8)`,
        [randomUUID(), id, warehouseId, onHand, unsellable, 'Initial stock on SKU creation', auth.user.id, auth.user.username]
      );
    }

    await writeAudit(client, {
      ...actor(auth),
      action: 'CREATE_SKU',
      targetType: 'product_sku',
      targetId: id,
      details: { productId, skuCode },
    });
    const rows = await queryRows<SkuRow>(client, 'SELECT * FROM product_skus WHERE id = $1', [id]);
    return skuDto(rows[0]);
  });
}

export interface UpdateSkuInput {
  skuCode?: string;
  colorName?: string;
  colorNameEn?: string;
  colorHex?: string;
  basePriceCents?: number;
  sellableStatus?: 'active' | 'discontinued';
  imageId?: string | null;
}

export async function updateSku(
  pool: DbPool,
  auth: AuthContext,
  skuId: string,
  input: UpdateSkuInput
): Promise<SkuDto> {
  return withTransaction(pool, async client => {
    // Lock order is parent -> child everywhere (publish, SKU creation, image
    // operations). Locking the product first serialises concurrent SKU status
    // changes so two "last SKU" decisions cannot both succeed.
    const pointer = await client.query<{ product_id: string }>(
      'SELECT product_id FROM product_skus WHERE id = $1',
      [skuId]
    );
    if (!pointer.rows[0]) throw new HttpError(404, 'sku_not_found', 'SKU not found.');
    const productId = pointer.rows[0].product_id;
    const productLock = await client.query<{ published: boolean }>(
      'SELECT published FROM products WHERE id = $1 FOR UPDATE',
      [productId]
    );
    if (!productLock.rows[0]) throw new HttpError(404, 'sku_not_found', 'SKU not found.');

    const rows = await client.query<SkuRow>('SELECT * FROM product_skus WHERE id = $1 FOR UPDATE', [skuId]);
    if (!rows.rows[0]) throw new HttpError(404, 'sku_not_found', 'SKU not found.');
    const current = rows.rows[0];

    const skuCode =
      input.skuCode === undefined ? current.sku_code : requiredText(input.skuCode, 'skuCode', 64).toUpperCase();
    if (skuCode !== current.sku_code) {
      const duplicate = await client.query(
        'SELECT 1 FROM product_skus WHERE sku_code = $1 AND id <> $2',
        [skuCode, skuId]
      );
      if (duplicate.rowCount) {
        throw new HttpError(409, 'duplicate_sku_code', `SKU code ${skuCode} already exists.`);
      }
    }
    if (input.colorHex !== undefined && !HEX.test(input.colorHex)) {
      throw new HttpError(400, 'invalid_color', 'colorHex must look like #RRGGBB.');
    }
    if (input.basePriceCents !== undefined) {
      integer(input.basePriceCents, 'basePriceCents', 1, MAX_PRICE_CENTS);
    }
    if (input.imageId !== undefined) {
      await validateSkuImage(client, current.product_id, input.imageId);
    }
    const nextStatus = input.sellableStatus ?? current.sellable_status;
    if (current.sellable_status === 'active' && nextStatus === 'discontinued') {
      if (productLock.rows[0].published) {
        const others = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM product_skus
           WHERE product_id = $1 AND sellable_status = 'active' AND id <> $2`,
          [current.product_id, skuId]
        );
        if (Number(others.rows[0].count) === 0) {
          throw new HttpError(
            409,
            'last_active_sku',
            'A published product cannot discontinue its last active SKU. Unpublish the product first.'
          );
        }
      }
    }

    await client.query(
      `UPDATE product_skus SET
        sku_code = $2,
        color_name = COALESCE($3, color_name),
        color_name_en = COALESCE($4, color_name_en),
        color_hex = COALESCE($5, color_hex),
        base_price_cents = COALESCE($6, base_price_cents),
        sellable_status = $7,
        image_id = $8,
        updated_at = now()
       WHERE id = $1`,
      [
        skuId,
        skuCode,
        input.colorName === undefined ? null : requiredText(input.colorName, 'colorName', 120),
        input.colorNameEn === undefined ? null : requiredText(input.colorNameEn, 'colorNameEn', 120),
        input.colorHex ?? null,
        input.basePriceCents ?? null,
        nextStatus,
        input.imageId === undefined ? current.image_id : input.imageId,
      ]
    );
    await writeAudit(client, {
      ...actor(auth),
      action: 'UPDATE_SKU',
      targetType: 'product_sku',
      targetId: skuId,
      details: { skuCode, productId: current.product_id },
    });
    const updated = await queryRows<SkuRow>(client, 'SELECT * FROM product_skus WHERE id = $1', [skuId]);
    return skuDto(updated[0]);
  });
}

export async function uploadProductImage(
  pool: DbPool,
  auth: AuthContext,
  productId: string,
  buffer: Buffer,
  declaredMime: string | undefined,
  mediaRoot: string
): Promise<ImageDto> {
  // Reject unknown products before writing a file to the media volume.
  await getProductRow(pool, productId);
  const stored = await storeImage(buffer, declaredMime, mediaRoot);
  try {
    return await withTransaction(pool, async client => {
      const locked = await client.query('SELECT 1 FROM products WHERE id = $1 FOR UPDATE', [productId]);
      if (!locked.rowCount) throw new HttpError(404, 'product_not_found', 'Product not found.');
      const aggregates = await client.query<{ next_sort: number; active_images: string }>(
        `SELECT COALESCE(max(sort_order) + 1, 0) AS next_sort, count(*)::text AS active_images
         FROM product_images WHERE product_id = $1 AND removed_at IS NULL`,
        [productId]
      );
      const primary = Number(aggregates.rows[0].active_images) === 0;
      const id = randomUUID();
      await client.query(
        `INSERT INTO product_images
          (id, product_id, storage_key, mime_type, byte_size, sha256, sort_order,
           is_primary, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, productId, stored.storageKey, stored.mimeType, stored.byteSize, stored.sha256,
          aggregates.rows[0].next_sort, primary, auth.user.id]
      );
      await writeAudit(client, {
        ...actor(auth),
        action: 'UPLOAD_PRODUCT_IMAGE',
        targetType: 'product_image',
        targetId: id,
        details: { productId, mimeType: stored.mimeType, byteSize: stored.byteSize },
      });
      const rows = await queryRows<ImageRow>(client, 'SELECT * FROM product_images WHERE id = $1', [id]);
      return imageDto(rows[0]);
    });
  } catch (error) {
    await removeStoredImage(mediaRoot, stored.storageKey);
    throw error;
  }
}

export async function reorderProductImages(
  pool: DbPool,
  auth: AuthContext,
  productId: string,
  imageIds: string[]
): Promise<ImageDto[]> {
  return withTransaction(pool, async client => {
    const product = await client.query('SELECT 1 FROM products WHERE id = $1 FOR UPDATE', [productId]);
    if (!product.rowCount) throw new HttpError(404, 'product_not_found', 'Product not found.');
    const active = await client.query<{ id: string }>(
      'SELECT id FROM product_images WHERE product_id = $1 AND removed_at IS NULL',
      [productId]
    );
    const activeIds = active.rows.map(row => row.id).sort();
    const requested = [...new Set(imageIds)].sort();
    if (activeIds.length !== requested.length || activeIds.some((id, index) => id !== requested[index])) {
      throw new HttpError(409, 'image_order_mismatch', 'Image order must include every active image exactly once.');
    }
    for (const [index, imageId] of imageIds.entries()) {
      await client.query(
        'UPDATE product_images SET sort_order = $3 WHERE id = $1 AND product_id = $2',
        [imageId, productId, index]
      );
    }
    await writeAudit(client, {
      ...actor(auth),
      action: 'REORDER_PRODUCT_IMAGES',
      targetType: 'product',
      targetId: productId,
      details: { imageIds },
    });
    return (await loadImages(client, productId)).map(imageDto);
  });
}

export async function setPrimaryImage(
  pool: DbPool,
  auth: AuthContext,
  productId: string,
  imageId: string
): Promise<ImageDto[]> {
  return withTransaction(pool, async client => {
    // Keep the parent-product lock first, matching every other image/SKU write.
    const product = await client.query('SELECT 1 FROM products WHERE id = $1 FOR UPDATE', [productId]);
    if (!product.rowCount) throw new HttpError(404, 'product_not_found', 'Product not found.');
    const image = await client.query<ImageRow>(
      'SELECT * FROM product_images WHERE id = $1 AND product_id = $2 AND removed_at IS NULL FOR UPDATE',
      [imageId, productId]
    );
    if (!image.rows[0]) throw new HttpError(404, 'image_not_found', 'Image not found.');
    await client.query(
      'UPDATE product_images SET is_primary = (id = $2) WHERE product_id = $1 AND removed_at IS NULL',
      [productId, imageId]
    );
    await writeAudit(client, {
      ...actor(auth),
      action: 'SET_PRIMARY_PRODUCT_IMAGE',
      targetType: 'product_image',
      targetId: imageId,
      details: { productId },
    });
    return (await loadImages(client, productId)).map(imageDto);
  });
}

export async function removeProductImage(
  pool: DbPool,
  auth: AuthContext,
  productId: string,
  imageId: string
): Promise<ImageDto[]> {
  return withTransaction(pool, async client => {
    const product = await client.query<{ published: boolean }>(
      'SELECT published FROM products WHERE id = $1 FOR UPDATE',
      [productId]
    );
    if (!product.rows[0]) throw new HttpError(404, 'product_not_found', 'Product not found.');
    const image = await client.query<ImageRow>(
      'SELECT * FROM product_images WHERE id = $1 AND product_id = $2 AND removed_at IS NULL FOR UPDATE',
      [imageId, productId]
    );
    if (!image.rows[0]) throw new HttpError(404, 'image_not_found', 'Image not found.');
    if (image.rows[0].is_primary) {
      throw new HttpError(409, 'primary_image_required', 'Set another image as primary before removing this one.');
    }
    const count = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM product_images WHERE product_id = $1 AND removed_at IS NULL',
      [productId]
    );
    if (product.rows[0].published && Number(count.rows[0].count) <= 1) {
      throw new HttpError(409, 'last_image_required', 'Unpublish the product before removing its last image.');
    }
    await client.query(
      'UPDATE product_skus SET image_id = NULL, updated_at = now() WHERE product_id = $1 AND image_id = $2',
      [productId, imageId]
    );
    await client.query('UPDATE product_images SET removed_at = now(), is_primary = false WHERE id = $1', [
      imageId,
    ]);
    await writeAudit(client, {
      ...actor(auth),
      action: 'REMOVE_PRODUCT_IMAGE',
      targetType: 'product_image',
      targetId: imageId,
      details: { productId },
    });
    return (await loadImages(client, productId)).map(imageDto);
  });
}

// --- Taxonomy ---------------------------------------------------------------

export interface SeriesDto {
  id: string;
  nameZh: string;
  nameEn: string;
  sortOrder: number;
  active: boolean;
  productCount: number;
}

export interface TagDto {
  id: string;
  nameZh: string;
  nameEn: string;
  tone: string;
  sortOrder: number;
  active: boolean;
  productCount: number;
}

interface SeriesRow {
  id: string;
  name_zh: string;
  name_en: string;
  sort_order: number;
  active: boolean;
  product_count: string;
}

interface TagRow {
  id: string;
  name_zh: string;
  name_en: string;
  tone: string;
  sort_order: number;
  active: boolean;
  product_count: string;
}

export async function listSeries(pool: DbPool): Promise<SeriesDto[]> {
  const rows = await queryRows<SeriesRow>(
    pool,
    `SELECT s.*, (SELECT count(*)::text FROM products p WHERE p.series_id = s.id) AS product_count
     FROM series_definitions s ORDER BY s.sort_order, s.id`
  );
  return rows.map(row => ({
    id: row.id,
    nameZh: row.name_zh,
    nameEn: row.name_en,
    sortOrder: row.sort_order,
    active: row.active,
    productCount: Number(row.product_count),
  }));
}

export async function createSeries(
  pool: DbPool,
  auth: AuthContext,
  input: { nameZh: string; nameEn: string; sortOrder?: number }
): Promise<SeriesDto> {
  const id = `series_${randomUUID()}`;
  const nameZh = requiredText(input.nameZh, 'nameZh', 120);
  const nameEn = requiredText(input.nameEn, 'nameEn', 120);
  const sortOrder = optionalInteger(input.sortOrder, 'sortOrder', 0, 100_000) ?? 0;
  return withTransaction(pool, async client => {
    await client.query(
      'INSERT INTO series_definitions (id, name_zh, name_en, sort_order) VALUES ($1, $2, $3, $4)',
      [id, nameZh, nameEn, sortOrder]
    );
    await writeAudit(client, {
      ...actor(auth),
      action: 'CREATE_SERIES',
      targetType: 'series_definition',
      targetId: id,
      details: { nameZh, nameEn },
    });
    return {
      id,
      nameZh,
      nameEn,
      sortOrder,
      active: true,
      productCount: 0,
    };
  });
}

export async function updateSeries(
  pool: DbPool,
  auth: AuthContext,
  seriesId: string,
  input: { nameZh?: string; nameEn?: string; sortOrder?: number; active?: boolean }
): Promise<SeriesDto> {
  return withTransaction(pool, async client => {
    const existing = await client.query(
      'SELECT 1 FROM series_definitions WHERE id = $1 FOR UPDATE',
      [seriesId]
    );
    if (!existing.rowCount) throw new HttpError(404, 'series_not_found', 'Series not found.');
    await client.query(
      `UPDATE series_definitions SET
        name_zh = COALESCE($2, name_zh),
        name_en = COALESCE($3, name_en),
        sort_order = COALESCE($4, sort_order),
        active = COALESCE($5, active),
        updated_at = now()
       WHERE id = $1`,
      [
        seriesId,
        input.nameZh === undefined ? null : requiredText(input.nameZh, 'nameZh', 120),
        input.nameEn === undefined ? null : requiredText(input.nameEn, 'nameEn', 120),
        optionalInteger(input.sortOrder, 'sortOrder', 0, 100_000) ?? null,
        input.active === undefined ? null : booleanValue(input.active, 'active'),
      ]
    );
    await writeAudit(client, {
      ...actor(auth),
      action: 'UPDATE_SERIES',
      targetType: 'series_definition',
      targetId: seriesId,
      details: { fields: Object.keys(input) },
    });
    const rows = await queryRows<SeriesRow>(
      client,
      `SELECT s.*, (SELECT count(*)::text FROM products p WHERE p.series_id = s.id) AS product_count
       FROM series_definitions s WHERE s.id = $1`,
      [seriesId]
    );
    const row = rows[0];
    return {
      id: row.id,
      nameZh: row.name_zh,
      nameEn: row.name_en,
      sortOrder: row.sort_order,
      active: row.active,
      productCount: Number(row.product_count),
    };
  });
}

export async function listTags(pool: DbPool): Promise<TagDto[]> {
  const rows = await queryRows<TagRow>(
    pool,
    `SELECT t.*, (SELECT count(*)::text FROM product_feature_tags pt WHERE pt.tag_id = t.id) AS product_count
     FROM feature_tags t ORDER BY t.sort_order, t.id`
  );
  return rows.map(row => ({
    id: row.id,
    nameZh: row.name_zh,
    nameEn: row.name_en,
    tone: row.tone,
    sortOrder: row.sort_order,
    active: row.active,
    productCount: Number(row.product_count),
  }));
}

export async function createTag(
  pool: DbPool,
  auth: AuthContext,
  input: { code: string; nameZh: string; nameEn: string; tone?: string; sortOrder?: number }
): Promise<TagDto> {
  const code = requiredText(input.code, 'code', 40).toUpperCase();
  if (!TAG_CODE.test(code)) {
    throw new HttpError(400, 'invalid_tag_code', 'Tag code must be uppercase letters, digits or underscores.');
  }
  const tone = input.tone ?? 'orange';
  if (!TONES.includes(tone)) throw new HttpError(400, 'invalid_tone', 'Unknown tag tone.');
  const nameZh = requiredText(input.nameZh, 'nameZh', 120);
  const nameEn = requiredText(input.nameEn, 'nameEn', 120);
  const sortOrder = optionalInteger(input.sortOrder, 'sortOrder', 0, 100_000) ?? 0;
  return withTransaction(pool, async client => {
    const duplicate = await client.query('SELECT 1 FROM feature_tags WHERE id = $1', [code]);
    if (duplicate.rowCount) throw new HttpError(409, 'duplicate_tag_code', `Tag ${code} already exists.`);
    await client.query(
      'INSERT INTO feature_tags (id, name_zh, name_en, tone, sort_order) VALUES ($1, $2, $3, $4, $5)',
      [code, nameZh, nameEn, tone, sortOrder]
    );
    await writeAudit(client, {
      ...actor(auth),
      action: 'CREATE_FEATURE_TAG',
      targetType: 'feature_tag',
      targetId: code,
      details: { nameZh, nameEn },
    });
    return { id: code, nameZh, nameEn, tone, sortOrder, active: true, productCount: 0 };
  });
}

export async function updateTag(
  pool: DbPool,
  auth: AuthContext,
  tagId: string,
  input: { nameZh?: string; nameEn?: string; tone?: string; sortOrder?: number; active?: boolean }
): Promise<TagDto> {
  if (input.tone !== undefined && !TONES.includes(input.tone)) {
    throw new HttpError(400, 'invalid_tone', 'Unknown tag tone.');
  }
  return withTransaction(pool, async client => {
    const existing = await client.query('SELECT 1 FROM feature_tags WHERE id = $1 FOR UPDATE', [tagId]);
    if (!existing.rowCount) throw new HttpError(404, 'tag_not_found', 'Feature tag not found.');
    await client.query(
      `UPDATE feature_tags SET
        name_zh = COALESCE($2, name_zh),
        name_en = COALESCE($3, name_en),
        tone = COALESCE($4, tone),
        sort_order = COALESCE($5, sort_order),
        active = COALESCE($6, active),
        updated_at = now()
       WHERE id = $1`,
      [
        tagId,
        input.nameZh === undefined ? null : requiredText(input.nameZh, 'nameZh', 120),
        input.nameEn === undefined ? null : requiredText(input.nameEn, 'nameEn', 120),
        input.tone ?? null,
        optionalInteger(input.sortOrder, 'sortOrder', 0, 100_000) ?? null,
        input.active === undefined ? null : booleanValue(input.active, 'active'),
      ]
    );
    await writeAudit(client, {
      ...actor(auth),
      action: 'UPDATE_FEATURE_TAG',
      targetType: 'feature_tag',
      targetId: tagId,
      details: { fields: Object.keys(input) },
    });
    const rows = await queryRows<TagRow>(
      client,
      `SELECT t.*, (SELECT count(*)::text FROM product_feature_tags pt WHERE pt.tag_id = t.id) AS product_count
       FROM feature_tags t WHERE t.id = $1`,
      [tagId]
    );
    const row = rows[0];
    return {
      id: row.id,
      nameZh: row.name_zh,
      nameEn: row.name_en,
      tone: row.tone,
      sortOrder: row.sort_order,
      active: row.active,
      productCount: Number(row.product_count),
    };
  });
}

// --- Customer catalogue -----------------------------------------------------

export interface CustomerCatalogQuery {
  productId?: string;
  brandId?: string;
  seriesId?: string;
  tagId?: string;
  category?: string;
  search?: string;
}

interface CustomerProductRow extends ProductRow {
  company_granted?: boolean;
}

export async function listCustomerProducts(
  pool: DbPool,
  auth: AuthContext,
  query: CustomerCatalogQuery
): Promise<CustomerProductDto[]> {
  const companyId = auth.user.companyId;
  if (!companyId) throw new HttpError(403, 'forbidden', 'A customer company is required.');

  const values: unknown[] = [companyId];
  const filters: string[] = [
    'p.published = true',
    'EXISTS (SELECT 1 FROM brand_grants g WHERE g.company_id = $1 AND g.brand_id = p.brand_id)',
    `EXISTS (SELECT 1 FROM product_skus s WHERE s.product_id = p.id AND s.sellable_status = 'active')`,
  ];
  let index = 2;
  if (query.productId) {
    filters.push(`p.id = $${index++}`);
    values.push(query.productId);
  }
  if (query.brandId) {
    filters.push(`p.brand_id = $${index++}`);
    values.push(query.brandId);
  }
  if (query.seriesId) {
    filters.push(`p.series_id = $${index++}`);
    values.push(query.seriesId);
  }
  if (query.tagId) {
    filters.push(
      `EXISTS (SELECT 1 FROM product_feature_tags pt WHERE pt.product_id = p.id AND pt.tag_id = $${index++})`
    );
    values.push(query.tagId);
  }
  if (query.category) {
    filters.push(`p.category = $${index++}`);
    values.push(query.category);
  }
  if (query.search) {
    filters.push(
      `(p.product_code ILIKE $${index} OR p.title ILIKE $${index} OR p.title_en ILIKE $${index})`
    );
    values.push(`%${query.search}%`);
    index++;
  }

  const rows = await queryRows<CustomerProductRow>(
    pool,
    `${PRODUCT_SELECT} WHERE ${filters.join(' AND ')} ORDER BY p.created_at DESC, p.id`,
    values
  );

  const products: CustomerProductDto[] = [];
  for (const row of rows) {
    const [skus, images, tags] = await Promise.all([
      loadSkus(pool, row.id),
      loadImages(pool, row.id),
      loadTagIds(pool, row.id),
    ]);
    const activeSkus = skus.filter(sku => sku.sellable_status === 'active');
    const available = await queryRows<{ sku_id: string; available: string }>(
      pool,
      `SELECT sku_id, GREATEST(COALESCE(SUM(on_hand - reserved - unsellable), 0), 0)::text AS available
       FROM inventory_balances WHERE sku_id = ANY($1::uuid[]) GROUP BY sku_id`,
      [activeSkus.map(sku => sku.id)]
    );
    const availability = new Map(available.map(item => [item.sku_id, Number(item.available)]));
    const dto = productDto(row, activeSkus, images, tags) as CustomerProductDto;
    dto.skus = activeSkus.map(sku => ({
      ...skuDto(sku),
      available: availability.get(sku.id) ?? 0,
    }));
    products.push(dto);
  }
  return products;
}

export async function getCustomerProduct(
  pool: DbPool,
  auth: AuthContext,
  productId: string
): Promise<CustomerProductDto> {
  const products = await listCustomerProducts(pool, auth, { productId });
  if (!products[0]) throw new HttpError(404, 'product_not_found', 'Product not found.');
  return products[0];
}

export async function listCustomerSeries(pool: DbPool): Promise<SeriesDto[]> {
  const all = await listSeries(pool);
  return all.filter(series => series.active);
}

export async function listCustomerTags(pool: DbPool): Promise<TagDto[]> {
  const all = await listTags(pool);
  return all.filter(tag => tag.active);
}

export async function listBrands(pool: DbPool) {
  const rows = await queryRows<{ id: string; code: string; name: string; name_en: string | null; active: boolean }>(
    pool,
    'SELECT id, code, name, name_en, active FROM brands ORDER BY code'
  );
  return rows.map(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    nameEn: row.name_en ?? row.name,
    active: row.active,
  }));
}

export async function listCustomerBrands(pool: DbPool, auth: AuthContext) {
  const companyId = auth.user.companyId;
  if (!companyId) throw new HttpError(403, 'forbidden', 'A customer company is required.');
  const rows = await queryRows<{ id: string; code: string; name: string; name_en: string | null }>(
    pool,
    `SELECT b.id, b.code, b.name, b.name_en
     FROM brands b JOIN brand_grants g ON g.brand_id = b.id
     WHERE g.company_id = $1 AND b.active = true ORDER BY b.code`,
    [companyId]
  );
  return rows.map(row => ({ id: row.id, code: row.code, name: row.name, nameEn: row.name_en ?? row.name }));
}

// --- Media access -----------------------------------------------------------

export interface MediaAccessResult {
  productId: string;
  storageKey: string;
  mimeType: string;
  removed: boolean;
}

export async function getMediaForAuth(
  pool: DbPool,
  auth: AuthContext,
  imageId: string
): Promise<MediaAccessResult> {
  const rows = await queryRows<{
    product_id: string;
    storage_key: string;
    mime_type: string;
    removed_at: Date | null;
    published: boolean;
    brand_id: string;
  }>(
    pool,
    `SELECT i.product_id, i.storage_key, i.mime_type, i.removed_at, p.published, p.brand_id
     FROM product_images i JOIN products p ON p.id = i.product_id WHERE i.id = $1`,
    [imageId]
  );
  const image = rows[0];
  if (!image || image.removed_at) throw new HttpError(404, 'image_not_found', 'Image not found.');

  if (auth.user.type === 'customer') {
    if (!image.published) throw new HttpError(404, 'image_not_found', 'Image not found.');
    const companyId = auth.user.companyId;
    const access = await queryRows(
      pool,
      `SELECT 1 FROM brand_grants g
       WHERE g.company_id = $1 AND g.brand_id = $2
         AND EXISTS (SELECT 1 FROM product_skus s WHERE s.product_id = $3 AND s.sellable_status = 'active')`,
      [companyId, image.brand_id, image.product_id]
    );
    if (!access[0]) throw new HttpError(404, 'image_not_found', 'Image not found.');
  }

  return {
    productId: image.product_id,
    storageKey: image.storage_key,
    mimeType: image.mime_type,
    removed: Boolean(image.removed_at),
  };
}
