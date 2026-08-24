import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AccessTokenPayload, AuthResponse, PublicUser } from '@yenisey/types';
import { AuthService, type SessionContext } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { UsersService } from '../users/users.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() request: Request): Promise<AuthResponse> {
    return this.auth.register(dto, sessionContext(request));
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() request: Request): Promise<AuthResponse> {
    return this.auth.login(dto, sessionContext(request));
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() request: Request): Promise<AuthResponse> {
    return this.auth.refresh(dto.refreshToken, sessionContext(request));
  }

  /**
   * Публичный маршрут: выход не требует живого access-токена. Клиент, у
   * которого access уже истёк, всё равно должен иметь возможность погасить
   * свою сессию.
   */
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  /** Сквозной срез замыкается здесь: защищённый маршрут, читающий данные по токену. */
  @Get('me')
  me(@CurrentUser() user: AccessTokenPayload): Promise<PublicUser> {
    return this.users.findPublicById(user.sub, user.tenantId);
  }
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
