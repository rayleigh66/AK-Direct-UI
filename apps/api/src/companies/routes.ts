import { Router } from 'express';
import type { DbPool } from '../db/pool.js';
import { asyncHandler } from '../http/errors.js';
import { requireAuth, requirePasswordChanged } from '../auth/session.js';
import type { AuthConfig } from '../auth/types.js';
import { getCompanyForAuth, listCompaniesForAuth } from './service.js';

export function createCompanyRouter(pool: DbPool, config: AuthConfig): Router {
  const router = Router();
  router.use(requireAuth(pool, config), requirePasswordChanged);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.status(200).json({ companies: await listCompaniesForAuth(pool, req.auth!) });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.status(200).json({ company: await getCompanyForAuth(pool, req.auth!, req.params.id) });
    })
  );

  return router;
}
