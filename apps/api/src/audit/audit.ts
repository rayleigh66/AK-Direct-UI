import { randomUUID } from 'node:crypto';
import type { DbPool } from '../db/pool.js';
import type { UserType } from '../auth/types.js';

export interface AuditInput {
  actorType: UserType | 'system';
  actorId?: string;
  actorLabel: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}

// Accept a pool or a transaction client so an audit row can share the
// transaction of the change it records.
export type AuditSink = Pick<DbPool, 'query'>;

export async function writeAudit(pool: AuditSink, input: AuditInput): Promise<void> {
  await pool.query(
    `INSERT INTO audit_logs
      (id, actor_type, actor_id, actor_label, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      input.actorType,
      input.actorId ?? null,
      input.actorLabel,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      input.details ?? {},
    ]
  );
}

export interface AuditLogRow {
  id: string;
  actor_type: string;
  actor_id: string | null;
  actor_label: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: Date;
}

export async function listAuditLogs(
  pool: DbPool,
  limit: number,
  offset: number
): Promise<AuditLogRow[]> {
  const result = await pool.query<AuditLogRow>(
    `SELECT id, actor_type, actor_id, actor_label, action, target_type, target_id, details, created_at
     FROM audit_logs
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows;
}
