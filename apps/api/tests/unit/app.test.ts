import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';

describe('API health and readiness', () => {
  it('health does not depend on the database', async () => {
    const checkReadiness = vi.fn(async () => {
      throw new Error('database should not be called');
    });
    const app = createApp({ checkReadiness });

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'aoking-direct-api',
    });
    expect(checkReadiness).not.toHaveBeenCalled();
  });

  it('ready returns 200 when the database and migrations are ready', async () => {
    const app = createApp({
      checkReadiness: async () => ({
        ok: true,
        checks: { database: 'ok', migrations: 'ok' },
      }),
    });

    const response = await request(app).get('/api/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ready',
      checks: { database: 'ok', migrations: 'ok' },
    });
  });

  it('ready returns 503 when the database is unavailable', async () => {
    const app = createApp({
      checkReadiness: async () => ({
        ok: false,
        checks: { database: 'unavailable' },
        error: 'database_unavailable',
      }),
    });

    const response = await request(app).get('/api/ready');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: 'not_ready',
      error: 'database_unavailable',
    });
  });

  it('does not expose internal readiness errors', async () => {
    const app = createApp({
      checkReadiness: async () => {
        throw new Error('postgres://user:secret@db/internal');
      },
    });

    const response = await request(app).get('/api/ready');

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('secret');
    expect(JSON.stringify(response.body)).not.toContain('postgres://');
  });

  it('returns JSON for unknown routes', async () => {
    const app = createApp({
      checkReadiness: async () => ({ ok: true, checks: {} }),
    });

    const response = await request(app).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });
});
