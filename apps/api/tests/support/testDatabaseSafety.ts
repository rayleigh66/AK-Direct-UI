export interface SafeTestDatabase {
  databaseUrl: string;
  databaseName: string;
  username: string;
  host: string;
  port: number;
}

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const EXPECTED_DATABASE = 'aoking_direct_test';
const EXPECTED_USER = 'aoking_test';

/**
 * Fail closed before any connection or destructive SQL. The test database is
 * identified by exact database/user identity, loopback-only networking,
 * NODE_ENV=test and an explicit destructive-test opt-in. A name containing
 * "test" is not sufficient.
 */
export function assertSafeTestDatabase(
  databaseUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): SafeTestDatabase {
  if (!databaseUrl) {
    throw new Error('Refusing destructive test DB access: TEST_DATABASE_URL is required.');
  }
  if (env.NODE_ENV !== 'test') {
    throw new Error('Refusing destructive test DB access: NODE_ENV must be exactly "test".');
  }
  if (env.TEST_DATABASE_DESTRUCTIVE !== 'yes') {
    throw new Error(
      'Refusing destructive test DB access: set TEST_DATABASE_DESTRUCTIVE=yes explicitly.'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('Refusing destructive test DB access: TEST_DATABASE_URL is not a valid URL.');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(
      'Refusing destructive test DB access: TEST_DATABASE_URL must use postgres:// or postgresql://.'
    );
  }

  const host = parsed.hostname;
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(
      `Refusing destructive test DB access: host ${host} is not an allowed loopback address.`
    );
  }

  const databaseName = parsed.pathname.replace(/^\//, '');
  if (databaseName !== EXPECTED_DATABASE) {
    throw new Error(
      `Refusing destructive test DB access: database must be exactly ${EXPECTED_DATABASE}.`
    );
  }

  const username = decodeURIComponent(parsed.username);
  if (username !== EXPECTED_USER) {
    throw new Error(
      `Refusing destructive test DB access: user must be exactly ${EXPECTED_USER}.`
    );
  }

  const port = Number(parsed.port || '5432');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Refusing destructive test DB access: invalid PostgreSQL port.');
  }

  return {
    databaseUrl,
    databaseName,
    username,
    host,
    port,
  };
}
