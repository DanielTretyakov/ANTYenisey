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
import type { ClubContext } from '../club-context';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { Env } from '../../config/env';

/**
 * Проверка access-токена. Подключён глобально в AuthModule — по умолчанию
 * закрыт КАЖДЫЙ маршрут, и открытые помечаются явно через @Public().
 *
 * Порядок именно такой, а не «вешаем guard там, где нужно»: забытый guard на
 * новом эндпоинте — это утечка, забытый @Public() — это всего лишь 401 на
 * этапе разработки.
 *
 * ОТКРЫТЫЙ НЕ ЗНАЧИТ АНОНИМНЫЙ. На маршруте с @Public() токен всё равно
 * разбирается, если он предъявлен, — просто его отсутствие или негодность не
 * повод отказать. Без этого открытый список мероприятий клуба не мог бы
 * ответить вошедшему на вопрос «а я записан?»: он виден без входа, но
 * представившемуся человеку обязан сказать больше, чем случайному гостю.
 *
 * Права это не ослабляет: подпись проверяется той же строкой и тем же
 * секретом, а маршрут и так был открыт для всех.
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

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request);

    if (!token) {
      // На открытом маршруте отсутствие токена — норма.
      if (isPublic) {
        return true;
      }

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
      // Просроченный токен на ОТКРЫТОМ маршруте не повод отказывать: человек
      // всё равно имеет право видеть эту страницу, просто как аноним.
      if (isPublic) {
        return true;
      }

      throw new UnauthorizedException('Токен недействителен или истёк');
    }
  }
}

/** Express-запрос после успешной проверки токена. */
export interface AuthenticatedRequest extends Request {
  user?: AccessTokenPayload;
  /** Клуб запроса и роль в нём — заполняет ClubContextGuard. */
  club?: ClubContext;
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;

  if (!header) {
    return null;
  }

  const [scheme, value] = header.split(' ');

  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
