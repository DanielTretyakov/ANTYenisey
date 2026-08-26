/**
 * Контракт авторизации, общий для API и фронтенда.
 *
 * Здесь лежат только формы запросов и ответов, пересекающие границу HTTP.
 * Модели БД сюда не попадают: они приходят из `@yenisey/database` и содержат
 * поля, которых клиент видеть не должен (passwordHash, служебные отметки).
 */

/**
 * Роль пользователя внутри клуба. Значения совпадают с enum `Role` из
 * schema.prisma — при добавлении роли править оба места.
 */
export type Role = 'CLIENT' | 'ADMIN' | 'COACH' | 'OWNER';

export interface RegisterRequest {
  /** Код клуба (Tenant.slug) — определяет, в какой клуб заводится клиент. */
  tenantSlug: string;
  email: string;
  password: string;
  /**
   * ФИО тремя отдельными полями, а не одной строкой.
   *
   * В базе оно всё равно хранится склеенным (ClientProfile.fullName), но
   * форма спрашивает по частям намеренно: в одно поле «ФИО» люди вписывают
   * что придётся — «Иван», «Иванов И.», «иванов иван» — и администратор
   * потом не может ни найти человека, ни обратиться к нему по имени.
   * Три обязательных поля этого не допускают.
   *
   * Отчество обязательно. Учтите, что у иностранцев и части народов России
   * его нет: если такие клиенты появятся, требование придётся ослабить.
   */
  lastName: string;
  firstName: string;
  middleName: string;
  /** Телефон в E.164: +79991234567. Основной канал связи клуба с клиентом. */
  phone: string;
}

export interface LoginRequest {
  tenantSlug: string;
  email: string;
  password: string;
}

export interface RefreshRequest {
  /**
   * Не обязателен: браузер присылает refresh-токен в httpOnly-куке и тела
   * запроса не заполняет. Поле остаётся для клиентов без кук — мобильного
   * приложения на Capacitor.
   */
  refreshToken?: string;
}

/** Пользователь в том виде, в каком его отдаёт API — без секретов. */
export interface PublicUser {
  id: string;
  tenantId: string;
  email: string;
  phone: string | null;
  role: Role;
  /** Из ClientProfile/CoachProfile; null, если профиль ещё не заведён. */
  fullName: string | null;
}

export interface AuthTokens {
  /**
   * Живёт 15 минут и хранится клиентом только в памяти. В localStorage его
   * класть нельзя: оттуда его читает любой скрипт на странице.
   */
  accessToken: string;
  /**
   * Присутствует, только если клиент явно попросил его в теле — заголовком
   * `X-Auth-Transport: body`. Так делает мобильное приложение (Capacitor), где
   * кук нет. Браузеру токен приходит исключительно в httpOnly-куке, и здесь
   * поле остаётся пустым.
   */
  refreshToken?: string;
  /** Срок жизни access-токена в секундах — фронтенд обновляет его заранее. */
  expiresIn: number;
}

export interface AuthResponse extends AuthTokens {
  user: PublicUser;
}

/** Полезная нагрузка access-токена. Всё, что нужно guard'ам, лежит здесь. */
export interface AccessTokenPayload {
  /** subject — User.id */
  sub: string;
  /** Клуб пользователя. Каждый запрос к данным обязан фильтроваться по нему. */
  tenantId: string;
  role: Role;
}

/** Полезная нагрузка refresh-токена. */
export interface RefreshTokenPayload {
  sub: string;
  tenantId: string;
  /** RefreshToken.id — по нему строка помечается отозванной при ротации. */
  jti: string;
}
