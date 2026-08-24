import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AccessTokenPayload } from '@yenisey/types';
import type { AuthenticatedRequest } from '../guards/jwt-auth.guard';

/**
 * Полезная нагрузка токена текущего пользователя.
 *
 * Отсюда берётся tenantId для запросов к базе — и только отсюда. Принимать
 * идентификатор клуба из тела запроса или query нельзя: это позволило бы
 * клиенту одного клуба читать данные другого.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessTokenPayload => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user) {
      // Сюда можно попасть только если маршрут помечен @Public(), но
      // параметр всё равно запрошен — это ошибка программиста, не клиента.
      throw new Error('@CurrentUser() использован на маршруте без авторизации');
    }

    return request.user;
  },
);
