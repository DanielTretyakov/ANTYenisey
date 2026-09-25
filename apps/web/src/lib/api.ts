import type {
  AttendanceHistoryItem,
  AttendanceKind,
  AttendanceResult,
  AuthResponse,
  BookingDay,
  BookingEntry,
  BookingQuote,
  AddressSuggestion,
  City,
  ClosureRule,
  ClosureRuleDraft,
  ClientBooking,
  ClubCard,
  ClubCoach,
  ClubCatalogItem,
  ClubCoachListItem,
  ClubEvent,
  ClubSearchQuery,
  CoachCard,
  CoachGroup,
  CoachPrices,
  CoachStats,
  CoachStatsPeriod,
  UpdateCoachCardRequest,
  UpdateCoachPricesRequest,
  AdjustSubscriptionRequest,
  ClientSubscription,
  ClubLedgerPage,
  ClubLedgerQuery,
  SubscriptionLedgerRow,
  SubscriptionPlan,
  SubscriptionPlanRequest,
  PublicCoach,
  FavouriteClub,
  EventDetail,
  EventKind,
  FeedEvent,
  ChangePasswordRequest,
  PublicPlan,
  SubscriptionOffer,
  UpdateProfileRequest,
  PublicDayBoard,
  StaffPreferences,
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
  AchievementRequest,
  CreateChildRequest,
  FamilyChild,
  FamilyNotice,
  GuardianshipRequestView,
  MyGuardian,
  MaxLinkResponse,
  NotificationCategoryName,
  NotificationSettingsView,
  PushSubscriptionRequest,
  PlayerProfile,
  PublicPlayer,
  PublicTenant,
  PublicUser,
  RankReviewRequest,
  SportRankLevel,
  UpdateEquipmentRequest,
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

/**
 * Запрос к API без разбора ответа — для тех, кому нужны байты, а не JSON.
 *
 * Заголовок `Content-Type` здесь НЕ ставится: его ставит `json()` вместе с
 * телом. Загрузке файла он навредил бы — браузер сам пишет
 * `multipart/form-data` с границей частей, и чужой заголовок её затёр бы.
 */
async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${API_URL}/api${path}`, {
    ...init,
    // Без этого браузер не приложит httpOnly-куку с refresh-токеном: веб и API
    // живут на разных портах, а значит запрос кросс-доменный. Ответная кука по
    // той же причине не сохранилась бы, и обновление сессии молча ломается.
    credentials: 'include',
  });

  if (!response.ok) {
    // NestJS отдаёт { message } строкой или массивом (когда ValidationPipe
    // собрал несколько нарушений) — приводим к одной строке для UI.
    const body: unknown = await response.json().catch(() => null);
    const raw = (body as { message?: string | string[] } | null)?.message;
    const message = Array.isArray(raw) ? raw.join('; ') : (raw ?? 'Ошибка запроса');

    throw new ApiError(message, response.status);
  }

  return response;
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  // Nest отдаёт `null` пустым телом со статусом 200 — «кто ведёт меня» у
  // человека без родителя. `response.json()` на пустом теле падает.
  const text = await response.text();

  return (text ? JSON.parse(text) : null) as T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return readJson<T>(await send(path, init));
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
  return readJson<T>(await authorizedResponse(path, init));
}

async function authorizedResponse(path: string, init: RequestInit = {}): Promise<Response> {
  const token = readAccessToken();

  if (token) {
    try {
      return await send(path, withToken(init, token));
    } catch (cause) {
      if (!(cause instanceof ApiError) || cause.status !== 401) {
        throw cause;
      }
    }
  }

  const refreshed = await refreshOnce();

  return send(path, withToken(init, refreshed.accessToken));
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
  return readJson<T>(await optionallyAuthorizedResponse(path, init));
}

async function optionallyAuthorizedResponse(path: string, init: RequestInit = {}): Promise<Response> {
  const token = readAccessToken() ?? (await refreshOnce().catch(() => null))?.accessToken;

  return send(path, token ? withToken(init, token) : init);
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
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Адрес с `?for=<id ребёнка>` — действие за своего ребёнка младше 14.
 *
 * Пусто — человек действует сам. Решает, можно ли, сервер: он же проверяет,
 * что это действительно ребёнок вошедшего и ему нет 14.
 */
function withFor(path: string, forPerson?: string | null): string {
  if (!forPerson) {
    return path;
  }

  return `${path}${path.includes('?') ? '&' : '?'}for=${encodeURIComponent(forPerson)}`;
}

/** Форма с файлом. Заголовок не ставится — см. `send`. */
const form = (method: string, fields: Record<string, string>, file?: File | null): RequestInit => {
  const body = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    body.set(key, value);
  }

  if (file) {
    body.set('file', file);
  }

  return { method, body };
};

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

  /** Правка своих ФИО и телефона. Почта и дата рождения — через клуб. */
  updateMe: (payload: UpdateProfileRequest): Promise<PublicUser> => authorized('/auth/me', json('PATCH', payload)),

  /**
   * Смена своего пароля. Ответ — новая сессия: прежние сервер гасит все,
   * а эту вкладку оставляет в кабинете.
   */
  changePassword: (payload: ChangePasswordRequest): Promise<AuthResponse> =>
    authorized('/auth/password', json('POST', payload)),

  // --- Стартовая страница: поиск клубов. Открыто без входа.
  /** Справочник городов для выпадающего списка. */
  /**
   * Подсказки города: начало названия или слова, крупные первыми. Пустой
   * запрос — самые крупные города.
   */
  cities: (query = '', limit = 8): Promise<City[]> =>
    request(`/cities?${new URLSearchParams({ query: query.trim(), limit: String(limit) })}`),

  /** Один город — показать уже выбранный в форме. */
  city: (id: string): Promise<City> => request(`/cities/${encodeURIComponent(id)}`),

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
  myBookings: (forPerson?: string | null): Promise<BookingEntry[]> =>
    authorized(withFor('/me/bookings', forPerson)),

  // --- Профиль игрока. Свойство человека, а не клуба: клуба в адресе нет.
  // Родитель ведёт профиль ребёнка тем же маршрутом с `forPerson`.
  myPlayer: (forPerson?: string | null): Promise<PlayerProfile> =>
    authorized(withFor('/me/player', forPerson)),

  updateEquipment: (patch: UpdateEquipmentRequest, forPerson?: string | null): Promise<PlayerProfile> =>
    authorized(withFor('/me/player', forPerson), json('PATCH', patch)),

  /** Аватар заменяется целиком. Картинку пережимает сервер. */
  setAvatar: (file: File, forPerson?: string | null): Promise<PlayerProfile> =>
    authorized(withFor('/me/player/avatar', forPerson), form('PUT', {}, file)),

  removeAvatar: (forPerson?: string | null): Promise<PlayerProfile> =>
    authorized(withFor('/me/player/avatar', forPerson), { method: 'DELETE' }),

  addAchievement: (payload: AchievementRequest, forPerson?: string | null): Promise<PlayerProfile> =>
    authorized(withFor('/me/player/achievements', forPerson), json('POST', payload)),

  updateAchievement: (id: string, payload: AchievementRequest, forPerson?: string | null): Promise<PlayerProfile> =>
    authorized(withFor(`/me/player/achievements/${id}`, forPerson), json('PATCH', payload)),

  removeAchievement: (id: string, forPerson?: string | null): Promise<PlayerProfile> =>
    authorized(withFor(`/me/player/achievements/${id}`, forPerson), { method: 'DELETE' }),

  /**
   * Разряд одной формой: сам разряд, приказ и, если есть, скан. Правка
   * возвращает разряд на проверку клубу.
   */
  setRank: (payload: SetRankPayload, forPerson?: string | null): Promise<PlayerProfile> =>
    authorized(
      withFor('/me/player/rank', forPerson),
      form(
        'PUT',
        {
          rank: payload.rank,
          ...(payload.orderNumber ? { orderNumber: payload.orderNumber } : {}),
          ...(payload.orderDate ? { orderDate: payload.orderDate } : {}),
          ...(payload.removeDocument ? { removeDocument: 'true' } : {}),
        },
        payload.document,
      ),
    ),

  removeRank: (forPerson?: string | null): Promise<PlayerProfile> =>
    authorized(withFor('/me/player/rank', forPerson), { method: 'DELETE' }),

  // --- Семья: родитель ведёт ребёнка младше 14.
  myChildren: (): Promise<FamilyChild[]> => authorized('/me/children'),

  /** Учётка ребёнку — закрепляется за родителем сразу. */
  createChild: (payload: CreateChildRequest): Promise<FamilyChild> =>
    authorized('/me/children', json('POST', payload)),

  /** Заявка на существующую учётку. Ответ одинаковый при любом исходе. */
  attachChild: (email: string): Promise<FamilyNotice> =>
    authorized('/me/children/attach', json('POST', { email })),

  /** Новый пароль ребёнку. Все его сессии гаснут. */
  setChildPassword: (id: string, password: string): Promise<void> =>
    authorized(`/me/children/${id}/password`, json('POST', { password })),

  unlinkChild: (id: string): Promise<void> => authorized(`/me/children/${id}`, { method: 'DELETE' }),

  /** Кто ведёт вошедшего. `null` — никто, или ему уже 14. */
  myGuardian: (): Promise<MyGuardian | null> => authorized('/me/guardianship'),

  guardianshipRequests: (): Promise<GuardianshipRequestView[]> =>
    authorized('/me/guardianship/requests'),

  /** Ответить на заявку может только сам ребёнок. */
  answerGuardianshipRequest: (id: string, answer: 'confirm' | 'reject'): Promise<void> =>
    authorized(`/me/guardianship/requests/${id}/${answer}`, { method: 'POST' }),

  /**
   * Публичная страница игрока. Открыта без входа, но от своего имени, когда
   * есть от чьего: страницу игрока младше четырнадцати видят только он сам и
   * администраторы его клубов.
   */
  player: (id: string): Promise<PublicPlayer> => optionallyAuthorized(`/players/${id}`),

  // --- Карточка тренера. Одна на все клубы, поэтому клуба в адресе нет:
  // заполняет её сам тренер, а клуб только смотрит.
  myCoachCard: (): Promise<CoachCard> => authorized('/me/coach-card'),

  updateCoachCard: (patch: UpdateCoachCardRequest): Promise<CoachCard> =>
    authorized('/me/coach-card', json('PATCH', patch)),

  /** Фотография заменяется целиком. Картинку пережимает сервер. */
  setCoachPhoto: (file: File): Promise<CoachCard> =>
    authorized('/me/coach-card/photo', form('PUT', {}, file)),

  removeCoachPhoto: (): Promise<CoachCard> => authorized('/me/coach-card/photo', { method: 'DELETE' }),

  /** Свои абонементы по всем клубам; за ребёнка — с `forPerson`. */
  mySubscriptions: (forPerson?: string | null): Promise<ClientSubscription[]> =>
    authorized(withFor('/me/subscriptions', forPerson)),

  /** Тарифы моих клубов — для пустого раздела «Абонементы». */
  mySubscriptionOffers: (forPerson?: string | null): Promise<SubscriptionOffer[]> =>
    authorized(withFor('/me/subscriptions/offers', forPerson)),

  /** Публичная карточка тренера. Возраста у неё нет — открыта всем. */
  coach: (id: string): Promise<PublicCoach> => optionallyAuthorized(`/coaches/${id}`),

  // --- Уведомления в MAX. Свойство человека, а не клуба: клуба в адресе нет.
  notificationSettings: (): Promise<NotificationSettingsView> => authorized('/me/notifications'),

  /** Ссылка на бота с одноразовым токеном: живёт 15 минут, действует последняя. */
  linkMax: (): Promise<MaxLinkResponse> => authorized('/me/notifications/max', { method: 'POST' }),

  unlinkMax: (): Promise<NotificationSettingsView> => authorized('/me/notifications/max', { method: 'DELETE' }),

  setNotificationCategory: (category: NotificationCategoryName, enabled: boolean): Promise<NotificationSettingsView> =>
    authorized(`/me/notifications/categories/${category}`, json('PUT', { enabled })),

  /** Включить уведомления в браузере на этом устройстве. */
  subscribePush: (subscription: PushSubscriptionRequest): Promise<NotificationSettingsView> =>
    authorized('/me/notifications/push', json('PUT', subscription)),

  /** Выключить на этом устройстве: адрес подписки знает только сам браузер. */
  unsubscribePush: (endpoint: string): Promise<NotificationSettingsView> =>
    authorized('/me/notifications/push/unsubscribe', json('POST', { endpoint })),

  /** Проверочное сообщение. Не чаще раза в минуту. */
  sendTestNotification: (): Promise<void> => authorized('/me/notifications/test', { method: 'POST' }),

  /**
   * Файл — байтами, а не адресом для `<img src>`. Картинка по адресу ушла бы
   * без токена, а аватар ребёнка и скан приказа отдаются только тем, кому
   * можно.
   */
  file: async (id: string): Promise<Blob> => (await optionallyAuthorizedResponse(`/files/${id}`)).blob(),
};

/** Что уходит в форму разряда. */
export interface SetRankPayload {
  rank: SportRankLevel;
  orderNumber: string;
  orderDate: string;
  /** Новый скан; заменяет прежний. */
  document: File | null;
  /** Убрать прежний скан без замены. */
  removeDocument: boolean;
}

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
/** Что спросить у списка мероприятий клуба. */
export interface EventsFilter {
  from?: string;
  to?: string;
  kind?: EventKind;
  typeId?: string;
  limit?: number;
}

export function clubApi(slug: string = TENANT_SLUG) {
  const club = `/clubs/${slug}`;

  return {
    // --- Профиль клуба. Доступен только ролям admin/owner.
    clubSettings: (): Promise<ClubSettings> => authorized(`${club}/settings`),

    updateClubSettings: (patch: UpdateClubSettingsRequest): Promise<ClubSettings> =>
      authorized(`${club}/settings`, json('PATCH', patch)),

    /** Баннер страницы клуба: файл в поле `file`, новый заменяет старый. */
    setClubBanner: (file: File): Promise<ClubSettings> => authorized(`${club}/settings/banner`, form('PUT', {}, file)),

    removeClubBanner: (): Promise<ClubSettings> => authorized(`${club}/settings/banner`, { method: 'DELETE' }),

    /** Все тренеры клуба; показанные на странице клуба — с местом. */
    coachList: (): Promise<ClubCoachListItem[]> => authorized(`${club}/settings/coaches`),

    /** Состав на странице клуба: упорядоченные наверху и скрытые галочкой. */
    setCoachList: (coachIds: string[], hiddenIds: string[]): Promise<ClubCoachListItem[]> =>
      authorized(`${club}/settings/coaches`, json('PUT', { coachIds, hiddenIds })),

    /** Подсказки адреса зала — дома из справочника, в городе зала. */
    addressSuggestions: (query: string, cityId: string | null): Promise<AddressSuggestion[]> =>
      authorized(
        `${club}/address-suggestions?${new URLSearchParams({ query, ...(cityId ? { cityId } : {}) })}`,
      ),

    // --- Залы
    halls: (): Promise<Hall[]> => authorized(`${club}/halls`),

    /** Приоритетный зал того, кто спрашивает: первый на смене и в расписании. */
    myPreferences: (): Promise<StaffPreferences> => authorized(`${club}/me/preferences`),

    setMyPreferences: (preferences: StaffPreferences): Promise<StaffPreferences> =>
      authorized(`${club}/me/preferences`, json('PUT', preferences)),

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
    /**
     * Предстоящие мероприятия: окном `from`/`to` (неделя, месяц) или одним
     * видом — «ближайшие N детских тренировок» по всем датам.
     */
    events: (forPerson?: string | null, filter: EventsFilter = {}): Promise<ClubEvent[]> => {
      const params = new URLSearchParams(
        Object.entries(filter)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => [key, String(value)]),
      ).toString();

      return optionallyAuthorized(withFor(params ? `${club}/events?${params}` : `${club}/events`, forPerson));
    },

    /** Что есть в клубе: виды занятий и турниров с ближайшим проведением. */
    catalog: (): Promise<ClubCatalogItem[]> => optionallyAuthorized(`${club}/catalog`),

    /**
     * Одно мероприятие для окна подробностей: описание, зал, тренер и
     * записавшиеся кружками. Открыто, как и список.
     */
    event: (kind: EventKind, id: string, forPerson?: string | null): Promise<EventDetail> =>
      optionallyAuthorized(
        withFor(`${club}/events/${kind === 'TRAINING' ? 'training' : 'tournament'}/${id}`, forPerson),
      ),

    /** Мои мероприятия в этом клубе: занятия, турниры и свои брони столов. */
    myEvents: (forPerson?: string | null): Promise<BookingEntry[]> =>
      authorized(withFor(`${club}/events/mine`, forPerson)),

    registerForTournament: (tournamentId: string, forPerson?: string | null): Promise<BookingEntry> =>
      authorized(withFor(`${club}/tournaments/${tournamentId}/registration`, forPerson), { method: 'POST' }),

    /** Отмена возвращает запись: человек должен увидеть, сколько с него списалось. */
    cancelTournamentRegistration: (tournamentId: string, forPerson?: string | null): Promise<BookingEntry> =>
      authorized(withFor(`${club}/tournaments/${tournamentId}/registration`, forPerson), { method: 'DELETE' }),

    /** Идентификатор — ЗАНЯТИЯ, а не строки записи: по нему же идёт отмена. */
    registerForTraining: (sessionId: string, forPerson?: string | null): Promise<BookingEntry> =>
      authorized(withFor(`${club}/trainings/${sessionId}/booking`, forPerson), { method: 'POST' }),

    cancelTrainingBooking: (sessionId: string, forPerson?: string | null): Promise<BookingEntry> =>
      authorized(withFor(`${club}/trainings/${sessionId}/booking`, forPerson), { method: 'DELETE' }),

    // --- Бронирование стола клиентом
    /** Залы с ценами и шагом брони — то же, что видит администратор в настройках. */
    /** Залы с ценами и шагом брони. Открыто без входа — это прайс клуба. */
    /** Все действующие тарифы клуба — открыто, как цены залов. */
    publicPlans: (): Promise<PublicPlan[]> => optionallyAuthorized(`${club}/plans`),

    bookingHalls: (): Promise<Hall[]> => optionallyAuthorized(`${club}/booking/halls`),

    /**
     * Открытая сетка дня: свободное и чем занято остальное (аренда без имён,
     * занятие, турнир). Без входа — новичок смотрит время до регистрации.
     */
    bookingBoard: (hallId: string, date: string): Promise<PublicDayBoard> =>
      optionallyAuthorized(`${club}/booking/halls/${hallId}/days/${date}/board`),

    /** Что свободно в зале на дату. Причина занятости клиенту не раскрывается. */
    bookingDay: (hallId: string, date: string): Promise<BookingDay> =>
      authorized(`${club}/booking/halls/${hallId}/days/${date}`),

    /** Стоимость аренды до подтверждения брони. */
    bookingQuote: (
      hallId: string,
      durationMinutes: number,
      withRobot: boolean,
    ): Promise<BookingQuote> =>
      optionallyAuthorized(
        `${club}/booking/quote?hallId=${encodeURIComponent(hallId)}` +
          `&durationMinutes=${durationMinutes}&withRobot=${withRobot}`,
      ),

    createBooking: (payload: CreateBookingRequest, forPerson?: string | null): Promise<ClientBooking> =>
      authorized(withFor(`${club}/booking/bookings`, forPerson), json('POST', payload)),

    myBookings: (forPerson?: string | null): Promise<ClientBooking[]> =>
      authorized(withFor(`${club}/booking/bookings`, forPerson)),

    /** Отмена возвращает саму бронь: клиент должен увидеть, сколько с него списалось. */
    cancelBooking: (id: string, forPerson?: string | null): Promise<ClientBooking> =>
      authorized(withFor(`${club}/booking/bookings/${id}`, forPerson), { method: 'DELETE' }),

    // --- Спарринг: тот же стол теми же правилами, но берёт его тренер. Ученик
    // в такой брони не записан — заполнено либо клиент, либо тренер.
    createSparring: (payload: CreateBookingRequest): Promise<ClientBooking> =>
      authorized(`${club}/coach/sparring`, json('POST', payload)),

    mySparrings: (): Promise<ClientBooking[]> => authorized(`${club}/coach/sparring`),

    cancelSparring: (id: string): Promise<ClientBooking> =>
      authorized(`${club}/coach/sparring/${id}`, { method: 'DELETE' }),

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

    /**
     * Решение по разряду. `version` — то, что администратор видел: если игрок
     * успел поправить разряд, сервер ответит 409, а не подтвердит непросмотренное.
     */
    reviewRank: (personId: string, payload: RankReviewRequest): Promise<PlayerProfile> =>
      authorized(`${club}/people/${personId}/rank/review`, json('POST', payload)),

    // --- Семья у стойки
    /** Завести ребёнка родителю из клуба. Почту и пароль задаёт родитель рядом. */
    createChildFor: (guardianId: string, payload: CreateChildRequest): Promise<FamilyChild> =>
      authorized(`${club}/people/${guardianId}/children`, json('POST', payload)),

    /** Предложить закрепить ребёнка за родителем. Подтвердит сам ребёнок. */
    requestGuardian: (childId: string, guardianId: string): Promise<void> =>
      authorized(`${club}/people/${childId}/guardian`, json('POST', { guardianId })),

    /** Снять закрепление от имени клуба — только с причиной. */
    revokeGuardian: (childId: string, reason: string): Promise<void> =>
      authorized(`${club}/people/${childId}/guardian/revoke`, json('POST', { reason })),

    // --- Цены тренера В ЭТОМ клубе. Сама карточка общая на все клубы и живёт
    // платформенным маршрутом (`api.myCoachCard`).
    coachPrices: (): Promise<CoachPrices> => authorized(`${club}/coach/prices`),

    updateCoachPrices: (payload: UpdateCoachPricesRequest): Promise<CoachPrices> =>
      authorized(`${club}/coach/prices`, json('PATCH', payload)),

    /** Свои занятия вместе с составом записавшихся. */
    coachGroups: (): Promise<CoachGroup[]> => authorized(`${club}/coach/groups`),

    /** Своя статистика по проведённым занятиям. */
    coachStats: (period: CoachStatsPeriod): Promise<CoachStats> =>
      authorized(`${club}/coach/stats?period=${period}`),

    /** Та же статистика глазами клуба — расчёт один. */
    coachStatsOf: (coachId: string, period: CoachStatsPeriod): Promise<CoachStats> =>
      authorized(`${club}/coaches/${coachId}/stats?period=${period}`),

    // --- Абонементы. Тарифы заводит и правит администратор; продаёт он же, из
    // карточки человека. Удаления тарифа нет: снятый с продажи не предлагается.
    subscriptionPlans: (): Promise<SubscriptionPlan[]> => authorized(`${club}/subscription-plans`),

    createSubscriptionPlan: (payload: SubscriptionPlanRequest): Promise<SubscriptionPlan> =>
      authorized(`${club}/subscription-plans`, json('POST', payload)),

    updateSubscriptionPlan: (id: string, payload: SubscriptionPlanRequest): Promise<SubscriptionPlan> =>
      authorized(`${club}/subscription-plans/${id}`, json('PATCH', payload)),

    /**
     * Продать абонемент у стойки. Деньги принимаются вне системы.
     *
     * Зал продажи — не прихоть формы: по его поясу считается конец срока, и в
     * его деньгах дня видна продажа. У клуба с одним залом не спрашивается.
     */
    issueSubscription: (personId: string, planId: string, hallId?: string): Promise<ClientSubscription> =>
      authorized(`${club}/people/${personId}/subscriptions`, json('POST', { planId, hallId })),

    /** История абонементов всего клуба: движение за движением, свежие сверху. */
    subscriptionLedger: (query: ClubLedgerQuery = {}): Promise<ClubLedgerPage> => {
      const params = new URLSearchParams();

      if (query.personId) params.set('personId', query.personId);
      if (query.search) params.set('search', query.search);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.offset !== undefined) params.set('offset', String(query.offset));

      const search = params.toString();

      return authorized(`${club}/subscriptions/ledger${search ? `?${search}` : ''}`);
    },

    /** Корректировка визитов или досрочное закрытие безлимита — с причиной. */
    adjustSubscription: (
      personId: string,
      subscriptionId: string,
      payload: AdjustSubscriptionRequest,
    ): Promise<ClientSubscription> =>
      authorized(`${club}/people/${personId}/subscriptions/${subscriptionId}/adjust`, json('POST', payload)),

    /** История ОДНОГО абонемента — в карточке человека. Клубная выше. */
    subscriptionLedgerOf: (personId: string, subscriptionId: string): Promise<SubscriptionLedgerRow[]> =>
      authorized(`${club}/people/${personId}/subscriptions/${subscriptionId}/ledger`),

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
