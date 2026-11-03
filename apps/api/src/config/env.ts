export type NodeEnvironment = 'development' | 'test' | 'production';

export interface ApiEnv {
  nodeEnv: NodeEnvironment;
  port: number;
  databaseUrl: string;
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

  return {
    nodeEnv: rawNodeEnv as NodeEnvironment,
    port,
    databaseUrl,
  };
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
