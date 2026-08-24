import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AccessTokenPayload } from '@yenisey/types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { Env } from '../../config/env';

/**
 * Проверка access-токена. Подключён глобально в AuthModule — по умолчанию
 * закрыт КАЖДЫЙ маршрут, и открытые помечаются явно через @Public().
 *
 * Порядок именно такой, а не «вешаем guard там, где нужно»: забытый guard на
 * новом эндпоинте — это утечка, забытый @Public() — это всего лишь 401 на
 * этапе разработки.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Требуется авторизация');
    }

    try {
      // Подписываем access-токен своим секретом, refresh — своим. Здесь
      // принимается только access: refresh-токен вообще не JWT и проверку не
      // пройдёт даже случайно.
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });

      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Токен недействителен или истёк');
    }
  }
}

/** Express-запрос после успешной проверки токена. */
export interface AuthenticatedRequest extends Request {
  user?: AccessTokenPayload;
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;

  if (!header) {
    return null;
  }

  const [scheme, value] = header.split(' ');

  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
