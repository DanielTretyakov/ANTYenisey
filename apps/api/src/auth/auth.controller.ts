import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { AccessTokenPayload, AuthResponse, PublicUser } from '@yenisey/types';
import { AuthService, type IssuedSession, type SessionContext } from './auth.service';
import {
  clearedCookieOptions,
  refreshCookieOptions,
  REFRESH_COOKIE,
  TRANSPORT_HEADER,
  wantsBodyTransport,
} from './cookies';
import { LoginDto } from './dto/login.dto';
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

  /** Сквозной срез замыкается здесь: защищённый маршрут, читающий данные по токену. */
  @Get('me')
  me(@CurrentUser() user: AccessTokenPayload): Promise<PublicUser> {
    return this.users.findPublicById(user.sub, user.tenantId);
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
