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

async function mutate<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const send = async (token: string) =>
    fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
      },
      body: JSON.stringify(body),
    });

  let response = await send(await fetchCsrf());
  if (response.status === 403) {
    const parsed = (await response.clone().json().catch(() => ({}))) as {
      error?: { code?: string };
    };
    if (parsed.error?.code === 'csrf_failed') {
      response = await send(await fetchCsrf(true));
    }
  }
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
