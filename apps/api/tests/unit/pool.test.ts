import { describe, expect, it, vi } from 'vitest';
import { createPool } from '../../src/db/pool.js';

describe('PostgreSQL pool', () => {
  it('handles idle client errors without crashing the process', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = createPool('postgres://user:password@127.0.0.1:1/aoking_test');

    expect(() => pool.emit('error', new Error('idle client error'))).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();

    await pool.end();
    errorSpy.mockRestore();
  });
});
