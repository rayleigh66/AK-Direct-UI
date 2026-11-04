import express, { type NextFunction, type Request, type Response } from 'express';
import type { DbPool } from './db/pool.js';
import type { AuthConfig } from './auth/types.js';
import type { ReadinessResult } from './db/readiness.js';
import { createAuthRouter } from './auth/routes.js';
import { createCompanyRouter } from './companies/routes.js';
import { createSalesRouter } from './sales/routes.js';
import { createAdminRouter } from './admin/routes.js';
import { HttpError } from './http/errors.js';

export interface AuthDependencies {
  pool: DbPool;
  config: AuthConfig;
}

export interface AppDependencies {
  checkReadiness: () => Promise<ReadinessResult>;
  auth?: AuthDependencies;
}

export function createApp({ checkReadiness, auth }: AppDependencies) {
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
