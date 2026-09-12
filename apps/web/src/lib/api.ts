import type {
  AttendanceHistoryItem,
  AttendanceKind,
  AttendanceResult,
  AuthResponse,
  BookingDay,
  BookingEntry,
  BookingQuote,
  City,
  ClosureRule,
  ClosureRuleDraft,
  ClientBooking,
  ClubCard,
  ClubCoach,
  ClubEvent,
  ClubSearchQuery,
  FavouriteClub,
  FeedEvent,
  ClubPeoplePage,
  ClubPeopleQuery,
  ClubPersonCard,
  PlatformPersonLookup,
  ClubPerson,
  ClubSettings,
  ClubTable,
  CancelDeskBookingRequest,
  CreateBookingRequest,
  CreateDeskBookingRequest,
  CreateHallRequest,
  DayClosureDraft,
  DaySchedule,
  DeskBooking,
  DeskDay,
  DeskVisit,
  Hall,
  MarkAttendanceBatchRequest,
  MarkAttendanceRequest,
  MoveDeskBookingRequest,
  LoginRequest,
  PublicTenant,
  PublicUser,
  RecordVisitRequest,
  RegisterRequest,
  Tournament,
  TournamentRequest,
  TournamentType,
  TournamentTypeRequest,
  TrainingSession,
  TrainingSessionRequest,
  TrainingType,
  TrainingTypeRequest,
  UpdateClubSettingsRequest,
  UpdateHallRequest,
} from '@yenisey/types';
import { clearSession, readAccessToken, saveSession } from './session';
import { TENANT_SLUG } from './config';

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

  const refreshed = await refreshOnce();

  return request<T>(path, withToken(init, refreshed.accessToken));
}

/**
 * Запрос к открытому маршруту — но от своего имени, если человек вошёл.
 *
 * Открытый не значит анонимный. Список мероприятий клуба виден без входа, но
 * вошедшему в нём нужна ещё одна вещь: записан ли он сам. Без токена сервер
 * этого не знает и честно отвечает «неизвестно» — а интерфейс показывает
 * кнопку «Записаться» тому, кто уже записан.
 *
 * Токена может не быть в памяти, хотя сессия жива, — сразу после перезагрузки
 * страницы. Поэтому здесь тот же обмен куки, что и в `authorized`, но его
 * неудача не ошибка: значит человек действительно не вошёл, и маршрут
 * отвечает ему как анониму.
 */
async function optionallyAuthorized<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readAccessToken() ?? (await refreshOnce().catch(() => null))?.accessToken;

  return request<T>(path, token ? withToken(init, token) : init);
}

/**
 * Обновление сессии, которое не наступает само себе на пятки.
 *
 * REFRESH-ТОКЕН РОТИРУЕТСЯ: сервер отдаёт новый и гасит предъявленный. Значит
 * два одновременных обмена одной и той же кукой обречены — первый её отзовёт,
 * второй получит 401 и решит, что сессия мертва.
 *
 * А одновременные обмены — норма, а не исключение. Сразу после перезагрузки
 * страницы access-токена нет вовсе, и всё, что спрашивает сервер, идёт
 * обновляться: шапка за профилем, страница за своими данными. Раньше это
 * выглядело как «переход на главную выкидывает из аккаунта» — на самом деле
 * два запроса просто отнимали сессию друг у друга.
 *
 * Поэтому обмен здесь один на всех: пока он идёт, остальные ждут его результат,
 * а не начинают свой. Обещание снимается по завершении — следующий истёкший
 * токен обновится заново.
 */
let refreshing: Promise<AuthResponse> | null = null;

function refreshOnce(): Promise<AuthResponse> {
  refreshing ??= request<AuthResponse>('/auth/refresh', { method: 'POST' })
    .then((refreshed) => {
      saveSession(refreshed);
      return refreshed;
    })
    .catch((cause: unknown) => {
      clearSession();
      throw cause;
    })
    .finally(() => {
      refreshing = null;
    });

  return refreshing;
}

function withToken(init: RequestInit, token: string): RequestInit {
  return { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } };
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

/**
 * Маршруты уровня платформы: аккаунт, поиск клубов, мои клубы, мои записи.
 *
 * Клуба не имеют вовсе — аккаунт один на всю платформу, и спрашивать «мои
 * записи в каком клубе» бессмысленно: человек ходит в три и хочет расписание
 * своей недели одним списком.
 */
export const api = {
  /** Карточка клуба по его коду. Открыто без авторизации. */
  tenant: (slug: string): Promise<PublicTenant> => request(`/clubs/${slug}`),

  register: (payload: RegisterRequest): Promise<AuthResponse> =>
    request('/auth/register', json('POST', payload)),

  login: (payload: LoginRequest): Promise<AuthResponse> =>
    request('/auth/login', json('POST', payload)),

  /** Гасит сессию на сервере и стирает куку. Токен берётся из httpOnly-куки. */
  logout: (): Promise<void> => request('/auth/logout', { method: 'POST' }),

  /** Профиль вошедшего. Сессия восстанавливается сама, если access-токен истёк. */
  me: (): Promise<PublicUser> => authorized('/auth/me'),

  // --- Стартовая страница: поиск клубов. Открыто без входа.
  /** Справочник городов для выпадающего списка. */
  cities: (): Promise<City[]> => request('/cities'),

  /**
   * Поиск клубов по названию и городу.
   *
   * Пустой запрос — не ошибка, а «покажи всё»: человек, только что открывший
   * страницу, ещё ничего не ввёл.
   */
  searchClubs: (query: ClubSearchQuery = {}): Promise<ClubCard[]> => {
    const params = new URLSearchParams();

    if (query.query) params.set('query', query.query);
    if (query.cityId) params.set('cityId', query.cityId);

    const search = params.toString();

    return request(`/clubs${search ? `?${search}` : ''}`);
  },

  // --- Мои клубы. Избранное и заявленная принадлежность — одна сущность.
  myClubs: (): Promise<FavouriteClub[]> => authorized('/me/clubs'),

  /** Отметить клуб своим. Идемпотентно: второе нажатие ничего не меняет. */
  addClub: (slug: string): Promise<FavouriteClub[]> =>
    authorized(`/me/clubs/${slug}`, { method: 'PUT' }),

  removeClub: (slug: string): Promise<FavouriteClub[]> =>
    authorized(`/me/clubs/${slug}`, { method: 'DELETE' }),

  /** Лента ближайших мероприятий моих клубов — одним списком по времени. */
  feed: (): Promise<FeedEvent[]> => authorized('/me/feed'),

  /**
   * Все записи по всем клубам: и турниры, и аренда столов.
   *
   * Отмена идёт клубным маршрутом — каждая строка несёт код своего клуба. Два
   * пути отмены разошлись бы сначала в мелочах, потом в деньгах.
   */
  myBookings: (): Promise<BookingEntry[]> => authorized('/me/bookings'),
};

/**
 * Маршруты одного клуба.
 *
 * Клуб едет участком адреса, а не токеном: аккаунт один на платформу, и
 * серверу неоткуда узнать, про какой клуб спрашивают. Раньше код брался из
 * окружения одной константой — веб обслуживал единственный клуб. Теперь он
 * приходит из адреса страницы, и `TENANT_SLUG` остался только запасным
 * значением для разработки.
 *
 * Фабрика, а не первый аргумент у каждого метода: страница знает свой клуб
 * один раз, в начале, и повторять его в тридцати вызовах незачем.
 */
export function clubApi(slug: string = TENANT_SLUG) {
  const club = `/clubs/${slug}`;

  return {
    // --- Профиль клуба. Доступен только ролям admin/owner.
    clubSettings: (): Promise<ClubSettings> => authorized(`${club}/settings`),

    updateClubSettings: (patch: UpdateClubSettingsRequest): Promise<ClubSettings> =>
      authorized(`${club}/settings`, json('PATCH', patch)),

    // --- Залы
    halls: (): Promise<Hall[]> => authorized(`${club}/halls`),

    createHall: (payload: CreateHallRequest): Promise<Hall> =>
      authorized(`${club}/halls`, json('POST', payload)),

    updateHall: (id: string, patch: UpdateHallRequest): Promise<Hall> =>
      authorized(`${club}/halls/${id}`, json('PATCH', patch)),

    deleteHall: (id: string): Promise<void> =>
      authorized(`${club}/halls/${id}`, { method: 'DELETE' }),

    // --- Столы
    clubTables: (): Promise<ClubTable[]> => authorized(`${club}/tables`),

    createTable: (hallId: string, label: string): Promise<ClubTable> =>
      authorized(`${club}/tables`, json('POST', { hallId, label })),

    renameTable: (id: string, label: string): Promise<ClubTable> =>
      authorized(`${club}/tables/${id}`, json('PATCH', { label })),

    deleteTable: (id: string): Promise<void> =>
      authorized(`${club}/tables/${id}`, { method: 'DELETE' }),

    // --- Тренеры
    coaches: (): Promise<ClubCoach[]> => authorized(`${club}/coaches`),

    // --- Состав клуба
    people: (query: ClubPeopleQuery = {}): Promise<ClubPeoplePage> => {
      const params = new URLSearchParams();

      if (query.role) params.set('role', query.role);
      if (query.search) params.set('search', query.search);
      if (query.ids?.length) params.set('ids', query.ids.join(','));
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.offset !== undefined) params.set('offset', String(query.offset));

      const search = params.toString();

      return authorized(`${club}/people${search ? `?${search}` : ''}`);
    },

    /** Карточка человека: кто он в клубе, сводка, записи и визиты — одним запросом. */
    person: (id: string): Promise<ClubPersonCard> => authorized(`${club}/people/${id}`),

    /**
     * Найти человека на платформе по ТОЧНОЙ почте или телефону.
     *
     * Частичного поиска здесь нет: администратор ищет того, кто стоит перед
     * ним и назвал свою почту, а не листает людей чужих клубов.
     */
    lookupPerson: (query: { email?: string; phone?: string }): Promise<PlatformPersonLookup> => {
      const search = new URLSearchParams();

      if (query.email) search.set('email', query.email);
      if (query.phone) search.set('phone', query.phone);

      return authorized(`${club}/people/lookup?${search.toString()}`);
    },

    /** Привязать найденного человека к клубу. Повтор — то же состояние. */
    attachPerson: (id: string): Promise<ClubPerson> =>
      authorized(`${club}/people/${id}/attach`, json('POST', {})),

    /** Повышение клиента до тренера и обратно. */
    changeRole: (userId: string, role: ClubPerson['role']): Promise<ClubPerson> =>
      authorized(`${club}/people/${userId}/role`, json('PATCH', { role })),

    // --- Справочники: типы тренировок, типы турниров, турниры
    trainingTypes: (): Promise<TrainingType[]> => authorized(`${club}/training-types`),

    createTrainingType: (payload: TrainingTypeRequest): Promise<TrainingType> =>
      authorized(`${club}/training-types`, json('POST', payload)),

    updateTrainingType: (id: string, payload: TrainingTypeRequest): Promise<TrainingType> =>
      authorized(`${club}/training-types/${id}`, json('PATCH', payload)),

    deleteTrainingType: (id: string): Promise<void> =>
      authorized(`${club}/training-types/${id}`, { method: 'DELETE' }),

    tournamentTypes: (): Promise<TournamentType[]> => authorized(`${club}/tournament-types`),

    createTournamentType: (payload: TournamentTypeRequest): Promise<TournamentType> =>
      authorized(`${club}/tournament-types`, json('POST', payload)),

    updateTournamentType: (id: string, payload: TournamentTypeRequest): Promise<TournamentType> =>
      authorized(`${club}/tournament-types/${id}`, json('PATCH', payload)),

    deleteTournamentType: (id: string): Promise<void> =>
      authorized(`${club}/tournament-types/${id}`, { method: 'DELETE' }),

    tournaments: (): Promise<Tournament[]> => authorized(`${club}/tournaments`),

    createTournament: (payload: TournamentRequest): Promise<Tournament> =>
      authorized(`${club}/tournaments`, json('POST', payload)),

    deleteTournament: (id: string): Promise<void> =>
      authorized(`${club}/tournaments/${id}`, { method: 'DELETE' }),

    trainingSessions: (): Promise<TrainingSession[]> => authorized(`${club}/training-sessions`),

    createTrainingSession: (payload: TrainingSessionRequest): Promise<TrainingSession> =>
      authorized(`${club}/training-sessions`, json('POST', payload)),

    updateTrainingSession: (
      id: string,
      payload: TrainingSessionRequest,
    ): Promise<TrainingSession> =>
      authorized(`${club}/training-sessions/${id}`, json('PATCH', payload)),

    deleteTrainingSession: (id: string): Promise<void> =>
      authorized(`${club}/training-sessions/${id}`, { method: 'DELETE' }),

    // --- Расписание зала
    /** Постоянный шаблон недели: как зал живёт обычно. */
    template: (hallId: string): Promise<ClosureRule[]> =>
      authorized(`${club}/halls/${hallId}/template`),

    /** Шаблон заменяется целиком — см. ScheduleService.replaceTemplate на сервере. */
    replaceTemplate: (hallId: string, rules: ClosureRuleDraft[]): Promise<ClosureRule[]> =>
      authorized(`${club}/halls/${hallId}/template`, json('PUT', { rules })),

    /** Даты, на которых расписание отличается от шаблона. */
    customisedDates: (hallId: string): Promise<string[]> =>
      authorized(`${club}/halls/${hallId}/days`),

    daySchedule: (hallId: string, date: string): Promise<DaySchedule> =>
      authorized(`${club}/halls/${hallId}/days/${date}`),

    replaceDay: (hallId: string, date: string, closures: DayClosureDraft[]): Promise<DaySchedule> =>
      authorized(`${club}/halls/${hallId}/days/${date}`, json('PUT', { closures })),

    /** Возврат даты к шаблону. Занятия и турниры, ставшие ничьими, уходят вместе с днём. */
    resetDay: (hallId: string, date: string): Promise<DaySchedule> =>
      authorized(`${club}/halls/${hallId}/days/${date}`, { method: 'DELETE' }),

    /**
     * Отвязка даты от шаблона. Отдельным действием, а не побочным следствием
     * сохранения: раньше день отвязывался первым же «Сохранить», даже без правок.
     */
    detachDay: (hallId: string, date: string): Promise<DaySchedule> =>
      authorized(`${club}/halls/${hallId}/days/${date}/detach`, { method: 'POST' }),

    // --- Мероприятия клуба
    /**
     * Предстоящие мероприятия клуба. Открыто без входа: клуб выбирают до
     * регистрации. Вошедшему приезжает ещё и отметка «я уже записан» — ради
     * неё запрос идёт от его имени, когда есть от чьего.
     */
    events: (): Promise<ClubEvent[]> => optionallyAuthorized(`${club}/events`),

    /** Мои мероприятия в этом клубе: занятия, турниры и свои брони столов. */
    myEvents: (): Promise<BookingEntry[]> => authorized(`${club}/events/mine`),

    registerForTournament: (tournamentId: string): Promise<BookingEntry> =>
      authorized(`${club}/tournaments/${tournamentId}/registration`, { method: 'POST' }),

    /** Отмена возвращает запись: человек должен увидеть, сколько с него списалось. */
    cancelTournamentRegistration: (tournamentId: string): Promise<BookingEntry> =>
      authorized(`${club}/tournaments/${tournamentId}/registration`, { method: 'DELETE' }),

    /** Идентификатор — ЗАНЯТИЯ, а не строки записи: по нему же идёт отмена. */
    registerForTraining: (sessionId: string): Promise<BookingEntry> =>
      authorized(`${club}/trainings/${sessionId}/booking`, { method: 'POST' }),

    cancelTrainingBooking: (sessionId: string): Promise<BookingEntry> =>
      authorized(`${club}/trainings/${sessionId}/booking`, { method: 'DELETE' }),

    // --- Бронирование стола клиентом
    /** Залы с ценами и шагом брони — то же, что видит администратор в настройках. */
    bookingHalls: (): Promise<Hall[]> => authorized(`${club}/booking/halls`),

    /** Что свободно в зале на дату. Причина занятости клиенту не раскрывается. */
    bookingDay: (hallId: string, date: string): Promise<BookingDay> =>
      authorized(`${club}/booking/halls/${hallId}/days/${date}`),

    /** Стоимость аренды до подтверждения брони. */
    bookingQuote: (
      hallId: string,
      durationMinutes: number,
      withRobot: boolean,
    ): Promise<BookingQuote> =>
      authorized(
        `${club}/booking/quote?hallId=${encodeURIComponent(hallId)}` +
          `&durationMinutes=${durationMinutes}&withRobot=${withRobot}`,
      ),

    createBooking: (payload: CreateBookingRequest): Promise<ClientBooking> =>
      authorized(`${club}/booking/bookings`, json('POST', payload)),

    myBookings: (): Promise<ClientBooking[]> => authorized(`${club}/booking/bookings`),

    /** Отмена возвращает саму бронь: клиент должен увидеть, сколько с него списалось. */
    cancelBooking: (id: string): Promise<ClientBooking> =>
      authorized(`${club}/booking/bookings/${id}`, { method: 'DELETE' }),

    // --- Рабочее место администратора
    /**
     * День зала целиком: столы, брони, мероприятия, загрузка и деньги.
     *
     * Один запрос, а не четыре: экран смены открывают двадцать раз за вечер, и
     * четыре ожидания вместо одного — умножение задержки на ровном месте.
     */
    deskDay: (hallId: string, date: string): Promise<DeskDay> =>
      authorized(`${club}/desk/halls/${hallId}/days/${date}`),

    /** Поиск по истории броней клуба: диапазон дат, зал, клиент, статус. */
    deskBookings: (query: DeskBookingsQuery = {}): Promise<DeskBooking[]> => {
      const search = new URLSearchParams();

      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') search.set(key, String(value));
      }

      const tail = search.toString();

      return authorized(`${club}/desk/bookings${tail ? `?${tail}` : ''}`);
    },

    /** Посадить человека за стол. Автора сервер берёт из токена, а не из тела. */
    createDeskBooking: (payload: CreateDeskBookingRequest): Promise<DeskBooking> =>
      authorized(`${club}/desk/bookings`, json('POST', payload)),

    /** Перенос: другой стол, время или длительность. Цену сервер пересчитает. */
    moveDeskBooking: (id: string, payload: MoveDeskBookingRequest): Promise<DeskBooking> =>
      authorized(`${club}/desk/bookings/${id}`, json('PATCH', payload)),

    /**
     * Отмена брони администратором. POST, а не DELETE: у неё есть тело
     * («простить списание»), а тело DELETE-запроса режет половина прокси.
     */
    cancelDeskBooking: (
      id: string,
      payload: CancelDeskBookingRequest = {},
    ): Promise<DeskBooking> =>
      authorized(`${club}/desk/bookings/${id}/cancel`, json('POST', payload)),

    // --- Отметка присутствия

    /** Пришёл или не пришёл. Повтор того же ничего не меняет — это PUT. */
    markAttendance: (
      kind: AttendanceKind,
      entryId: string,
      payload: MarkAttendanceRequest,
    ): Promise<AttendanceResult> =>
      authorized(`${club}/desk/attendance/${kind.toLowerCase()}/${entryId}`, json('PUT', payload)),

    /** «Отметить всех пришедшими» — всё или ничего. */
    markAttendanceBatch: (payload: MarkAttendanceBatchRequest): Promise<AttendanceResult[]> =>
      authorized(`${club}/desk/attendance`, json('POST', payload)),

    /** Кто, когда и почему отмечал запись — для спора с клиентом. */
    attendanceHistory: (kind: AttendanceKind, entryId: string): Promise<AttendanceHistoryItem[]> =>
      authorized(`${club}/desk/attendance/${kind.toLowerCase()}/${entryId}/history`),

    /** Визит с порога или внесённый задним числом. */
    recordVisit: (payload: RecordVisitRequest): Promise<DeskVisit> =>
      authorized(`${club}/desk/visits`, json('POST', payload)),
  };
}

/** Фильтры списка броней клуба — то же, что принимает сервер. */
export interface DeskBookingsQuery {
  hallId?: string;
  clientId?: string;
  status?: DeskBooking['status'];
  from?: string;
  to?: string;
  limit?: number;
}
