import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@yenisey/types';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Проверка роли. Работает после JwtAuthGuard и ClubContextGuard — порядок
 * задаётся в AuthModule, где guard'ы регистрируются глобально.
 *
 * Роль берётся из КЛУБА запроса, а не из токена: один аккаунт бывает
 * клиентом в одном клубе и владельцем в другом, и «роль пользователя» без
 * указания клуба ничего не значит.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Маршрут без @Roles() доступен любой авторизованной роли.
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const club = request.club;

    // @Roles() на маршруте без клуба в адресе — ошибка программиста, а не
    // клиента: проверять роль негде. Отдаём отказ, а не пропускаем: молчаливо
    // открытый маршрут хуже ложного 403.
    if (!club) {
      throw new ForbiddenException('Недостаточно прав');
    }

    // Ролей у человека несколько (решение владельца от 26.09.2026): пускаем,
    // если подходит хоть одна.
    if (!club.roles.some((role) => required.includes(role))) {
      throw new ForbiddenException('Недостаточно прав');
    }

    return true;
  }
}
