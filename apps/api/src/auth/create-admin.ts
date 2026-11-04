import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadMigrationDatabaseUrl } from '../config/env.js';
import { hashPassword, validatePasswordPolicy } from './password.js';

const { Client } = pg;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}

async function readPassword(): Promise<string> {
  if (process.argv.includes('--password-stdin')) {
    return (await readStdin()).trim();
  }
  return (process.env.ADMIN_PASSWORD ?? '').trim();
}

async function main() {
  const email = (argValue('--email') ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const name = (argValue('--name') ?? process.env.ADMIN_NAME ?? '').trim();
  const password = await readPassword();
  const mustChange = !process.argv.includes('--no-must-change');
  const salesWriter = process.argv.includes('--sales-writer');

  if (!EMAIL.test(email)) throw new Error('Provide a valid --email.');
  if (!name) throw new Error('Provide a non-empty --name.');
  if (!password) {
    throw new Error('Provide a password via --password-stdin or ADMIN_PASSWORD.');
  }
  const policy = validatePasswordPolicy(password, email);
  if (!policy.valid) throw new Error(policy.error ?? 'Password is not strong enough.');

  const passwordHash = await hashPassword(password);
  const client = new Client({
    connectionString: loadMigrationDatabaseUrl(),
    connectionTimeoutMillis: 5_000,
    application_name: 'aoking-direct-create-admin',
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT 1 FROM internal_users WHERE email = $1', [email]);
    if (existing.rowCount !== 0) throw new Error(`Internal user ${email} already exists.`);
    const id = randomUUID();
    await client.query(
      `INSERT INTO internal_users
        (id, name, email, password_hash, must_change_password, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'active', now(), now())`,
      [id, name, email, passwordHash, mustChange]
    );
    const roles = ['admin', ...(salesWriter ? ['sales_writer'] : [])];
    for (const role of roles) {
      await client.query(
        'INSERT INTO internal_user_roles (internal_user_id, role_id) VALUES ($1, $2)',
        [id, role]
      );
    }
    await client.query(
      `INSERT INTO audit_logs
        (id, actor_type, actor_id, actor_label, action, target_type, target_id, details)
       VALUES ($1, 'system', NULL, 'bootstrap-cli', 'CREATE_INTERNAL_USER', 'internal_user', $2, $3)`,
      [randomUUID(), id, { email, roles, mustChange }]
    );
    await client.query('COMMIT');
    console.log(
      `Internal user created: ${email} (roles: ${roles.join(', ')}; mustChangePassword=${mustChange}).`
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Admin creation failed.');
  process.exitCode = 1;
});
