import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@yenisey/database';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Определяет клуб запроса и роль человека в нём.
 *
 * Работает на маршрутах с параметром `:slug` — то есть на всём, что живёт
 * под /api/clubs/:slug/.... На остальных молча пропускает: платформенные
 * маршруты («мои записи», профиль) клуба не имеют вовсе.
 *
 * Почему клуб приходит адресом, а не токеном. Аккаунт один на платформу, и
 * зашитый в токен клуб означал бы, что человек «находится» в одном клубе за
 * раз: две открытые вкладки на разные клубы дрались бы за общую сессию, а
 * раздел «Мои записи» по всем клубам вообще не выразить. Ссылка на страницу
 * клуба при этом становится самодостаточной — её можно переслать.
 *
 * Цена решения — запрос к базе на каждый клубный маршрут. Она осознанная:
 * роль, снятая администратором, перестаёт действовать сразу, а не когда
 * истечёт выданный человеку токен.
 */
@Injectable()
export class ClubContextGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const slug = (request.params as Record<string, string | undefined>)?.slug;

    // Маршрут без клуба в адресе — платформенный, определять нечего.
    if (!slug) {
      return true;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!tenant) {
      throw new NotFoundException('Клуб не найден');
    }

    const userId = request.user?.sub;

    // Открытые маршруты клуба (карточка, расписание) доступны и без входа:
    // человек выбирает клуб до того, как заводит учётку.
    if (!userId) {
      request.club = {
        userId: '',
        tenantId: tenant.id,
        slug,
        role: Role.CLIENT,
        joined: false,
      };
      return true;
    }

    const membership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId: tenant.id } },
      select: { role: true, deactivatedAt: true },
    });

    // Отключённый в этом клубе не возвращается сам собой: без этой проверки
    // уволенный тренер попадал бы обратно клиентом, потому что привязка
    // «заводится первым действием».
    if (membership?.deactivatedAt) {
      throw new ForbiddenException('Доступ в этот клуб закрыт');
    }

    request.club = {
      userId,
      tenantId: tenant.id,
      slug,
      // Привязки нет — значит человек в этом клубе впервые. По ТЗ записаться
      // может любой пользователь платформы, поэтому он проходит как клиент, а
      // строка TenantMembership появится первым же действием.
      role: membership?.role ?? Role.CLIENT,
      joined: membership !== null,
    };

    return true;
  }
}
