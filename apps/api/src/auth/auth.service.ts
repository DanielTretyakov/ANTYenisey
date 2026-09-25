import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { Prisma, Role } from '@yenisey/database';
import type {
  AccessTokenPayload,
  AuthResponse,
  ChangePasswordRequest,
  LoginRequest,
  PublicUser,
  RegisterRequest,
  UpdateProfileRequest,
} from '@yenisey/types';
import { CHILD_UNTIL_AGE, fullYears } from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { AttemptLimiter, attemptKey } from './attempt-limiter';
import { formatBirthDate, parseBirthDate } from './birth-date';
import { joinFullName } from './full-name';
import { ARGON2_OPTIONS, hashPassword } from './password';
import { hashToken, parseDuration } from './tokens';
import type { Env } from '../config/env';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Хеш случайного пароля, который никому не принадлежит. Нужен, чтобы вход с
   * несуществующим email занимал столько же времени, сколько вход с
   * существующим: иначе разница во времени ответа позволяет перебором собрать
   * список клиентов клуба. Считается один раз при старте — argon2 намеренно
   * медленный, и делать это на каждый запрос незачем.
   */
  private readonly dummyHash: Promise<string> = argon2.hash(
    randomBytes(32).toString('hex'),
    ARGON2_OPTIONS,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly attempts: AttemptLimiter,
  ) {}

  /**
   * Регистрация на ПЛАТФОРМЕ, а не в клубе.
   *
   * Клуб необязателен: аккаунт один на всю платформу, и вступать куда-либо,
   * чтобы им пользоваться, не нужно. Если код клуба всё же передан — человек
   * пришёл со страницы конкретного клуба, — он заодно сразу становится его
   * клиентом; иначе привязка появится сама при первой записи.
   */
  async register(dto: RegisterRequest, context: SessionContext): Promise<IssuedSession> {
    const tenant = dto.tenantSlug
      ? await this.prisma.tenant.findUnique({
          where: { slug: dto.tenantSlug },
          select: { id: true },
        })
      : null;

    // Несуществующий клуб и занятый email отдают одну и ту же ошибку:
    // перечислять клубы платформы и её клиентов посторонним незачем.
    if (dto.tenantSlug && !tenant) {
      throw new ConflictException('Регистрация невозможна: проверьте клуб и адрес почты');
    }

    const birthDate = parseBirthDate(dto.birthDate);

    if (!birthDate) {
      throw new ConflictException(
        'Проверьте дату рождения: она не может быть в будущем или раньше 1900 года',
      );
    }

    const passwordHash = await hashPassword(dto.password);

    try {
      // Транзакция обязательна: привязка без ClientProfile — это членство,
      // которое не может ничего забронировать, и чинить его пришлось бы
      // руками.
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: dto.email,
            phone: dto.phone,
            passwordHash,
            fullName: joinFullName(dto),
            birthDate,
          },
        });

        if (tenant) {
          await tx.tenantMembership.create({
            data: { userId: created.id, tenantId: tenant.id, role: Role.CLIENT },
          });

          await tx.clientProfile.create({
            data: { userId: created.id, tenantId: tenant.id },
          });
        }

        return created;
      });

      return this.issueSession(await this.publicUser(user.id), context);
    } catch (error) {
      // P2002 — нарушение @unique на почте: адрес уже занят НА ПЛАТФОРМЕ.
      // Ловим и гонку, которую проверка «есть ли такой email» перед вставкой
      // не закрывает.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Регистрация невозможна: проверьте клуб и адрес почты');
      }
      throw error;
    }
  }

  /**
   * Вход на платформу. Клуб не спрашивается: почта уникальна по всей
   * платформе, и уточнять, «куда именно человек идёт», нечем — клуб он
   * выберет уже внутри.
   */
  async login(dto: LoginRequest, context: SessionContext): Promise<IssuedSession> {
    const key = attemptKey(dto.email);
    const retryAfterMs = this.attempts.retryAfterMs(key);

    if (retryAfterMs !== null) {
      // 429, а не 401: подбирающему всё равно, а честному владельцу учётки
      // важно понять, что дело не в пароле и войти можно будет позже.
      throw new HttpException(
        `Слишком много неудачных попыток входа. Повторите через ${minutesFrom(retryAfterMs)} мин.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        passwordHash: true,
        deactivatedAt: true,
        anonymizedAt: true,
      },
    });

    // Сравниваем всегда — даже когда пользователя нет (см. dummyHash).
    const passwordMatches = await argon2
      .verify(user?.passwordHash ?? (await this.dummyHash), dto.password)
      .catch(() => false);

    // Отключённая и анонимизированная учётки войти не могут, но внешне это
    // неотличимо от неверного пароля — уволенному тренеру незачем узнавать,
    // что учётка ещё существует.
    if (!user || !passwordMatches || user.deactivatedAt || user.anonymizedAt) {
      this.attempts.registerFailure(key);
      throw new UnauthorizedException('Неверный адрес почты или пароль');
    }

    // Счётчик обнуляется только после удачного входа: серия ошибок,
    // закончившаяся правильным паролем, — это забывчивый человек, а не
    // перебор, и держать его у порога блокировки незачем.
    this.attempts.reset(key);

    return this.issueSession(await this.publicUser(user.id), context);
  }

  /**
   * Правка своих ФИО и телефона. До 16 лет данные ведут родитель и
   * администратор клуба — ровно как профиль игрока: сам ребёнок смотрит.
   */
  async updateProfile(userId: string, dto: UpdateProfileRequest): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deactivatedAt: null, anonymizedAt: null },
      select: { birthDate: true },
    });

    if (!user) {
      throw new UnauthorizedException('Сессия недействительна, войдите заново');
    }

    if (fullYears(user.birthDate, new Date()) < CHILD_UNTIL_AGE) {
      throw new ForbiddenException('До 16 лет данные меняет родитель или администратор клуба');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { fullName: joinFullName(dto), phone: dto.phone },
    });

    return this.publicUser(userId);
  }

  /**
   * Смена своего пароля.
   *
   * Текущий пароль обязателен: без него открытый на чужом компьютере кабинет
   * отдавал бы учётку насовсем. Неверный текущий — 400, а не 401: на 401 веб
   * пошёл бы обновлять сессию. Попытки считает тот же ограничитель, что у
   * входа, — иначе форма смены пароля стала бы обходным путём перебора.
   *
   * Все прежние сессии гаснут — новый пароль ничего не значит, пока старые
   * живы, — а тому, кто меняет, выдаётся свежая: выкидывать его самого
   * незачем.
   */
  async changePassword(userId: string, dto: ChangePasswordRequest, context: SessionContext): Promise<IssuedSession> {
    const key = attemptKey(`password:${userId}`);
    const retryAfterMs = this.attempts.retryAfterMs(key);

    if (retryAfterMs !== null) {
      throw new HttpException(
        `Слишком много неудачных попыток. Повторите через ${minutesFrom(retryAfterMs)} мин.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deactivatedAt: null, anonymizedAt: null },
      select: { passwordHash: true },
    });

    if (!user) {
      throw new UnauthorizedException('Сессия недействительна, войдите заново');
    }

    const matches = await argon2.verify(user.passwordHash, dto.currentPassword).catch(() => false);

    if (!matches) {
      this.attempts.registerFailure(key);
      throw new BadRequestException('Текущий пароль указан неверно');
    }

    this.attempts.reset(key);

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('Новый пароль совпадает с текущим');
    }

    const passwordHash = await hashPassword(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return this.issueSession(await this.publicUser(userId), context);
  }

  /**
   * Обмен refresh-токена на новую пару с ротацией.
   *
   * Использованный токен гасится сразу. Повторное предъявление уже погашенного
   * означает, что копия токена утекла, — тогда гасим все сессии пользователя,
   * потому что неизвестно, кто из двоих законный владелец.
   */
  async refresh(rawToken: string, context: SessionContext): Promise<IssuedSession> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (!stored) {
      throw new UnauthorizedException('Сессия недействительна, войдите заново');
    }

    if (stored.revokedAt) {
      this.logger.warn(
        `Повторное предъявление отозванного refresh-токена (пользователь ${stored.userId}): гашу все его сессии`,
      );
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Сессия недействительна, войдите заново');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Сессия истекла, войдите заново');
    }

    // Гасим токен ДО выдачи новой пары и условием `revokedAt: null` в самом
    // UPDATE. Проверка «не отозван ли» выше от гонки не спасает: два
    // одновременных обновления с одним токеном оба прошли бы её и получили
    // по паре токенов. Здесь же выигрывает ровно один запрос — второй увидит
    // count === 0, потому что строку уже перехватили.
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (revoked.count === 0) {
      throw new UnauthorizedException('Сессия недействительна, войдите заново');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      select: { id: true, deactivatedAt: true, anonymizedAt: true },
    });

    if (!user || user.deactivatedAt || user.anonymizedAt) {
      throw new UnauthorizedException('Сессия недействительна, войдите заново');
    }

    return this.issueSession(await this.publicUser(user.id), context);
  }

  /** Выход: гасим предъявленный токен. Чужой или несуществующий молча игнорируем. */
  async logout(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Аккаунт вместе со списком клубов и ролью в каждом.
   *
   * Собирается одним запросом на каждый вход и обновление: раньше всё нужное
   * лежало в самой строке User, а теперь роль — свойство пары «человек +
   * клуб», и без второй таблицы её взять неоткуда.
   */
  private async publicUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        birthDate: true,
        memberships: {
          // Отключённые в клубе не показываются: человек этим клубом больше
          // не пользуется, и держать его в шапке незачем.
          where: { deactivatedAt: null },
          select: {
            role: true,
            tenantId: true,
            tenant: { select: { slug: true, name: true } },
          },
          orderBy: { tenant: { name: 'asc' } },
        },
      },
    });

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      birthDate: formatBirthDate(user.birthDate),
      memberships: user.memberships.map((membership) => ({
        tenantId: membership.tenantId,
        slug: membership.tenant.slug,
        name: membership.tenant.name,
        role: membership.role,
      })),
    };
  }

  /** Выдача пары токенов и сохранение refresh-сессии. */
  private async issueSession(user: PublicUser, context: SessionContext): Promise<IssuedSession> {
    // В токене только «кто». Клуб и роль в него не кладутся: аккаунт один на
    // платформу, и зашитый клуб заставил бы человека перевходить, чтобы
    // открыть соседний.
    const payload: AccessTokenPayload = { sub: user.id };

    const accessTtl = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const refreshTtl = this.config.get('JWT_REFRESH_TTL', { infer: true });

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      // Приведение нужно из-за типов ms: библиотека сужает expiresIn до
      // шаблонного литерала («15m» и подобные), а из окружения приходит
      // обычная строка. Формат при этом проверен — parseDuration ниже
      // разбирает ту же строку и падает на мусоре.
      expiresIn: accessTtl as JwtSignOptions['expiresIn'],
    });

    // Refresh-токен — 256 случайных бит, а не JWT: его всё равно нужно сверять
    // со строкой в базе (ротация и отзыв), и подпись ничего не добавляет.
    const refreshToken = randomBytes(32).toString('base64url');

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        // В базе лежит только SHA-256: дамп таблицы не даёт войти ни за кого.
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + parseDuration(refreshTtl)),
        userAgent: context.userAgent?.slice(0, 512) ?? null,
        ipAddress: context.ipAddress ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(parseDuration(accessTtl) / 1000),
      user,
    };
  }
}

/**
 * Свежевыданная пара токенов. Отличается от `AuthResponse` тем, что
 * refresh-токен здесь есть всегда: решение, отдавать его клиенту в теле или
 * только в куке, принимает контроллер.
 */
export type IssuedSession = AuthResponse & { refreshToken: string };

/** Округление вверх до минут для сообщения о блокировке. */
function minutesFrom(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 60_000));
}

/** Обстоятельства выдачи сессии — для списка активных входов в кабинете. */
export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}
