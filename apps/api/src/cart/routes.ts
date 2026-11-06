import { Router } from 'express';
import type { DbPool } from '../db/pool.js';
import { asyncHandler } from '../http/errors.js';
import { requireCsrfForUnsafeMethods } from '../http/csrf.js';
import {
  requireAuth,
  requirePasswordChanged,
  requireUserType,
} from '../auth/session.js';
import type { AuthConfig } from '../auth/types.js';
import { clearCart, getCart, removeCartItem, setCartItem } from './service.js';

export function createCartRouter(pool: DbPool, config: AuthConfig): Router {
  const router = Router();
  router.use(
    requireAuth(pool, config),
    requirePasswordChanged,
    requireUserType('customer'),
    requireCsrfForUnsafeMethods(config.cookieSecure)
  );
  // Company carts contain commercial data and must never be cached by a proxy.
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.status(200).json({ cart: await getCart(pool, req.auth!) });
    })
  );

  router.put(
    '/items/:skuId',
    asyncHandler(async (req, res) => {
      res.status(200).json({
        cart: await setCartItem(pool, req.auth!, req.params.skuId, {
          quantity: req.body?.quantity,
          expectedRevision: req.body?.expectedRevision,
        }),
      });
    })
  );

  router.delete(
    '/items/:skuId',
    asyncHandler(async (req, res) => {
      res.status(200).json({
        cart: await removeCartItem(
          pool,
          req.auth!,
          req.params.skuId,
          req.body?.expectedRevision
        ),
      });
    })
  );

  router.delete(
    '/items',
    asyncHandler(async (req, res) => {
      res.status(200).json({
        cart: await clearCart(pool, req.auth!, req.body?.expectedRevision),
      });
    })
  );

  return router;
}
