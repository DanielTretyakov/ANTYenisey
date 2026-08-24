import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { Prisma, Role } from '@yenisey/database';
import type {
  AccessTokenPayload,
  AuthResponse,
  LoginRequest,
  PublicUser,
  RegisterRequest,
} from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { joinFullName } from './full-name';
import { hashToken, parseDuration } from './tokens';
import type { Env } from '../config/env';

/**
 * Параметры argon2id. OWASP-минимум: 19 МиБ памяти, 2 прохода. Память здесь
 * важнее числа итераций — именно она делает перебор на GPU невыгодным.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

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
  ) {}

  async register(dto: RegisterRequest, context: SessionContext): Promise<AuthResponse> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
      select: { id: true },
    });

    // Несуществующий клуб и занятый email отдают одну и ту же ошибку:
    // перечислять клубы платформы и её клиентов посторонним незачем.
    if (!tenant) {
      throw new ConflictException('Регистрация невозможна: проверьте клуб и адрес почты');
    }

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);

    try {
      // Транзакция обязательна: клиент без ClientProfile — это учётка, которая
      // не может ничего забронировать, и чинить её пришлось бы руками.
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: dto.email,
            phone: dto.phone,
            passwordHash,
            role: Role.CLIENT,
          },
        });

        await tx.clientProfile.create({
          data: {
            userId: created.id,
            tenantId: tenant.id,
            fullName: joinFullName(dto),
          },
        });

        return created;
      });

      return this.issueSession(
        {
          id: user.id,
          tenantId: user.tenantId,
          email: user.email,
          phone: user.phone,
          role: user.role,
          fullName: joinFullName(dto),
        },
        context,
      );
    } catch (error) {
      // P2002 — нарушение @@unique([tenantId, email]): в этом клубе адрес уже
      // занят. Ловим и гонку, которую проверка «есть ли такой email» перед
      // вставкой не закрывает.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Регистрация невозможна: проверьте клуб и адрес почты');
      }
      throw error;
    }
  }

  async login(dto: LoginRequest, context: SessionContext): Promise<AuthResponse> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, tenant: { slug: dto.tenantSlug } },
      select: {
        id: true,
        tenantId: true,
        email: true,
        phone: true,
        role: true,
        passwordHash: true,
        deactivatedAt: true,
        anonymizedAt: true,
        clientProfile: { select: { fullName: true } },
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
      throw new UnauthorizedException('Неверный адрес почты или пароль');
    }

    return this.issueSession(
      {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        phone: user.phone,
        role: user.role,
        fullName: user.clientProfile?.fullName ?? null,
      },
      context,
    );
  }

  /**
   * Обмен refresh-токена на новую пару с ротацией.
   *
   * Использованный токен гасится сразу. Повторное предъявление уже погашенного
   * означает, что копия токена утекла, — тогда гасим все сессии пользователя,
   * потому что неизвестно, кто из двоих законный владелец.
   */
  async refresh(rawToken: string, context: SessionContext): Promise<AuthResponse> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: {
        id: true,
        userId: true,
        tenantId: true,
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
        where: { userId: stored.userId, tenantId: stored.tenantId, revokedAt: null },
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
      select: {
        id: true,
        tenantId: true,
        email: true,
        phone: true,
        role: true,
        deactivatedAt: true,
        anonymizedAt: true,
        clientProfile: { select: { fullName: true } },
      },
    });

    if (!user || user.deactivatedAt || user.anonymizedAt) {
      throw new UnauthorizedException('Сессия недействительна, войдите заново');
    }

    return this.issueSession(
      {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        phone: user.phone,
        role: user.role,
        fullName: user.clientProfile?.fullName ?? null,
      },
      context,
    );
  }

  /** Выход: гасим предъявленный токен. Чужой или несуществующий молча игнорируем. */
  async logout(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Выдача пары токенов и сохранение refresh-сессии. */
  private async issueSession(user: PublicUser, context: SessionContext): Promise<AuthResponse> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
    };

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
        tenantId: user.tenantId,
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

/** Обстоятельства выдачи сессии — для списка активных входов в кабинете. */
export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}
