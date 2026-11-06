import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import request, { type Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, verifyPassword } from '../../src/auth/password.js';
import type { AuthConfig, UserType } from '../../src/auth/types.js';
import { runMigrations } from '../../src/db/migrate.js';
import { provisionRuntimeRole } from '../../src/db/provision-runtime-role.js';
import { assertSafeTestDatabase } from '../support/testDatabaseSafety.js';

const safe = process.env.TEST_DATABASE_URL ? assertSafeTestDatabase(process.env.TEST_DATABASE_URL) : null;
const describeDb = safe ? describe : describe.skip;
const OLD = 'OriginalPassword123!';
const NEXT_A = 'ReplacementAlpha123!';
const NEXT_B = 'ReplacementBravo123!';
const config: AuthConfig = {
  cookieSecure: false, customerSessionIdleHours: 24, customerSessionAbsoluteDays: 30,
  internalSessionIdleHours: 2, internalSessionAbsoluteHours: 12,
  loginMaxAttempts: 5, loginWindowMinutes: 15, loginLockMinutes: 15,
  trustProxy: false, orderNumberTimeZone: 'UTC',
};
const APP_A = 'issue12-request-a';
const APP_B = 'issue12-request-b';
const role = `aoking_runtime_password_${process.pid}`;
let owner: pg.Pool;
let poolA: pg.Pool;
let poolB: pg.Pool;
let appA: ReturnType<typeof createApp>;
let appB: ReturnType<typeof createApp>;
let sequence = 600000;
let initialHash: string;

type Agent = ReturnType<typeof request.agent>;
interface Session { agent: Agent; csrf: string; cookie: string }
interface Principal { type: UserType; id: string; companyId?: string; username: string; a: Session; b: Session }
const table = (p: Principal) => p.type === 'customer' ? 'customer_users' : 'internal_users';
const sessionColumn = (p: Principal) => p.type === 'customer' ? 'customer_user_id' : 'internal_user_id';

async function signIn(agent: Agent, username: string): Promise<Session> {
  const token = (await agent.get('/api/auth/csrf')).body.csrfToken as string;
  const response = await agent.post('/api/auth/login').set('X-CSRF-Token', token).send({ username, password: OLD });
  expect(response.status).toBe(200);
  const cookie = (response.headers['set-cookie'] as unknown as string[]).find(x => x.startsWith('aoking_session='))!.split(';')[0];
  return { agent, csrf: token, cookie };
}
async function principal(type: UserType, mustChange = false): Promise<Principal> {
  sequence += 1;
  const id = randomUUID();
  let companyId: string | undefined;
  const username = type === 'customer' ? `AK${sequence}A` : `race${sequence}@example.test`;
  if (type === 'customer') {
    companyId = randomUUID();
    await owner.query(`INSERT INTO customer_companies (id, customer_code, short_name, country_alpha3)
      VALUES ($1, $2, 'Race fixture', 'USA')`, [companyId, `C${sequence}`]);
    await owner.query(`INSERT INTO customer_users
      (id, company_id, username, account_letter, password_hash, must_change_password)
      VALUES ($1, $2, $3, 'A', $4, $5)`, [id, companyId, username, initialHash, mustChange]);
  } else {
    await owner.query(`INSERT INTO internal_users (id, name, email, password_hash, must_change_password)
      VALUES ($1, 'Race fixture', $2, $3, $4)`, [id, username, initialHash, mustChange]);
    await owner.query("INSERT INTO internal_user_roles VALUES ($1, 'sales')", [id]);
  }
  return { type, id, companyId, username,
    a: await signIn(request.agent(appA), username), b: await signIn(request.agent(appB), username) };
}
function change(session: Session, password: string) {
  return session.agent.post('/api/auth/change-password').set('X-CSRF-Token', session.csrf)
    .send({ currentPassword: OLD, newPassword: password }).then(response => response);
}
function loginAgain(p: Principal) {
  return p.a.agent.post('/api/auth/login').set('X-CSRF-Token', p.a.csrf)
    .send({ username: p.username, password: OLD }).then(response => response);
}
async function activeCount(p: Principal): Promise<number> {
  const rows = await owner.query<{ count: string }>(`SELECT count(*)::text AS count FROM auth_sessions
    WHERE ${sessionColumn(p)} = $1 AND revoked_at IS NULL
    AND idle_expires_at > clock_timestamp() AND absolute_expires_at > clock_timestamp()`, [p.id]);
  return Number(rows.rows[0].count);
}
async function userState(p: Principal) {
  return (await owner.query(`SELECT password_hash, must_change_password, password_changed_at, last_login_at
    FROM ${table(p)} WHERE id = $1`, [p.id])).rows[0];
}
async function auditCount(p: Principal, action: string): Promise<number> {
  return Number((await owner.query<{ count: string }>('SELECT count(*)::text AS count FROM audit_logs WHERE actor_id=$1 AND action=$2', [p.id, action])).rows[0].count);
}
async function until(check: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`PostgreSQL scheduling barrier not reached: ${message}`);
}
async function holdGate(key: number) {
  const client = await owner.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(12012, $1)', [key]);
  const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let released = false;
  return { pid, release: async () => { if (!released) { released = true; await client.query('COMMIT'); client.release(); } } };
}
async function blockedPid(appName: string, blocker: number): Promise<number | undefined> {
  return (await owner.query<{ pid: number }>(`SELECT pid FROM pg_stat_activity
    WHERE application_name=$1 AND $2 = ANY(pg_blocking_pids(pid))`, [appName, blocker])).rows[0]?.pid;
}
async function waitBlocked(appName: string, blocker: number): Promise<number> {
  let pid: number | undefined;
  await until(async () => { pid = await blockedPid(appName, blocker); return !!pid; }, `${appName} blocked by ${blocker}`);
  return pid!;
}
// The second operation either commits on the vulnerable autocommit path, or
// waits on the first account/company row on the repaired transactional path.
async function doneOrSerialized(done: () => boolean, firstPid: number) {
  await until(async () => done() || !!(await blockedPid(APP_B, firstPid)), 'second operation completed or row-serialized');
}
async function suspend(p: Principal, company = false): Promise<void> {
  const client = await poolB.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE ${company ? 'customer_companies' : table(p)} SET status='suspended' WHERE id=$1`, [company ? p.companyId : p.id]);
    await client.query(`UPDATE auth_sessions SET revoked_at=now() WHERE ${company ? 'company_id' : sessionColumn(p)}=$1 AND revoked_at IS NULL`, [company ? p.companyId : p.id]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

describeDb('password and session atomicity with independent PostgreSQL transactions', () => {
  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: safe!.databaseUrl });
    await owner.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await runMigrations(safe!.databaseUrl);
    await provisionRuntimeRole({ adminDatabaseUrl: safe!.databaseUrl, runtimeUser: role, runtimePassword: 'RaceRuntimePassword123!' });
    const url = new URL(safe!.databaseUrl); url.username = role; url.password = 'RaceRuntimePassword123!';
    poolA = new pg.Pool({ connectionString: url.toString(), application_name: APP_A, max: 4 });
    poolB = new pg.Pool({ connectionString: url.toString(), application_name: APP_B, max: 4 });
    appA = createApp({ checkReadiness: async () => ({ ok: true }), auth: { pool: poolA, config } });
    appB = createApp({ checkReadiness: async () => ({ ok: true }), auth: { pool: poolB, config } });
    initialHash = await hashPassword(OLD);
    // Test-only DB scheduling/fault injection. Every HTTP handler, hash operation,
    // session write, audit write and query result remains real production code.
    await owner.query(`CREATE TABLE issue12_faults (stage text);
      GRANT SELECT ON issue12_faults TO "${role}";
      CREATE FUNCTION issue12_password_gate() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('application_name') = '${APP_A}' AND NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
          PERFORM pg_advisory_xact_lock(12012, 1);
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER issue12_customer_password BEFORE UPDATE ON customer_users FOR EACH ROW EXECUTE FUNCTION issue12_password_gate();
      CREATE TRIGGER issue12_internal_password BEFORE UPDATE ON internal_users FOR EACH ROW EXECUTE FUNCTION issue12_password_gate();
      CREATE FUNCTION issue12_session_gate() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('application_name') = '${APP_A}' THEN
          IF TG_OP = 'INSERT' THEN
            IF EXISTS (SELECT 1 FROM issue12_faults WHERE stage='session') THEN RAISE EXCEPTION 'issue12 injected session failure'; END IF;
            PERFORM pg_advisory_xact_lock(12012, 2);
          ELSIF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at AND NEW.revoked_at IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM issue12_faults WHERE stage='revoke') THEN RAISE EXCEPTION 'issue12 injected revoke failure'; END IF;
          END IF;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER issue12_session BEFORE INSERT OR UPDATE ON auth_sessions FOR EACH ROW EXECUTE FUNCTION issue12_session_gate();
      CREATE FUNCTION issue12_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('application_name') = '${APP_A}' AND NEW.action IN ('PASSWORD_CHANGED','LOGIN_SUCCESS')
          AND EXISTS (SELECT 1 FROM issue12_faults WHERE stage='audit') THEN RAISE EXCEPTION 'issue12 injected audit failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER issue12_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION issue12_audit_failure();`);
    await expect(poolA.query('CREATE TABLE issue12_forbidden (id int)')).rejects.toThrow(/permission denied/i);
  }, 60_000);
  afterEach(async () => { await owner.query('DELETE FROM issue12_faults'); });
  afterAll(async () => {
    if (!safe) return;
    await poolA?.end(); await poolB?.end();
    await owner.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    if ((await owner.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
      await owner.query(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`);
    }
    await owner.end();
  });

  for (const type of ['customer', 'internal'] as const) {
    it(`${type}: two changes sharing the old password have one winner and one live replacement session`, async () => {
      const p = await principal(type);
      const updateGate = await holdGate(1);
      const insertGate = await holdGate(2);
      let a: Promise<Response> | undefined; let b: Promise<Response> | undefined;
      try {
        a = change(p.a, NEXT_A);
        const pidA = await waitBlocked(APP_A, updateGate.pid);
        let bDone = false;
        b = change(p.b, NEXT_B).then(r => { bDone = true; return r; });
        await waitBlocked(APP_B, pidA); // B verified the old hash, or waits on its serialized read.
        await updateGate.release();
        await waitBlocked(APP_A, insertGate.pid);
        await doneOrSerialized(() => bDone, pidA);
        await insertGate.release();
        const [ra, rb] = await Promise.all([a, b]);
        const state = await userState(p);
        const proof = {
          statuses: [ra.status, rb.status], activeSessions: await activeCount(p),
          passwordA: await verifyPassword(NEXT_A, state.password_hash),
          passwordB: await verifyPassword(NEXT_B, state.password_hash),
          sessionA: (await p.a.agent.get('/api/auth/session')).status,
          sessionB: (await p.b.agent.get('/api/auth/session')).status,
          audits: await auditCount(p, 'PASSWORD_CHANGED'),
        };
        expect(proof).toEqual({ statuses: [200, 401], activeSessions: 1, passwordA: true, passwordB: false, sessionA: 200, sessionB: 401, audits: 1 });
        expect((await request(appA).get('/api/auth/session').set('Cookie', p.a.cookie)).status).toBe(401);
      } finally {
        await updateGate.release(); await insertGate.release();
        await Promise.allSettled([a, b].filter(Boolean));
      }
    });

    it(`${type}: a login verified before a password change cannot mint a late surviving session`, async () => {
      const p = await principal(type);
      const gate = await holdGate(2);
      let a: Promise<Response> | undefined; let b: Promise<Response> | undefined;
      try {
        a = loginAgain(p);
        const pidA = await waitBlocked(APP_A, gate.pid);
        let done = false; b = change(p.b, NEXT_B).then(r => { done = true; return r; });
        await doneOrSerialized(() => done, pidA);
        await gate.release();
        expect((await a).status).toBe(200); expect((await b).status).toBe(200);
        const count = await activeCount(p);
        const lateSession = (await p.a.agent.get('/api/auth/session')).status;
        expect({ activeSessions: count, lateSession }).toEqual({ activeSessions: 1, lateSession: 401 });
        expect((await p.b.agent.get('/api/auth/session')).status).toBe(200);
      } finally { await gate.release(); await Promise.allSettled([a, b].filter(Boolean)); }
    });

    for (const operation of ['login', 'change'] as const) {
      for (const company of type === 'customer' ? [false, true] : [false]) {
        it(`${type}: ${operation} issuance serializes with ${company ? 'company' : 'account'} suspension`, async () => {
          const p = await principal(type);
          const gate = await holdGate(2);
          let issuance: Promise<Response> | undefined; let suspension: Promise<void> | undefined;
          try {
            issuance = operation === 'login' ? loginAgain(p) : change(p.a, NEXT_A);
            const pidA = await waitBlocked(APP_A, gate.pid);
            let done = false; suspension = suspend(p, company).then(() => { done = true; });
            await doneOrSerialized(() => done, pidA);
            await gate.release();
            expect((await issuance).status).toBe(200); await suspension;
            // Check before findSession() can lazily revoke an inactive session.
            const count = await activeCount(p);
            await owner.query(`UPDATE ${company ? 'customer_companies' : table(p)} SET status='active' WHERE id=$1`, [company ? p.companyId : p.id]);
            const revivedSession = (await p.a.agent.get('/api/auth/session')).status;
            expect({ activeSessionsAfterSuspend: count, revivedSession }).toEqual({ activeSessionsAfterSuspend: 0, revivedSession: 401 });
          } finally { await gate.release(); await Promise.allSettled([issuance, suspension].filter(Boolean)); }
        });
      }
    }

    for (const company of type === 'customer' ? [false, true] : [false]) {
      it(`${type}: a suspension that wins the row lock rejects an already-verified login (${company ? 'company' : 'account'})`, async () => {
        const p = await principal(type);
        const client = await poolB.connect();
        let issuance: Promise<Response> | undefined;
        try {
          await client.query('BEGIN');
          const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          await client.query(`UPDATE ${company ? 'customer_companies' : table(p)} SET status='suspended' WHERE id=$1`, [company ? p.companyId : p.id]);
          await client.query(`UPDATE auth_sessions SET revoked_at=now() WHERE ${company ? 'company_id' : sessionColumn(p)}=$1 AND revoked_at IS NULL`, [company ? p.companyId : p.id]);
          let done = false;
          issuance = loginAgain(p).then(r => { done = true; return r; });
          await until(async () => done || !!(await blockedPid(APP_A, pid)), 'login finishes or waits on suspension');
          await client.query('COMMIT');
          const response = await issuance;
          expect({ status: response.status, sessions: await activeCount(p), audits: await auditCount(p, 'LOGIN_SUCCESS') })
            .toEqual({ status: 401, sessions: 0, audits: 2 });
        } finally { await client.query('ROLLBACK'); client.release(); if (issuance) await issuance; }
      });
    }

    it(`${type}: password replacement winning the row lock rejects a late old-password login`, async () => {
      const p = await principal(type);
      const replacementHash = await hashPassword(NEXT_B);
      const client = await poolB.connect();
      let pending: Promise<Response> | undefined;
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE ${table(p)} SET password_hash=$2 WHERE id=$1`, [p.id, replacementHash]);
        await client.query(`UPDATE auth_sessions SET revoked_at=now() WHERE ${sessionColumn(p)}=$1 AND revoked_at IS NULL`, [p.id]);
        const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        pending = loginAgain(p);
        await waitBlocked(APP_A, pid);
        await client.query('COMMIT');
        const response = await pending;
        expect({ status: response.status, sessions: await activeCount(p), audits: await auditCount(p, 'LOGIN_SUCCESS') })
          .toEqual({ status: 401, sessions: 0, audits: 2 });
        expect(await verifyPassword(NEXT_B, (await userState(p)).password_hash)).toBe(true);
      } finally { await client.query('ROLLBACK'); client.release(); if (pending) await pending; }
    });

    for (const invalidation of ['revoked_at', 'idle_expires_at', 'absolute_expires_at'] as const) {
    it(`${type}: ${invalidation} after middleware authentication prevents a queued password change`, async () => {
      const p = await principal(type);
      const client = await poolB.connect();
      let pending: Promise<Response> | undefined;
      try {
        await client.query('BEGIN');
        await client.query(`SELECT id FROM ${table(p)} WHERE id=$1 FOR UPDATE`, [p.id]);
        const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        pending = change(p.a, NEXT_A);
        await waitBlocked(APP_A, pid);
        const hash = createHash('sha256').update(p.a.cookie.split('=')[1]).digest('hex');
        await owner.query(`UPDATE auth_sessions SET ${invalidation} = ${invalidation === 'revoked_at' ? 'now()' : "now() - interval '1 second'"} WHERE token_hash=$1`, [hash]);
        await client.query('COMMIT');
        const response = await pending;
        expect({ status: response.status, unchanged: (await userState(p)).password_hash === initialHash,
          sessions: await activeCount(p), audits: await auditCount(p, 'PASSWORD_CHANGED')
        }).toEqual({ status: 401, unchanged: true, sessions: 1, audits: 0 });
      } finally { await client.query('ROLLBACK'); client.release(); if (pending) await pending; }
    });
    }

    for (const stage of ['revoke', 'session', 'audit']) {
      it(`${type}: failed password change at ${stage} rolls back password, forced-change flag, sessions and audit`, async () => {
        const p = await principal(type, true);
        const before = await userState(p);
        await owner.query('INSERT INTO issue12_faults VALUES ($1)', [stage]);
        const response = await change(p.a, NEXT_A);
        expect(response.status).toBe(500);
        const after = await userState(p);
        expect({ passwordUnchanged: after.password_hash === before.password_hash,
          mustChange: after.must_change_password, changedAt: after.password_changed_at,
          activeSessions: await activeCount(p), audits: await auditCount(p, 'PASSWORD_CHANGED')
        }).toEqual({ passwordUnchanged: true, mustChange: true, changedAt: null, activeSessions: 2, audits: 0 });
        expect((response.headers['set-cookie'] as unknown as string[] | undefined ?? []).some(cookie => cookie.startsWith('aoking_session='))).toBe(false);
      });
    }
    for (const stage of ['session', 'audit']) {
      it(`${type}: failed login at ${stage} does not commit a session, login timestamp or success audit`, async () => {
        const p = await principal(type);
        const before = await userState(p); const audits = await auditCount(p, 'LOGIN_SUCCESS');
        await owner.query('INSERT INTO issue12_faults VALUES ($1)', [stage]);
        const response = await loginAgain(p);
        expect(response.status).toBe(500);
        expect((await userState(p)).last_login_at).toEqual(before.last_login_at);
        expect(await activeCount(p)).toBe(2);
        expect(await auditCount(p, 'LOGIN_SUCCESS')).toBe(audits);
        expect((response.headers['set-cookie'] as unknown as string[] | undefined ?? []).some(cookie => cookie.startsWith('aoking_session='))).toBe(false);
      });
    }
    it(`${type}: successful forced change retains CSRF, RBAC, expiry and secret-safe audit`, async () => {
      const p = await principal(type, true);
      const blocked = await p.a.agent.get('/api/companies');
      expect(blocked.status).toBe(403);
      expect((await p.a.agent.post('/api/auth/change-password').send({ currentPassword: OLD, newPassword: NEXT_A })).status).toBe(403);
      const changed = await change(p.a, NEXT_A);
      expect(changed.status).toBe(200); expect(changed.body.user.mustChangePassword).toBe(false);
      expect((await p.a.agent.get('/api/admin/orders')).status).toBe(403);
      expect((await p.a.agent.get('/api/companies')).status).toBe(200);
      expect((await p.b.agent.get('/api/auth/session')).status).toBe(401);
      const rows = await owner.query(`SELECT token_hash, idle_expires_at, absolute_expires_at FROM auth_sessions
        WHERE ${sessionColumn(p)}=$1 AND revoked_at IS NULL`, [p.id]);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
      const absoluteHours = type === 'customer' ? 720 : 12;
      expect(rows.rows[0].absolute_expires_at.getTime() - Date.now()).toBeGreaterThan((absoluteHours - 1) * 3600000);
      expect(rows.rows[0].idle_expires_at.getTime()).toBeLessThanOrEqual(rows.rows[0].absolute_expires_at.getTime());
      const audit = await owner.query('SELECT details FROM audit_logs WHERE actor_id=$1 AND action=$2', [p.id, 'PASSWORD_CHANGED']);
      expect(audit.rows).toEqual([{ details: {} }]);
      expect(JSON.stringify(changed.body)).not.toContain(NEXT_A);
      expect((await userState(p)).password_hash).toMatch(/^scrypt\$/);
    });
  }
});
