import { describe, expect, it } from 'vitest';
import { assertSafeTestDatabase } from '../support/testDatabaseSafety.js';

const validUrl = 'postgres://aoking_test:aoking_test_password@127.0.0.1:55433/aoking_direct_test';
const safeEnv = {
  NODE_ENV: 'test',
  TEST_DATABASE_DESTRUCTIVE: 'yes',
} as NodeJS.ProcessEnv;

describe('destructive test database safety', () => {
  it('accepts only the exact loopback test database identity', () => {
    expect(assertSafeTestDatabase(validUrl, safeEnv)).toMatchObject({
      databaseName: 'aoking_direct_test',
      username: 'aoking_test',
      host: '127.0.0.1',
      port: 55433,
    });
    expect(
      assertSafeTestDatabase(
        'postgres://aoking_test:pw@localhost:5432/aoking_direct_test',
        safeEnv
      ).host
    ).toBe('localhost');
  });

  it('rejects missing or unsafe environment authorization', () => {
    expect(() => assertSafeTestDatabase(undefined, safeEnv)).toThrow(/TEST_DATABASE_URL/);
    expect(() =>
      assertSafeTestDatabase(validUrl, { ...safeEnv, NODE_ENV: 'production' })
    ).toThrow(/NODE_ENV must be exactly "test"/);
    expect(() =>
      assertSafeTestDatabase(validUrl, { ...safeEnv, TEST_DATABASE_DESTRUCTIVE: 'no' })
    ).toThrow(/TEST_DATABASE_DESTRUCTIVE=yes/);
  });

  it('rejects non-loopback hosts before any connection', () => {
    for (const host of ['db.example.com', '10.0.0.5', '192.168.1.10', '0.0.0.0', '[::]']) {
      expect(() =>
        assertSafeTestDatabase(
          `postgres://aoking_test:pw@${host}:5432/aoking_direct_test`,
          safeEnv
        )
      ).toThrow(/loopback/);
    }
  });

  it('rejects wrong database names and wrong users', () => {
    expect(() =>
      assertSafeTestDatabase(
        'postgres://aoking_test:pw@127.0.0.1:5432/production',
        safeEnv
      )
    ).toThrow(/database must be exactly aoking_direct_test/);
    expect(() =>
      assertSafeTestDatabase(
        'postgres://aoking_test:pw@127.0.0.1:5432/aoking_direct_test_backup',
        safeEnv
      )
    ).toThrow(/database must be exactly aoking_direct_test/);
    expect(() =>
      assertSafeTestDatabase(
        'postgres://postgres:pw@127.0.0.1:5432/aoking_direct_test',
        safeEnv
      )
    ).toThrow(/user must be exactly aoking_test/);
    expect(() =>
      assertSafeTestDatabase(
        'postgres://aoking_test:pw@127.0.0.1:5432/aoking_direct_test',
        { ...safeEnv, TEST_DATABASE_DESTRUCTIVE: undefined }
      )
    ).toThrow(/TEST_DATABASE_DESTRUCTIVE=yes/);
  });

  it('rejects invalid protocols and malformed URLs', () => {
    expect(() => assertSafeTestDatabase('not-a-url', safeEnv)).toThrow(/valid URL/);
    expect(() =>
      assertSafeTestDatabase(
        'mysql://aoking_test:pw@127.0.0.1:3306/aoking_direct_test',
        safeEnv
      )
    ).toThrow(/postgres/);
  });
});
