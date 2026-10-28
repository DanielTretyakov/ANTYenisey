import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@yenisey/database';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Привязка человека к клубу.
 *
 * Раньше это был один и тот же приватный метод в `BookingService` и
 * `EventsService`, и комментарий рядом с копией прямо говорил: дублируется
 * сознательно, **до появления третьего места**. Третье место наступило —
 * администратор заводит бронь на другого человека, и тот может не состоять в
 * клубе вовсе. Четвёртой копии быть не должно.
 */
@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Заводит привязку человека к клубу и анкету клиента, если их ещё нет.
   *
   * По ТЗ записаться может любой пользователь платформы, вступать в клуб не
   * нужно, — но запись ссылается на `ClientProfile`, а тот на
   * `TenantMembership`. Без этого шага первая же запись новичка падала бы
   * ошибкой внешнего ключа.
   *
   * Оба upsert'а идут одной транзакцией: привязка без анкеты — это членство,
   * которое не может ни на что записаться, и чинить его пришлось бы руками.
   *
   * Роль существующей привязки не трогаем: тренер, записавшийся на турнир или
   * забронировавший стол себе, не должен от этого стать клиентом.
   *
   * Два первых запроса новичка разом (двойное нажатие «Записаться») оба не
   * находят привязку, и второй upsert упирается в уникальный ключ — человек
   * видел «Internal server error» рядом с «Вы записаны» (прогон 28.10.2026).
   * Повтор находит строку, созданную первым, и проходит.
   */
  async ensureClient(tenantId: string, userId: string): Promise<void> {
    try {
      await this.upsertClient(tenantId, userId);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      await this.upsertClient(tenantId, userId);
    }
  }

  private async upsertClient(tenantId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.tenantMembership.upsert({
        where: { userId_tenantId: { userId, tenantId } },
        update: {},
        create: { userId, tenantId, roles: [Role.CLIENT] },
      });

      await tx.clientProfile.upsert({
        where: { userId_tenantId: { userId, tenantId } },
        update: {},
        create: { userId, tenantId },
      });
    });
  }
}
