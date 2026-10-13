import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import type { AccessTokenPayload, AuthResponse, MailStatus, PublicUser } from '@yenisey/types';
import { AuthService, type IssuedSession, type SessionContext } from './auth.service';
import {
  clearedCookieOptions,
  refreshCookieOptions,
  REFRESH_COOKIE,
  TRANSPORT_HEADER,
  wantsBodyTransport,
} from './cookies';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto, UpdateProfileDto, VerifyEmailDto } from './dto/profile.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { parseDuration } from './tokens';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { UsersService } from '../users/users.service';
import type { Env } from '../config/env';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const session = await this.auth.register(dto, sessionContext(request));
    return this.deliver(session, request, response);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const session = await this.auth.login(dto, sessionContext(request));
    return this.deliver(session, request, response);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const session = await this.auth.refresh(
      presentedToken(request, dto),
      sessionContext(request),
    );
    return this.deliver(session, request, response);
  }

  /**
   * Публичный маршрут: выход не требует живого access-токена. Клиент, у
   * которого access уже истёк, всё равно должен иметь возможность погасить
   * свою сессию.
   */
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const presented = readRefreshCookie(request) ?? dto.refreshToken;

    // Куку гасим в любом случае — даже когда токена не было или он чужой:
    // выход не должен оставлять браузер с недействительной сессией.
    response.clearCookie(REFRESH_COOKIE, clearedCookieOptions(this.secureCookies));

    if (presented) {
      await this.auth.logout(presented);
    }
  }

  /**
   * Сквозной срез замыкается здесь: защищённый маршрут, читающий данные по
   * токену. Отдаёт и список клубов человека с ролью в каждом — интерфейсу
   * иначе неоткуда узнать, куда его пускать.
   */
  @Get('me')
  me(@CurrentUser() user: AccessTokenPayload): Promise<PublicUser> {
    return this.users.findPublicById(user.sub);
  }

  /** Правка своих ФИО и телефона. Почта и дата рождения — через клуб. */
  @Patch('me')
  updateMe(@CurrentUser() user: AccessTokenPayload, @Body() dto: UpdateProfileDto): Promise<PublicUser> {
    return this.auth.updateProfile(user.sub, dto);
  }

  /**
   * Смена своего пароля. Отвечает новой сессией: прежние гаснут все, а тот,
   * кто меняет пароль, остаётся в кабинете.
   */
  @HttpCode(HttpStatus.OK)
  @Post('password')
  async changePassword(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ChangePasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const session = await this.auth.changePassword(user.sub, dto, sessionContext(request));
    return this.deliver(session, request, response);
  }

  /** Работает ли почта: без неё веб не предлагает «Забыли пароль?». */
  @Public()
  @Get('mail-status')
  mailStatus(): MailStatus {
    return this.auth.mailStatus();
  }

  /** Подтверждение почты по ссылке из письма — без входа. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('email/verify')
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    await this.auth.verifyEmail(dto.token);
  }

  /** Письмо подтверждения ещё раз. */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('email/resend')
  resendVerification(@CurrentUser() user: AccessTokenPayload): Promise<{ sent: boolean }> {
    return this.auth.resendVerification(user.sub);
  }

  /** «Забыли пароль?» — 202 при любом исходе. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('password/forgot')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ ok: true }> {
    await this.auth.forgotPassword(dto.email);

    return { ok: true };
  }

  /** Новый пароль по ссылке из письма — и сразу вход. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('password/reset')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const session = await this.auth.resetPassword(dto.token, dto.password, sessionContext(request));
    return this.deliver(session, request, response);
  }

  /**
   * Отправка выданной пары клиенту.
   *
   * Refresh-токен всегда уходит в httpOnly-куке. В теле ответа он остаётся,
   * только если клиент явно попросил — так забирает токен мобильное
   * приложение, у которого кук нет. Браузер такого заголовка не шлёт, и XSS на
   * странице до долгоживущего токена не дотягивается.
   */
  private deliver(session: IssuedSession, request: Request, response: Response): AuthResponse {
    const refreshTtl = parseDuration(this.config.get('JWT_REFRESH_TTL', { infer: true }));

    response.cookie(
      REFRESH_COOKIE,
      session.refreshToken,
      refreshCookieOptions(refreshTtl, this.secureCookies),
    );

    if (wantsBodyTransport(request.headers[TRANSPORT_HEADER])) {
      return session;
    }

    const { refreshToken: _withheld, ...withoutToken } = session;
    return withoutToken;
  }

  /**
   * `Secure` только в production: в разработке всё ходит по http, и браузер
   * такую куку не сохранил бы вовсе.
   */
  private get secureCookies(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production';
  }
}

/** Кука имеет приоритет над телом: браузерный клиент телом управлять не должен. */
function readRefreshCookie(request: Request): string | undefined {
  return (request.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
}

function presentedToken(request: Request, dto: RefreshDto): string {
  const token = readRefreshCookie(request) ?? dto.refreshToken;

  if (!token) {
    throw new UnauthorizedException('Сессия недействительна, войдите заново');
  }

  return token;
}

/**
 * Обстоятельства запроса для записи в RefreshToken. IP берётся из
 * `request.ip`: он учитывает X-Forwarded-For только при включённом
 * `trust proxy` (см. main.ts) — иначе заголовок подделывается кем угодно.
 */
function sessionContext(request: Request): SessionContext {
  return {
    userAgent: request.headers['user-agent'],
    ipAddress: request.ip,
  };
}
