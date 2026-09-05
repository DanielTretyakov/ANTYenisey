import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { ClubContext } from '../club-context';
import type { AuthenticatedRequest } from '../guards/jwt-auth.guard';

/**
 * Клуб текущего запроса и роль человека в нём.
 *
 * Отсюда берётся tenantId для запросов к базе — и только отсюда. Клуб
 * определяется по участку адреса и сверяется с TenantMembership в
 * ClubContextGuard; принимать идентификатор клуба из тела запроса или query
 * нельзя — это позволило бы обратиться к чужому клубу.
 */
export const CurrentClub = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ClubContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.club) {
      // Сюда можно попасть, только если в адресе маршрута нет параметра
      // `:slug` — то есть это ошибка программиста, а не клиента.
      throw new Error('@CurrentClub() использован на маршруте без клуба в адресе');
    }

    return request.club;
  },
);
