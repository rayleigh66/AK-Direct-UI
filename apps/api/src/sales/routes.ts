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
  acknowledgeSalesWrite,
  getCompanyForAuth,
  listCompaniesForAuth,
} from '../companies/service.js';

export function createSalesRouter(pool: DbPool, config: AuthConfig): Router {
  const router = Router();
  router.use(
    requireAuth(pool, config),
    requirePasswordChanged,
    requireUserType('internal'),
    // Sales writes require the double-submit CSRF check; GETs pass through.
    requireCsrfForUnsafeMethods(config.cookieSecure)
  );

  router.get(
    '/companies',
    asyncHandler(async (req, res) => {
      res.status(200).json({ companies: await listCompaniesForAuth(pool, req.auth!) });
    })
  );

  router.get(
    '/companies/:id',
    asyncHandler(async (req, res) => {
      res.status(200).json({ company: await getCompanyForAuth(pool, req.auth!, req.params.id) });
    })
  );

  router.post(
    '/companies/:id/acknowledge',
    requirePermission('sales.write'),
    asyncHandler(async (req, res) => {
      await acknowledgeSalesWrite(pool, req.auth!, req.params.id);
      res.status(200).json({ status: 'ok' });
    })
  );

  return router;
}
