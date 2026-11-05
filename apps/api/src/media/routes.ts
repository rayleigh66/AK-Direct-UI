import { Router } from 'express';
import type { DbPool } from '../db/pool.js';
import { asyncHandler } from '../http/errors.js';
import { requireAuth, requirePasswordChanged } from '../auth/session.js';
import type { AuthConfig } from '../auth/types.js';
import { getMediaForAuth } from '../catalog/service.js';
import { readStoredImage } from './storage.js';

export function createMediaRouter(pool: DbPool, config: AuthConfig, mediaRoot: string): Router {
  const router = Router();
  router.use(requireAuth(pool, config), requirePasswordChanged);

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const media = await getMediaForAuth(pool, req.auth!, req.params.id);
      const buffer = await readStoredImage(mediaRoot, media.storageKey);
      res.setHeader('Content-Type', media.mimeType);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('Content-Disposition', 'inline');
      res.status(200).end(buffer);
    })
  );

  return router;
}
