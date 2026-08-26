import type {
  AuthResponse,
  ClosureRule,
  ClosureRuleDraft,
  ClubCoach,
  ClubPeoplePage,
  ClubPeopleQuery,
  ClubSettings,
  ClubTable,
  CreateHallRequest,
  DayClosureDraft,
  DaySchedule,
  Hall,
  LoginRequest,
  PublicTenant,
  PublicUser,
  RegisterRequest,
  UpdateClubSettingsRequest,
  UpdateHallRequest,
} from '@yenisey/types';
import { clearSession, readAccessToken, saveSession } from './session';

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
    // Без этого браузер не приложит httpOnly-куку с refresh-токеном: веб и API
    // живут на разных портах, а значит запрос кросс-доменный. Ответная кука по
    // той же причине не сохранилась бы, и обновление сессии молча ломается.
    credentials: 'include',
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

/**
 * Запрос от имени вошедшего пользователя.
 *
 * Access-токен живёт 15 минут и только в памяти вкладки, поэтому истёкший или
 * отсутствующий токен — штатное состояние, а не повод показывать ошибку:
 * после перезагрузки страницы его не будет вовсе. Здесь это обрабатывается
 * один раз для всех вызовов — сессия восстанавливается обменом httpOnly-куки,
 * и запрос повторяется.
 *
 * Повтор ровно один. Если и после обновления пришёл 401, значит сессия мертва
 * по-настоящему, и второй круг только маскировал бы это бесконечным
 * ожиданием.
 */
async function authorized<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readAccessToken();

  if (token) {
    try {
      return await request<T>(path, withToken(init, token));
    } catch (cause) {
      if (!(cause instanceof ApiError) || cause.status !== 401) {
        throw cause;
      }
    }
  }

  let refreshed: AuthResponse;

  try {
    refreshed = await request<AuthResponse>('/auth/refresh', { method: 'POST' });
  } catch (cause) {
    clearSession();
    throw cause;
  }

  saveSession(refreshed);

  return request<T>(path, withToken(init, refreshed.accessToken));
}

function withToken(init: RequestInit, token: string): RequestInit {
  return { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } };
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export const api = {
  /** Официальное название клуба по его коду. Открыто без авторизации. */
  tenant: (slug: string): Promise<PublicTenant> => request(`/tenants/${slug}`),

  register: (payload: RegisterRequest): Promise<AuthResponse> =>
    request('/auth/register', json('POST', payload)),

  login: (payload: LoginRequest): Promise<AuthResponse> =>
    request('/auth/login', json('POST', payload)),

  /** Гасит сессию на сервере и стирает куку. Токен берётся из httpOnly-куки. */
  logout: (): Promise<void> => request('/auth/logout', { method: 'POST' }),

  /** Профиль вошедшего. Сессия восстанавливается сама, если access-токен истёк. */
  me: (): Promise<PublicUser> => authorized('/auth/me'),

  // --- Профиль клуба. Доступен только ролям admin/owner.
  clubSettings: (): Promise<ClubSettings> => authorized('/club/settings'),

  updateClubSettings: (patch: UpdateClubSettingsRequest): Promise<ClubSettings> =>
    authorized('/club/settings', json('PATCH', patch)),

  // --- Залы
  halls: (): Promise<Hall[]> => authorized('/club/halls'),

  createHall: (payload: CreateHallRequest): Promise<Hall> =>
    authorized('/club/halls', json('POST', payload)),

  updateHall: (id: string, patch: UpdateHallRequest): Promise<Hall> =>
    authorized(`/club/halls/${id}`, json('PATCH', patch)),

  deleteHall: (id: string): Promise<void> =>
    authorized(`/club/halls/${id}`, { method: 'DELETE' }),

  // --- Столы
  clubTables: (): Promise<ClubTable[]> => authorized('/club/tables'),

  createTable: (hallId: string, label: string): Promise<ClubTable> =>
    authorized('/club/tables', json('POST', { hallId, label })),

  renameTable: (id: string, label: string): Promise<ClubTable> =>
    authorized(`/club/tables/${id}`, json('PATCH', { label })),

  deleteTable: (id: string): Promise<void> =>
    authorized(`/club/tables/${id}`, { method: 'DELETE' }),

  // --- Тренеры
  coaches: (): Promise<ClubCoach[]> => authorized('/club/coaches'),

  // --- Состав клуба
  people: (query: ClubPeopleQuery = {}): Promise<ClubPeoplePage> => {
    const params = new URLSearchParams();

    if (query.role) params.set('role', query.role);
    if (query.search) params.set('search', query.search);
    if (query.ids?.length) params.set('ids', query.ids.join(','));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.offset !== undefined) params.set('offset', String(query.offset));

    const search = params.toString();

    return authorized(`/club/people${search ? `?${search}` : ''}`);
  },

  // --- Расписание зала
  /** Постоянный шаблон недели: как зал живёт обычно. */
  template: (hallId: string): Promise<ClosureRule[]> =>
    authorized(`/club/halls/${hallId}/template`),

  /** Шаблон заменяется целиком — см. ScheduleService.replaceTemplate на сервере. */
  replaceTemplate: (hallId: string, rules: ClosureRuleDraft[]): Promise<ClosureRule[]> =>
    authorized(`/club/halls/${hallId}/template`, json('PUT', { rules })),

  /** Даты, на которых расписание отличается от шаблона. */
  customisedDates: (hallId: string): Promise<string[]> =>
    authorized(`/club/halls/${hallId}/days`),

  daySchedule: (hallId: string, date: string): Promise<DaySchedule> =>
    authorized(`/club/halls/${hallId}/days/${date}`),

  replaceDay: (hallId: string, date: string, closures: DayClosureDraft[]): Promise<DaySchedule> =>
    authorized(`/club/halls/${hallId}/days/${date}`, json('PUT', { closures })),

  /** Возврат даты к шаблону. */
  resetDay: (hallId: string, date: string): Promise<DaySchedule> =>
    authorized(`/club/halls/${hallId}/days/${date}`, { method: 'DELETE' }),
};
