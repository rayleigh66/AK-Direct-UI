import path from 'node:path';

export type NodeEnvironment = 'development' | 'test' | 'production';

export interface ApiEnv {
  nodeEnv: NodeEnvironment;
  port: number;
  databaseUrl: string;
  cookieSecure: boolean;
  customerSessionIdleHours: number;
  customerSessionAbsoluteDays: number;
  internalSessionIdleHours: number;
  internalSessionAbsoluteHours: number;
  loginMaxAttempts: number;
  loginWindowMinutes: number;
  loginLockMinutes: number;
  trustProxy: boolean | number;
  mediaRoot: string;
  /** IANA time zone used to derive the YYMMDD part of a business order number. */
  orderNumberTimeZone: string;
}

const NODE_ENVIRONMENTS: NodeEnvironment[] = ['development', 'test', 'production'];

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const rawNodeEnv = source.NODE_ENV ?? 'development';
  if (!NODE_ENVIRONMENTS.includes(rawNodeEnv as NodeEnvironment)) {
    throw new Error('NODE_ENV must be one of development, test or production.');
  }

  const rawPort = source.PORT ?? '4000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const databaseUrl = source.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid URL.');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use the postgres:// or postgresql:// protocol.');
  }
  if (!parsed.hostname || parsed.pathname === '' || parsed.pathname === '/') {
    throw new Error('DATABASE_URL must include a host and database name.');
  }

  const positiveNumber = (name: string, fallback: number, max: number): number => {
    const raw = source[name] ?? String(fallback);
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > max) {
      throw new Error(`${name} must be a number greater than 0 and at most ${max}.`);
    }
    return value;
  };
  const booleanValue = (name: string, fallback: boolean): boolean => {
    const raw = (source[name] ?? String(fallback)).trim().toLowerCase();
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    throw new Error(`${name} must be true or false.`);
  };

  const trustProxyRaw = (source.TRUST_PROXY ?? 'false').trim().toLowerCase();
  let trustProxy: boolean | number;
  if (trustProxyRaw === 'true') trustProxy = true;
  else if (trustProxyRaw === 'false' || trustProxyRaw === '') trustProxy = false;
  else {
    const hops = Number(trustProxyRaw);
    if (!Number.isInteger(hops) || hops < 0 || hops > 10) {
      throw new Error('TRUST_PROXY must be true, false, or an integer from 0 to 10.');
    }
    trustProxy = hops;
  }

  const orderNumberTimeZone = (source.ORDER_NUMBER_TIME_ZONE ?? 'UTC').trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: orderNumberTimeZone });
  } catch {
    throw new Error('ORDER_NUMBER_TIME_ZONE must be a valid IANA time zone (for example UTC).');
  }

  return {
    nodeEnv: rawNodeEnv as NodeEnvironment,
    port,
    databaseUrl,
    cookieSecure: booleanValue('COOKIE_SECURE', rawNodeEnv === 'production'),
    customerSessionIdleHours: positiveNumber('CUSTOMER_SESSION_IDLE_HOURS', 24, 24 * 30),
    customerSessionAbsoluteDays: positiveNumber('CUSTOMER_SESSION_ABSOLUTE_DAYS', 30, 365),
    internalSessionIdleHours: positiveNumber('INTERNAL_SESSION_IDLE_HOURS', 2, 24),
    internalSessionAbsoluteHours: positiveNumber('INTERNAL_SESSION_ABSOLUTE_HOURS', 12, 24 * 30),
    loginMaxAttempts: positiveNumber('LOGIN_MAX_ATTEMPTS', 5, 100),
    loginWindowMinutes: positiveNumber('LOGIN_WINDOW_MINUTES', 15, 24 * 60),
    loginLockMinutes: positiveNumber('LOGIN_LOCK_MINUTES', 15, 24 * 60),
    trustProxy,
    mediaRoot: path.resolve((source.MEDIA_ROOT ?? './media').trim() || './media'),
    orderNumberTimeZone,
  };
}

/** Migrations and runtime-role provisioning use the privileged database URL. */
export function loadMigrationDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  const databaseUrl = (source.MIGRATION_DATABASE_URL ?? source.DATABASE_URL)?.trim();
  if (!databaseUrl) {
    throw new Error('MIGRATION_DATABASE_URL (or DATABASE_URL) is required.');
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('MIGRATION_DATABASE_URL must be a valid URL.');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('MIGRATION_DATABASE_URL must use the postgres:// or postgresql:// protocol.');
  }
  if (!parsed.hostname || parsed.pathname === '' || parsed.pathname === '/') {
    throw new Error('MIGRATION_DATABASE_URL must include a host and database name.');
  }
  return databaseUrl;
}

/** Safe for logs; never include credentials. */
export function redactDatabaseUrl(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '[invalid database url]';
  }
}
