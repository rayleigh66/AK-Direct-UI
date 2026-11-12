import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthApiError,
  changePassword,
  getSession,
  login,
  resetCsrfForTests,
} from '../src/auth/api';

const user = {
  id: 'user-1',
  type: 'customer' as const,
  username: 'AK000123A',
  displayName: 'AK000123A',
  companyId: 'company-1',
  roles: ['customer'],
  permissions: ['customer.self'],
  mustChangePassword: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('React auth API client', () => {
  beforeEach(() => {
    resetCsrfForTests();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches a CSRF token before login and sends it with cookies', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ user }));

    await expect(login('AK000123A', 'Password123!')).resolves.toEqual(user);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/auth/csrf',
      expect.objectContaining({ credentials: 'include' })
    );
    const [, init] = fetchMock.mock.calls[1];
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-CSRF-Token': 'csrf-token',
        'Content-Type': 'application/json',
      },
    });
  });

  it('returns null for an unauthenticated session and throws typed API errors', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'authentication_required' } }, 401));
    await expect(getSession()).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'forbidden', message: 'Not allowed.' } }, 403)
    );
    await expect(
      getSession().catch(error => {
        expect(error).toBeInstanceOf(AuthApiError);
        expect(error.status).toBe(403);
        expect(error.code).toBe('forbidden');
        throw error;
      })
    ).rejects.toBeInstanceOf(AuthApiError);
  });

  it('refreshes CSRF once after a csrf_failed response', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'old-token' }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'csrf_failed' } }, 403))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'new-token' }))
      .mockResolvedValueOnce(jsonResponse({ user }));

    await expect(
      changePassword('Current123!', 'NewPassword123!')
    ).resolves.toEqual(user);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [, retryInit] = fetchMock.mock.calls[3];
    expect(retryInit?.headers).toMatchObject({ 'X-CSRF-Token': 'new-token' });
  });
});
