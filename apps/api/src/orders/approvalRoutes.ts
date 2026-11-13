import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DbPool } from '../db/pool.js';
import { asyncHandler, HttpError } from '../http/errors.js';
import { requireCsrfForUnsafeMethods } from '../http/csrf.js';
import {
  requireAuth,
  requirePasswordChanged,
  requirePermission,
} from '../auth/session.js';
import type { AuthConfig } from '../auth/types.js';
import {
  getOrderApproval,
  listOrderApprovals,
  parseApprovalStatus,
  parseApprovalType,
} from './approvalService.js';
import { decidePriceApproval } from './planService.js';
import {
  decideOrderRelease,
  decideReservationExtension,
  reconcileReservations,
  runExpiryScan,
} from './reservationService.js';
import { isUuid } from './validation.js';

const uuidParam = (_req: Request, _res: Response, next: NextFunction, value: string) => {
  if (!isUuid(value)) {
    next(new HttpError(400, 'invalid_request', 'id must be a UUID.'));
    return;
  }
  next();
};

export function createOrderApprovalRouter(pool: DbPool, config: AuthConfig): Router {
  const router = Router();
  router.param('id', uuidParam);
  router.use(
    requireAuth(pool, config),
    requirePasswordChanged,
    requireCsrfForUnsafeMethods(config.cookieSecure)
  );
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const type = parseApprovalType(req.query.type);
      const status = parseApprovalStatus(req.query.status);
      res.status(200).json({ approvals: await listOrderApprovals(pool, req.auth!, type, status) });
    })
  );

  router.post(
    '/expiry-scan',
    requirePermission('orders.approve_extension'),
    asyncHandler(async (req, res) => {
      const limit = Number(req.body?.limit ?? 100);
      res.status(200).json({
        result: await runExpiryScan(
          pool,
          {
            limit: Number.isInteger(limit) ? limit : 100,
          },
          req.auth!
        ),
      });
    })
  );

  router.get(
    '/reconciliation',
    requirePermission('orders.approve_extension'),
    asyncHandler(async (_req, res) => {
      res.status(200).json({ rows: await reconcileReservations(pool) });
    })
  );

  router.post(
    '/price/:id/decision',
    requirePermission('orders.approve_price'),
    asyncHandler(async (req, res) => {
      res.status(200).json(
        await decidePriceApproval(pool, req.auth!, req.params.id, {
          decision: req.body?.decision,
          note: req.body?.note,
          expectedPlanVersion: req.body?.expectedPlanVersion,
          idempotencyKey: req.body?.idempotencyKey,
        })
      );
    })
  );

  router.post(
    '/extension/:id/decision',
    requirePermission('orders.approve_extension'),
    asyncHandler(async (req, res) => {
      res.status(200).json(
        await decideReservationExtension(pool, req.auth!, req.params.id, {
          decision: req.body?.decision,
          note: req.body?.note,
          expectedReservationVersion: req.body?.expectedReservationVersion,
          idempotencyKey: req.body?.idempotencyKey,
        })
      );
    })
  );

  router.post(
    '/release/:id/decision',
    requirePermission('orders.approve_release'),
    asyncHandler(async (req, res) => {
      res.status(200).json(
        await decideOrderRelease(pool, req.auth!, req.params.id, {
          decision: req.body?.decision,
          note: req.body?.note,
          expectedReservationVersion: req.body?.expectedReservationVersion,
          idempotencyKey: req.body?.idempotencyKey,
        })
      );
    })
  );

  // Must be declared after the static paths above.
  router.get(
    '/:type/:id',
    asyncHandler(async (req, res) => {
      const type = parseApprovalType(req.params.type);
      res.status(200).json({ approval: await getOrderApproval(pool, req.auth!, type, req.params.id) });
    })
  );

  return router;
}
