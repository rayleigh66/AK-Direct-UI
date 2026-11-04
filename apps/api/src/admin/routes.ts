import { Router } from 'express';
import type { DbPool } from '../db/pool.js';
import { listAuditLogs } from '../audit/audit.js';
import { asyncHandler, HttpError } from '../http/errors.js';
import {
  requireAuth,
  requirePasswordChanged,
  requirePermission,
} from '../auth/session.js';
import type { AuthConfig } from '../auth/types.js';
import {
  createCompany,
  createSecondaryAccount,
  getCompanyForAuth,
  listAllCompanies,
  setBrandGrant,
  setCompanyStatus,
  setCustomerStatus,
  setSalesAssignment,
} from '../companies/service.js';

function stringValue(value: unknown, field: string, max = 320): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'invalid_request', `${field} is required.`);
  }
  if (value.length > max) throw new HttpError(400, 'invalid_request', `${field} is too long.`);
  return value.trim();
}

function optionalString(value: unknown, max = 320): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_request', 'Invalid text value.');
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, 'invalid_request', 'Text value is too long.');
  return trimmed || undefined;
}

function statusValue(value: unknown): 'active' | 'suspended' {
  if (value !== 'active' && value !== 'suspended') {
    throw new HttpError(400, 'invalid_status', 'Status must be active or suspended.');
  }
  return value;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new HttpError(400, 'invalid_request', `${field} must be a boolean.`);
  }
  return value;
}

function stringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new HttpError(400, 'invalid_request', 'brandIds must be an array of strings.');
  }
  return value as string[];
}

export function createAdminRouter(pool: DbPool, config: AuthConfig): Router {
  const router = Router();
  router.use(requireAuth(pool, config), requirePasswordChanged);

  router.get(
    '/companies',
    requirePermission('companies.manage'),
    asyncHandler(async (_req, res) => {
      res.status(200).json({ companies: await listAllCompanies(pool) });
    })
  );

  router.get(
    '/companies/:id',
    requirePermission('companies.manage'),
    asyncHandler(async (req, res) => {
      res.status(200).json({ company: await getCompanyForAuth(pool, req.auth!, req.params.id) });
    })
  );

  router.post(
    '/companies',
    requirePermission('companies.manage'),
    asyncHandler(async (req, res) => {
      const assignedSalesUserId = optionalString(req.body?.assignedSalesUserId, 64);
      const result = await createCompany(pool, req.auth!, {
        customerCode: stringValue(req.body?.customerCode, 'customerCode', 16),
        shortName: stringValue(req.body?.shortName, 'shortName', 200),
        countryAlpha3: stringValue(req.body?.countryAlpha3, 'countryAlpha3', 3),
        internalNickname: optionalString(req.body?.internalNickname, 200),
        assignedSalesUserId,
        brandIds: stringArray(req.body?.brandIds),
      });
      res.status(201).json(result);
    })
  );

  router.post(
    '/companies/:id/accounts',
    requirePermission('accounts.manage'),
    asyncHandler(async (req, res) => {
      res.status(201).json(await createSecondaryAccount(pool, req.auth!, req.params.id));
    })
  );

  router.patch(
    '/companies/:id/status',
    requirePermission('companies.manage'),
    asyncHandler(async (req, res) => {
      res.status(200).json({
        company: await setCompanyStatus(
          pool,
          req.auth!,
          req.params.id,
          statusValue(req.body?.status)
        ),
      });
    })
  );

  router.patch(
    '/customers/:id/status',
    requirePermission('accounts.manage'),
    asyncHandler(async (req, res) => {
      await setCustomerStatus(pool, req.auth!, req.params.id, statusValue(req.body?.status));
      res.status(200).json({ status: 'ok' });
    })
  );

  router.put(
    '/companies/:id/brands/:brandId',
    requirePermission('brands.manage'),
    asyncHandler(async (req, res) => {
      await setBrandGrant(
        pool,
        req.auth!,
        req.params.id,
        req.params.brandId,
        booleanValue(req.body?.granted, 'granted')
      );
      res.status(200).json({ status: 'ok' });
    })
  );

  router.patch(
    '/companies/:id/sales-assignment',
    requirePermission('companies.manage'),
    asyncHandler(async (req, res) => {
      const raw = req.body?.salesUserId;
      if (raw !== null && typeof raw !== 'string') {
        throw new HttpError(400, 'invalid_request', 'salesUserId must be a string or null.');
      }
      res.status(200).json({
        company: await setSalesAssignment(
          pool,
          req.auth!,
          req.params.id,
          raw === null ? null : raw.trim()
        ),
      });
    })
  );

  router.get(
    '/sales-users',
    requirePermission('companies.manage'),
    asyncHandler(async (_req, res) => {
      const result = await pool.query<{ id: string; name: string; email: string }>(
        `SELECT DISTINCT iu.id, iu.name, iu.email
         FROM internal_users iu
         JOIN internal_user_roles ur ON ur.internal_user_id = iu.id
         WHERE iu.status = 'active' AND ur.role_id = 'sales'
         ORDER BY iu.name`
      );
      res.status(200).json({ users: result.rows });
    })
  );

  router.get(
    '/audit-logs',
    requirePermission('audit.read'),
    asyncHandler(async (req, res) => {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
      const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
      const logs = await listAuditLogs(pool, limit, offset);
      res.status(200).json({ logs, limit, offset });
    })
  );

  return router;
}
