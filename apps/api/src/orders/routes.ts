import { Router } from 'express';
import type { DbPool } from '../db/pool.js';
import { asyncHandler, HttpError } from '../http/errors.js';
import { requireCsrfForUnsafeMethods } from '../http/csrf.js';
import {
  requireAuth,
  requirePasswordChanged,
  requirePermission,
  requireUserType,
} from '../auth/session.js';
import type { AuthConfig } from '../auth/types.js';
import {
  cancelCustomerOrder,
  getAdminOrder,
  getCustomerOrder,
  getSalesOrder,
  listAdminOrders,
  listCustomerOrders,
  listSalesOrders,
  modifyOrderLines,
  submitOrder,
} from './service.js';
import { IMPACT_KINDS, findPendingOrderImpact, type ImpactKind } from './impact.js';
import { decidePlanAcceptance, saveSalesPlan } from './planService.js';
import { confirmOrder } from './confirmationService.js';
import {
  requestOrderRelease,
  requestReservationExtension,
} from './reservationService.js';

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function impactKind(value: unknown): ImpactKind {
  if (typeof value !== 'string' || !IMPACT_KINDS.includes(value as ImpactKind)) {
    throw new HttpError(400, 'invalid_impact_kind', 'Unknown order-impact action.');
  }
  return value as ImpactKind;
}

export function createCustomerOrderRouter(pool: DbPool, config: AuthConfig): Router {
  const router = Router();
  router.use(
    requireAuth(pool, config),
    requirePasswordChanged,
    requireUserType('customer'),
    requireCsrfForUnsafeMethods(config.cookieSecure)
  );
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.status(200).json({ orders: await listCustomerOrders(pool, req.auth!) });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.status(200).json({ order: await getCustomerOrder(pool, req.auth!, req.params.id) });
    })
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const result = await submitOrder(pool, config, req.auth!, {
        idempotencyKey: req.body?.idempotencyKey,
        expectedCartRevision: req.body?.expectedCartRevision,
        shippingMethod: req.body?.shippingMethod,
        destinationCountryAlpha3: req.body?.destinationCountryAlpha3,
        expectedShipDate: req.body?.expectedShipDate,
        shippingRequirements: req.body?.shippingRequirements,
      });
      res.status(result.alreadySubmitted ? 200 : 201).json(result);
    })
  );

  router.patch(
    '/:id/lines',
    asyncHandler(async (req, res) => {
      const lines = Array.isArray(req.body?.lines)
        ? req.body.lines.map((line: { skuId?: unknown; quantity?: unknown }) => ({
            skuId: String(line?.skuId ?? ''),
            quantity: line?.quantity,
          }))
        : [];
      res.status(200).json({
        order: await modifyOrderLines(pool, req.auth!, req.params.id, {
          expectedRevision: req.body?.expectedRevision,
          lines,
        }),
      });
    })
  );

  router.post(
    '/:id/cancel',
    asyncHandler(async (req, res) => {
      res.status(200).json({
        order: await cancelCustomerOrder(pool, req.auth!, req.params.id, {
          expectedRevision: req.body?.expectedRevision,
          reason: req.body?.reason,
        }),
      });
    })
  );

  router.post(
    '/:id/plan-decision',
    asyncHandler(async (req, res) => {
      res.status(200).json({
        order: await decidePlanAcceptance(pool, req.auth!, req.params.id, {
          expectedRevision: req.body?.expectedRevision,
          expectedPlanVersion: req.body?.expectedPlanVersion,
          planDigest: req.body?.planDigest,
          outcome: req.body?.outcome,
          reason: req.body?.reason,
          idempotencyKey: req.body?.idempotencyKey,
        }),
      });
    })
  );

  return router;
}

export function createSalesOrderRouter(pool: DbPool, config: AuthConfig): Router {
  const router = Router();
  router.use(
    requireAuth(pool, config),
    requirePasswordChanged,
    requireUserType('internal'),
    requireCsrfForUnsafeMethods(config.cookieSecure)
  );
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.status(200).json({ orders: await listSalesOrders(pool, req.auth!) });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.status(200).json({ order: await getSalesOrder(pool, req.auth!, req.params.id) });
    })
  );

  router.post(
    '/:id/plans',
    requirePermission('sales.write'),
    asyncHandler(async (req, res) => {
      const result = await saveSalesPlan(pool, req.auth!, req.params.id, {
        expectedRevision: req.body?.expectedRevision,
        expectedPlanVersion: req.body?.expectedPlanVersion,
        lines: req.body?.lines,
        idempotencyKey: req.body?.idempotencyKey,
      });
      res.status(200).json(result);
    })
  );

  router.post(
    '/:id/confirm',
    requirePermission('sales.write'),
    asyncHandler(async (req, res) => {
      res.status(200).json({
        order: await confirmOrder(pool, req.auth!, req.params.id, {
          expectedRevision: req.body?.expectedRevision,
          expectedPlanVersion: req.body?.expectedPlanVersion,
          planDigest: req.body?.planDigest,
          acceptanceId: req.body?.acceptanceId,
          allocations: req.body?.allocations,
          idempotencyKey: req.body?.idempotencyKey,
        }),
      });
    })
  );

  router.post(
    '/:id/extension-requests',
    requirePermission('sales.write'),
    asyncHandler(async (req, res) => {
      res.status(201).json(
        await requestReservationExtension(pool, req.auth!, req.params.id, {
          expectedRevision: req.body?.expectedRevision,
          expectedReservationVersion: req.body?.expectedReservationVersion,
          additionalHours: req.body?.additionalHours,
          reason: req.body?.reason,
          idempotencyKey: req.body?.idempotencyKey,
        })
      );
    })
  );

  router.post(
    '/:id/release-requests',
    requirePermission('sales.write'),
    asyncHandler(async (req, res) => {
      res.status(201).json(
        await requestOrderRelease(pool, req.auth!, req.params.id, {
          expectedRevision: req.body?.expectedRevision,
          expectedReservationVersion: req.body?.expectedReservationVersion,
          reason: req.body?.reason,
          paymentVerification: req.body?.paymentVerification,
          shipmentVerification: req.body?.shipmentVerification,
          verificationNote: req.body?.verificationNote,
          idempotencyKey: req.body?.idempotencyKey,
        })
      );
    })
  );

  return router;
}

export function createAdminOrderRouter(pool: DbPool, config: AuthConfig): Router {
  const router = Router();
  router.use(
    requireAuth(pool, config),
    requirePasswordChanged,
    requireCsrfForUnsafeMethods(config.cookieSecure),
    requirePermission('sales.read_all')
  );
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Must be declared before /:id.
  router.get(
    '/impact',
    asyncHandler(async (req, res) => {
      const kind = impactKind(req.query.kind);
      const targetId = queryString(req.query.targetId);
      if (!targetId) {
        throw new HttpError(400, 'invalid_request', 'targetId is required.');
      }
      const companyId = queryString(req.query.companyId) ?? null;
      if (kind === 'brand_revoke' && !companyId) {
        throw new HttpError(400, 'invalid_request', 'companyId is required for a brand revoke.');
      }
      res.status(200).json({ impact: await findPendingOrderImpact(pool, kind, targetId, companyId) });
    })
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.status(200).json({ orders: await listAdminOrders(pool, req.auth!) });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.status(200).json({ order: await getAdminOrder(pool, req.auth!, req.params.id) });
    })
  );

  return router;
}
