import { Injectable, NotFoundException } from '@nestjs/common';
import type { ClubPersonCard, ClubPersonEntry } from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { formatBirthDate } from '../auth/birth-date';
import { chargeOf } from '../desk/revenue';
import { EntriesService } from '../entries/entries.service';
import { personSummary } from './person-summary';

/** Сколько записей показывается в карточке. Дальше — в поиске по броням. */
const HISTORY_LIMIT = 100;

/**
 * Карточка человека в клубе.
 *
 * Отвечает на вопросы, которые задают о клиенте у стойки: когда он был в
 * последний раз, сколько раз не пришёл, сколько на нём начислено. До этой
 * карточки ответить было нечем — «Состав клуба» показывал только имя и
 * телефон, а вся история лежала в базе и никуда не выходила.
 *
 * Всё сужено по клубу, и это не проверка в коде, а построение: записи собирает
 * `EntriesService.listForUser(userId, tenantId)`, который иначе и не умеет.
 * История того же человека в соседнем клубе администратору не видна.
 */
@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entries: EntriesService,
    private readonly attendance: AttendanceService,
  ) {}

  async card(tenantId: string, userId: string): Promise<ClubPersonCard> {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        tenantId,
        userId,
        // Анонимизированный человек скрыт: его персональные данные затёрты по
        // 152-ФЗ, и карточка «Удалённого пользователя» ничего не объясняет.
        user: { anonymizedAt: null },
      },
      select: {
        userId: true,
        role: true,
        createdAt: true,
        deactivatedAt: true,
        user: { select: { fullName: true, email: true, phone: true, birthDate: true } },
      },
    });

    if (!membership) {
      throw new NotFoundException('Человек не найден в этом клубе');
    }

    const [entries, visits] = await Promise.all([
      this.entries.listForUser(userId, tenantId),
      this.attendance.walkInsOf(tenantId, userId),
    ]);

    // Подпись «кто отметил» — только у отмеченных: у остальных журналу нечего
    // сказать, и спрашивать его о них незачем.
    const marks = await this.attendance.marksOf(
      tenantId,
      entries
        .filter((entry) => entry.status === 'ATTENDED' || entry.status === 'NO_SHOW')
        .map((entry) => entry.entryId),
    );

    const history: ClubPersonEntry[] = entries
      // Свежие сверху: карточку открывают с вопросом «что было», а не «что
      // будет». Предстоящие при этом не теряются — их считает сводка.
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .slice(0, HISTORY_LIMIT)
      .map((entry) => ({ ...entry, mark: marks.get(entry.entryId) ?? null }));

    return {
      person: {
        id: membership.userId,
        fullName: membership.user.fullName,
        email: membership.user.email,
        phone: membership.user.phone,
        birthDate: formatBirthDate(membership.user.birthDate),
        role: membership.role,
        createdAt: membership.createdAt.toISOString(),
        deactivated: membership.deactivatedAt !== null,
      },
      // Сводка считается по ВСЕМ записям, а не по показанной сотне: «не пришёл
      // трижды» не должно меняться от того, сколько строк влезло на экран.
      summary: personSummary(
        entries.map((entry) => ({
          status: entry.status,
          startsAt: entry.startsAt,
          // Деньги считает тот же `chargeOf`, что и итог дня на смене: два
          // расчёта разошлись бы, и первым это заметил бы клиент.
          charged: chargeOf({
            price: entry.price,
            status: entry.status,
            chargeRatio: entry.chargePercent,
          }),
        })),
        visits,
        new Date(),
      ),
      entries: history,
      visits,
    };
  }
}
