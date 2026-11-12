import { Router } from 'express';
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
  adjustInventory,
  commitImport,
  createWarehouse,
  listInventory,
  listWarehouses,
  previewImport,
  registerInventory,
  updateWarehouse,
} from './service.js';

function textQuery(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function createAdminInventoryRouter(pool: DbPool, config: AuthConfig): Router {
  const router = Router();
  router.use(
    requireAuth(pool, config),
    requirePasswordChanged,
    requireCsrfForUnsafeMethods(config.cookieSecure)
  );

  // The admin router is limited to administrators; sales read stock through
  // the read-only /api/sales inventory endpoints.
  const manage = requirePermission('inventory.manage');

  router.get(
    '/warehouses',
    manage,
    asyncHandler(async (_req, res) => {
      res.status(200).json({ warehouses: await listWarehouses(pool) });
    })
  );

  router.post(
    '/warehouses',
    manage,
    asyncHandler(async (req, res) => {
      res.status(201).json({
        warehouse: await createWarehouse(pool, req.auth!, {
          code: String(req.body?.code ?? ''),
          name: String(req.body?.name ?? ''),
          nameEn: String(req.body?.nameEn ?? ''),
          active: req.body?.active,
        }),
      });
    })
  );

  router.patch(
    '/warehouses/:id',
    manage,
    asyncHandler(async (req, res) => {
      res.status(200).json({
        warehouse: await updateWarehouse(pool, req.auth!, req.params.id, req.body ?? {}),
      });
    })
  );

  router.get(
    '/inventory',
    manage,
    asyncHandler(async (req, res) => {
      res.status(200).json({
        inventory: await listInventory(pool, {
          warehouseId: textQuery(req.query.warehouseId),
          skuId: textQuery(req.query.skuId),
          search: textQuery(req.query.search),
        }),
      });
    })
  );

  router.post(
    '/inventory/register',
    manage,
    asyncHandler(async (req, res) => {
      res.status(201).json({
        inventory: await registerInventory(pool, req.auth!, {
          skuId: String(req.body?.skuId ?? ''),
          warehouseId: String(req.body?.warehouseId ?? ''),
          onHand: Number(req.body?.onHand),
          unsellable: req.body?.unsellable === undefined ? 0 : Number(req.body.unsellable),
          reason: String(req.body?.reason ?? ''),
        }),
      });
    })
  );

  router.patch(
    '/inventory/:skuId/:warehouseId',
    manage,
    asyncHandler(async (req, res) => {
      res.status(200).json({
        inventory: await adjustInventory(pool, req.auth!, req.params.skuId, req.params.warehouseId, {
          onHand: req.body?.onHand,
          unsellable: req.body?.unsellable,
          expectedVersion: Number(req.body?.expectedVersion),
          reason: String(req.body?.reason ?? ''),
        }),
      });
    })
  );

  router.post(
    '/inventory/import/preview',
    manage,
    asyncHandler(async (req, res) => {
      res.status(201).json({
        preview: await previewImport(pool, req.auth!, {
          sourceName: req.body?.sourceName,
          idempotencyKey: String(req.body?.idempotencyKey ?? ''),
          rows: Array.isArray(req.body?.rows) ? req.body.rows : [],
        }),
      });
    })
  );

  router.post(
    '/inventory/import/:batchId/commit',
    manage,
    asyncHandler(async (req, res) => {
      res.status(200).json({
        result: await commitImport(pool, req.auth!, req.params.batchId),
      });
    })
  );

  return router;
}

export function createSalesInventoryRouter(pool: DbPool, config: AuthConfig): Router {
  const router = Router();
  router.use(
    requireAuth(pool, config),
    requirePasswordChanged,
    requireUserType('internal')
  );

  router.get(
    '/inventory',
    requirePermission('inventory.read'),
    asyncHandler(async (req, res) => {
      res.status(200).json({
        inventory: await listInventory(pool, {
          warehouseId: textQuery(req.query.warehouseId),
          skuId: textQuery(req.query.skuId),
          search: textQuery(req.query.search),
        }),
      });
    })
  );

  router.get(
    '/warehouses',
    requirePermission('inventory.read'),
    asyncHandler(async (_req, res) => {
      res.status(200).json({ warehouses: await listWarehouses(pool) });
    })
  );

  return router;
}
