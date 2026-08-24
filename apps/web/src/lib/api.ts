import type {
  AuthResponse,
  LoginRequest,
  PublicTenant,
  PublicUser,
  RegisterRequest,
} from '@yenisey/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Ошибка, донёсшая до UI человекочитаемое сообщение от API. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    // NestJS отдаёт { message } строкой или массивом (когда ValidationPipe
    // собрал несколько нарушений) — приводим к одной строке для UI.
    const body: unknown = await response.json().catch(() => null);
    const raw = (body as { message?: string | string[] } | null)?.message;
    const message = Array.isArray(raw) ? raw.join('; ') : (raw ?? 'Ошибка запроса');

    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  /** Официальное название клуба по его коду. Открыто без авторизации. */
  tenant: (slug: string): Promise<PublicTenant> => request(`/tenants/${slug}`),

  register: (payload: RegisterRequest): Promise<AuthResponse> =>
    request('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),

  login: (payload: LoginRequest): Promise<AuthResponse> =>
    request('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),

  refresh: (refreshToken: string): Promise<AuthResponse> =>
    request('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) }),

  logout: (refreshToken: string): Promise<void> =>
    request('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),

  me: (accessToken: string): Promise<PublicUser> =>
    request('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } }),
};
