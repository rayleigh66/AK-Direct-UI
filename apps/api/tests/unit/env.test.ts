import { describe, expect, it } from 'vitest';
import { loadEnv, redactDatabaseUrl } from '../../src/config/env.js';

const valid = {
  NODE_ENV: 'test',
  PORT: '4000',
  DATABASE_URL: 'postgres://aoking:secret@localhost:5432/aoking_direct_test',
} as NodeJS.ProcessEnv;

describe('API environment validation', () => {
  it('loads a valid environment and defaults the port', () => {
    const parsed = loadEnv({ ...valid, PORT: undefined });
    expect(parsed.nodeEnv).toBe('test');
    expect(parsed.port).toBe(4000);
    expect(parsed.databaseUrl).toContain('aoking_direct_test');
  });

  it('rejects missing or invalid database configuration without echoing it', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: undefined })).toThrow(/DATABASE_URL is required/);
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'not-a-url' })).toThrow(/valid URL/);
    expect(() =>
      loadEnv({ ...valid, DATABASE_URL: 'mysql://user:secret@localhost/db' })
    ).toThrow(/postgres/);
    expect(() => loadEnv({ ...valid, PORT: '0' })).toThrow(/PORT/);
    expect(() => loadEnv({ ...valid, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadEnv({ ...valid, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('validates the configurable order-number time zone', () => {
    expect(loadEnv(valid).orderNumberTimeZone).toBe('UTC');
    expect(
      loadEnv({ ...valid, ORDER_NUMBER_TIME_ZONE: 'Asia/Shanghai' }).orderNumberTimeZone
    ).toBe('Asia/Shanghai');
    expect(() =>
      loadEnv({ ...valid, ORDER_NUMBER_TIME_ZONE: 'Not/AZone' })
    ).toThrow(/ORDER_NUMBER_TIME_ZONE/);
  });

  it('redacts database credentials for safe logging', () => {
    const redacted = redactDatabaseUrl(valid.DATABASE_URL!);
    expect(redacted).not.toContain('secret');
    expect(redacted).toContain('***');
  });
});
