export interface AuthUserDto {
  id: string;
  type: 'customer' | 'internal';
  username: string;
  displayName: string;
  companyId?: string;
  companyCode?: string;
  companyName?: string;
  roles: string[];
  permissions: string[];
  mustChangePassword: boolean;
}

export class AuthApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let csrfToken: string | null = null;

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  } & T;
  if (!response.ok) {
    throw new AuthApiError(
      response.status,
      body.error?.code ?? 'request_failed',
      body.error?.message ?? 'The request failed.'
    );
  }
  return body;
}

async function fetchCsrf(force = false): Promise<string> {
  if (!csrfToken || force) {
    const response = await fetch('/api/auth/csrf', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const body = await readJson<{ csrfToken: string }>(response);
    csrfToken = body.csrfToken;
  }
  return csrfToken;
}

async function sendWithCsrf(
  method: string,
  path: string,
  build: (token: string) => RequestInit
): Promise<Response> {
  let response = await fetch(path, build(await fetchCsrf()));
  if (response.status === 403) {
    const parsed = (await response.clone().json().catch(() => ({}))) as {
      error?: { code?: string };
    };
    if (parsed.error?.code === 'csrf_failed') {
      response = await fetch(path, build(await fetchCsrf(true)));
    }
  }
  return response;
}

async function mutate<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await sendWithCsrf('POST', path, token => ({
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
    },
    body: JSON.stringify(body),
  }));
  return readJson<T>(response);
}

/** JSON request helper for authenticated business APIs (cookie + CSRF). */
export async function apiJson<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  if (method === 'GET') {
    const response = await fetch(path, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    return readJson<T>(response);
  }
  const response = await sendWithCsrf(method, path, token => ({
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return readJson<T>(response);
}

/** Raw image upload with the same CSRF handling. */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const response = await sendWithCsrf('POST', path, token => ({
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': file.type || 'application/octet-stream',
      'X-CSRF-Token': token,
    },
    body: file,
  }));
  return readJson<T>(response);
}

export async function getSession(): Promise<AuthUserDto | null> {
  const response = await fetch('/api/auth/session', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (response.status === 401) return null;
  const body = await readJson<{ user: AuthUserDto }>(response);
  return body.user;
}

export async function login(username: string, password: string): Promise<AuthUserDto> {
  const body = await mutate<{ user: AuthUserDto }>('/api/auth/login', { username, password });
  return body.user;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<AuthUserDto> {
  const body = await mutate<{ user: AuthUserDto }>('/api/auth/change-password', {
    currentPassword,
    newPassword,
  });
  return body.user;
}

export async function logout(): Promise<void> {
  await mutate<{ status: string }>('/api/auth/logout', {});
}

export function resetCsrfForTests(): void {
  csrfToken = null;
}
