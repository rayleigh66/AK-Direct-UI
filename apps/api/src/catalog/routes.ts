import express, { Router } from 'express';
import type { DbPool } from '../db/pool.js';
import { asyncHandler } from '../http/errors.js';
import { requireCsrfForUnsafeMethods } from '../http/csrf.js';
import {
  requireAuth,
  requirePasswordChanged,
  requirePermission,
  requireUserType,
} from '../auth/session.js';
import type { AuthConfig } from '../auth/types.js';
import {
  createProduct,
  createSeries,
  createSku,
  createTag,
  getAdminProduct,
  getCustomerProduct,
  listAdminProducts,
  listBrands,
  listCustomerBrands,
  listCustomerProducts,
  listCustomerSeries,
  listCustomerTags,
  listSeries,
  listTags,
  removeProductImage,
  reorderProductImages,
  setPrimaryImage,
  setProductPublished,
  updateProduct,
  updateSeries,
  updateSku,
  updateTag,
  uploadProductImage,
} from './service.js';

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function createAdminCatalogRouter(
  pool: DbPool,
  config: AuthConfig,
  mediaRoot: string
): Router {
  const router = Router();
  router.use(
    requireAuth(pool, config),
    requirePasswordChanged,
    requireCsrfForUnsafeMethods(config.cookieSecure)
  );

  const read = requirePermission('catalog.read');
  const write = requirePermission('catalog.manage');

  router.get(
    '/brands',
    read,
    asyncHandler(async (_req, res) => {
      res.status(200).json({ brands: await listBrands(pool) });
    })
  );

  router.get(
    '/products',
    read,
    asyncHandler(async (_req, res) => {
      res.status(200).json({ products: await listAdminProducts(pool) });
    })
  );

  router.get(
    '/products/:id',
    read,
    asyncHandler(async (req, res) => {
      res.status(200).json({ product: await getAdminProduct(pool, req.params.id) });
    })
  );

  router.post(
    '/products',
    write,
    asyncHandler(async (req, res) => {
      res.status(201).json({
        product: await createProduct(pool, req.auth!, {
          brandId: String(req.body?.brandId ?? ''),
          productCode: String(req.body?.productCode ?? ''),
          title: String(req.body?.title ?? ''),
          titleEn: String(req.body?.titleEn ?? ''),
          description: queryString(req.body?.description),
          descriptionEn: queryString(req.body?.descriptionEn),
          category: String(req.body?.category ?? ''),
          material: queryString(req.body?.material),
          capacityOrSize: queryString(req.body?.capacityOrSize),
          seriesId: req.body?.seriesId ?? null,
          tagIds: Array.isArray(req.body?.tagIds) ? req.body.tagIds : [],
        }),
      });
    })
  );

  router.patch(
    '/products/:id',
    write,
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      res.status(200).json({
        product: await updateProduct(pool, req.auth!, req.params.id, {
          brandId: body.brandId,
          productCode: body.productCode,
          title: body.title,
          titleEn: body.titleEn,
          description: body.description,
          descriptionEn: body.descriptionEn,
          category: body.category,
          material: body.material,
          capacityOrSize: body.capacityOrSize,
          seriesId: body.seriesId,
          tagIds: body.tagIds,
        }),
      });
    })
  );

  router.post(
    '/products/:id/publish',
    write,
    asyncHandler(async (req, res) => {
      res.status(200).json({
        product: await setProductPublished(pool, req.auth!, req.params.id, true),
      });
    })
  );

  router.post(
    '/products/:id/unpublish',
    write,
    asyncHandler(async (req, res) => {
      res.status(200).json({
        product: await setProductPublished(pool, req.auth!, req.params.id, false, {
          confirmAffectedOrders: req.body?.confirmAffectedOrders === true,
          impactToken:
            typeof req.body?.impactToken === 'string' ? req.body.impactToken : undefined,
        }),
      });
    })
  );

  router.post(
    '/products/:id/skus',
    write,
    asyncHandler(async (req, res) => {
      const initial = req.body?.initialInventory;
      res.status(201).json({
        sku: await createSku(pool, req.auth!, req.params.id, {
          skuCode: String(req.body?.skuCode ?? ''),
          colorName: String(req.body?.colorName ?? ''),
          colorNameEn: String(req.body?.colorNameEn ?? ''),
          colorHex: String(req.body?.colorHex ?? ''),
          basePriceCents: Number(req.body?.basePriceCents),
          sellableStatus: req.body?.sellableStatus,
          imageId: req.body?.imageId ?? null,
          initialInventory:
            initial && typeof initial === 'object'
              ? {
                  warehouseId: String(initial.warehouseId ?? ''),
                  onHand: Number(initial.onHand),
                  unsellable: initial.unsellable === undefined ? 0 : Number(initial.unsellable),
                }
              : undefined,
        }),
      });
    })
  );

  router.patch(
    '/skus/:id',
    write,
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      res.status(200).json({
        sku: await updateSku(pool, req.auth!, req.params.id, {
          skuCode: body.skuCode,
          colorName: body.colorName,
          colorNameEn: body.colorNameEn,
          colorHex: body.colorHex,
          basePriceCents: body.basePriceCents,
          sellableStatus: body.sellableStatus,
          imageId: body.imageId,
          confirmAffectedOrders: body.confirmAffectedOrders === true,
          impactToken: typeof body.impactToken === 'string' ? body.impactToken : undefined,
        }),
      });
    })
  );

  const rawImage = express.raw({
    type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
    limit: '5mb',
  });

  router.post(
    '/products/:id/images',
    write,
    rawImage,
    asyncHandler(async (req, res) => {
      if (!Buffer.isBuffer(req.body)) {
        res.status(415).json({
          error: { code: 'unsupported_image', message: 'Send the image bytes with an image content type.' },
        });
        return;
      }
      res.status(201).json({
        image: await uploadProductImage(
          pool,
          req.auth!,
          req.params.id,
          req.body,
          req.get('content-type'),
          mediaRoot
        ),
      });
    })
  );

  router.patch(
    '/products/:id/images/order',
    write,
    asyncHandler(async (req, res) => {
      const imageIds = Array.isArray(req.body?.imageIds) ? req.body.imageIds.map(String) : [];
      res.status(200).json({
        images: await reorderProductImages(pool, req.auth!, req.params.id, imageIds),
      });
    })
  );

  router.put(
    '/products/:id/images/:imageId/primary',
    write,
    asyncHandler(async (req, res) => {
      res.status(200).json({
        images: await setPrimaryImage(pool, req.auth!, req.params.id, req.params.imageId),
      });
    })
  );

  router.delete(
    '/products/:id/images/:imageId',
    write,
    asyncHandler(async (req, res) => {
      res.status(200).json({
        images: await removeProductImage(pool, req.auth!, req.params.id, req.params.imageId),
      });
    })
  );

  router.get(
    '/series',
    read,
    asyncHandler(async (_req, res) => {
      res.status(200).json({ series: await listSeries(pool) });
    })
  );

  router.post(
    '/series',
    write,
    asyncHandler(async (req, res) => {
      res.status(201).json({
        series: await createSeries(pool, req.auth!, {
          nameZh: String(req.body?.nameZh ?? ''),
          nameEn: String(req.body?.nameEn ?? ''),
          sortOrder: req.body?.sortOrder,
        }),
      });
    })
  );

  router.patch(
    '/series/:id',
    write,
    asyncHandler(async (req, res) => {
      res.status(200).json({
        series: await updateSeries(pool, req.auth!, req.params.id, req.body ?? {}),
      });
    })
  );

  router.get(
    '/tags',
    read,
    asyncHandler(async (_req, res) => {
      res.status(200).json({ tags: await listTags(pool) });
    })
  );

  router.post(
    '/tags',
    write,
    asyncHandler(async (req, res) => {
      res.status(201).json({
        tag: await createTag(pool, req.auth!, {
          code: String(req.body?.code ?? ''),
          nameZh: String(req.body?.nameZh ?? ''),
          nameEn: String(req.body?.nameEn ?? ''),
          tone: req.body?.tone,
          sortOrder: req.body?.sortOrder,
        }),
      });
    })
  );

  router.patch(
    '/tags/:id',
    write,
    asyncHandler(async (req, res) => {
      res.status(200).json({
        tag: await updateTag(pool, req.auth!, req.params.id, req.body ?? {}),
      });
    })
  );

  return router;
}

export function createCustomerCatalogRouter(pool: DbPool, config: AuthConfig): Router {
  const router = Router();
  router.use(requireAuth(pool, config), requirePasswordChanged, requireUserType('customer'));

  router.get(
    '/products',
    asyncHandler(async (req, res) => {
      res.status(200).json({
        products: await listCustomerProducts(pool, req.auth!, {
          brandId: queryString(req.query.brandId),
          seriesId: queryString(req.query.seriesId),
          tagId: queryString(req.query.tagId),
          category: queryString(req.query.category),
          search: queryString(req.query.search),
        }),
      });
    })
  );

  router.get(
    '/products/:id',
    asyncHandler(async (req, res) => {
      res.status(200).json({ product: await getCustomerProduct(pool, req.auth!, req.params.id) });
    })
  );

  router.get(
    '/brands',
    asyncHandler(async (req, res) => {
      res.status(200).json({ brands: await listCustomerBrands(pool, req.auth!) });
    })
  );

  router.get(
    '/series',
    asyncHandler(async (_req, res) => {
      res.status(200).json({ series: await listCustomerSeries(pool) });
    })
  );

  router.get(
    '/tags',
    asyncHandler(async (_req, res) => {
      res.status(200).json({ tags: await listCustomerTags(pool) });
    })
  );

  return router;
}
