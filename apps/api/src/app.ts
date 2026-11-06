import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { DbPool } from './db/pool.js';
import type { AuthConfig } from './auth/types.js';
import type { ReadinessResult } from './db/readiness.js';
import { createAuthRouter } from './auth/routes.js';
import { createCompanyRouter } from './companies/routes.js';
import { createSalesRouter } from './sales/routes.js';
import { createAdminRouter } from './admin/routes.js';
import { createAdminCatalogRouter, createCustomerCatalogRouter } from './catalog/routes.js';
import { createMediaRouter } from './media/routes.js';
import { createAdminInventoryRouter, createSalesInventoryRouter } from './inventory/routes.js';
import { createCartRouter } from './cart/routes.js';
import {
  createAdminOrderRouter,
  createCustomerOrderRouter,
  createSalesOrderRouter,
} from './orders/routes.js';
import { HttpError } from './http/errors.js';

export interface AuthDependencies {
  pool: DbPool;
  config: AuthConfig;
}

export interface AppDependencies {
  checkReadiness: () => Promise<ReadinessResult>;
  auth?: AuthDependencies;
  /** Directory where uploaded product images are stored. */
  mediaRoot?: string;
}

export function createApp({ checkReadiness, auth, mediaRoot }: AppDependencies) {
  const imageRoot = mediaRoot ?? path.resolve(process.cwd(), 'media');
  const app = express();
  app.disable('x-powered-by');
  if (auth) app.set('trust proxy', auth.config.trustProxy);
  app.use(express.json({ limit: '1mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'aoking-direct-api',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/ready', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await checkReadiness();
      const body = {
        status: result.ok ? 'ready' : 'not_ready',
        checks: result.checks,
        ...(result.error ? { error: result.error } : {}),
      };
      res.status(result.ok ? 200 : 503).json(body);
    } catch {
      next(new Error('readiness check failed'));
    }
  });

  if (auth) {
    app.use('/api/auth', createAuthRouter(auth.pool, auth.config));
    app.use('/api/companies', createCompanyRouter(auth.pool, auth.config));
    app.use('/api/catalog', createCustomerCatalogRouter(auth.pool, auth.config));
    app.use('/api/media', createMediaRouter(auth.pool, auth.config, imageRoot));
    // More specific admin/sales routers are mounted before the Phase 4B-02
    // routers; unmatched paths pass through to the next router.
    app.use('/api/admin/catalog', createAdminCatalogRouter(auth.pool, auth.config, imageRoot));
    app.use('/api/admin/orders', createAdminOrderRouter(auth.pool, auth.config));
    app.use('/api/admin', createAdminInventoryRouter(auth.pool, auth.config));
    app.use('/api/cart', createCartRouter(auth.pool, auth.config));
    app.use('/api/orders', createCustomerOrderRouter(auth.pool, auth.config));
    app.use('/api/sales/orders', createSalesOrderRouter(auth.pool, auth.config));
    app.use('/api/sales', createSalesInventoryRouter(auth.pool, auth.config));
    app.use('/api/sales', createSalesRouter(auth.pool, auth.config));
    app.use('/api/admin', createAdminRouter(auth.pool, auth.config));
  }

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: { code: 'not_found', message: 'Route not found.' },
    });
  });

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (
      error instanceof SyntaxError &&
      'status' in error &&
      (error as { status?: number }).status === 400
    ) {
      res.status(400).json({
        error: { code: 'invalid_json', message: 'Request body must be valid JSON.' },
      });
      return;
    }
    if (error instanceof HttpError) {
      if (error.retryAfterSeconds) {
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      res.status(error.status).json({
        error: { code: error.code, message: error.message },
        ...(error.details ?? {}),
      });
      return;
    }

    // Never return internal messages, stack traces or connection strings.
    console.error('Unhandled API error:', error instanceof Error ? error.name : 'unknown');
    res.status(500).json({
      error: { code: 'internal_error', message: 'Unexpected server error.' },
    });
  });

  return app;
}
