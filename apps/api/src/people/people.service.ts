import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@yenisey/database';
import type { ClubPerson, ClubPersonCard, ClubPersonEntry, FamilyChild, PlatformPersonLookup } from '@yenisey/types';
import { shortName } from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { formatBirthDate } from '../auth/birth-date';
import { CoachesService } from '../coaches/coaches.service';
import { MembershipService } from '../club/membership.service';
import { chargeOf } from '../desk/revenue';
import { EntriesService } from '../entries/entries.service';
import type { ClubContext } from '../auth/club-context';
import type { AccountDto } from '../auth/dto/register.dto';
import { FamilyService } from '../guardianship/family.service';
import { PlayersService } from '../players/players.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
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
    private readonly membership: MembershipService,
    private readonly players: PlayersService,
    private readonly family: FamilyService,
    private readonly coaches: CoachesService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Завести ребёнка родителю у стойки. Родитель — человек этого клуба: клуб
   * заводит учётки детям тех, кого знает, а не кому угодно на платформе.
   */
  async createChild(
    club: ClubContext,
    guardianId: string,
    dto: AccountDto,
    ipAddress: string | null,
  ): Promise<FamilyChild> {
    await this.requireMember(club.tenantId, guardianId);

    return this.family.createChild(guardianId, dto, {
      tenantId: club.tenantId,
      actorUserId: club.userId,
      ipAddress,
    });
  }

  /** Заявка на закрепление: и ребёнок, и родитель — люди этого клуба. */
  async requestGuardian(club: ClubContext, childId: string, guardianId: string): Promise<void> {
    await Promise.all([
      this.requireMember(club.tenantId, childId),
      this.requireMember(club.tenantId, guardianId),
    ]);

    await this.family.requestForChild(guardianId, childId, {
      tenantId: club.tenantId,
      actorUserId: club.userId,
      ipAddress: null,
    });
  }

  /** Снять закрепление ребёнка этого клуба — с причиной и строкой аудита. */
  async revokeGuardian(club: ClubContext, childId: string, reason: string, ipAddress: string | null): Promise<void> {
    await this.requireMember(club.tenantId, childId);

    await this.family.revokeByClub(childId, reason, {
      tenantId: club.tenantId,
      actorUserId: club.userId,
      ipAddress,
    });
  }

  /**
   * Человек состоит в клубе и не отключён в нём. Чужой клубу человек не
   * находится — как и в карточке.
   */
  private async requireMember(tenantId: string, userId: string): Promise<void> {
    const found = await this.prisma.tenantMembership.findFirst({
      where: { tenantId, userId, deactivatedAt: null, user: { deactivatedAt: null, anonymizedAt: null } },
      select: { userId: true },
    });

    if (!found) {
      throw new NotFoundException('Человек не найден в этом клубе');
    }
  }

  /**
   * Найти человека на платформе по точной почте или точному телефону.
   *
   * Так принимают новичка «с порога» (ТЗ → «Оплата и политика отмены»):
   * человек регистрируется сам — учётку за него никто не заводит и пароля его
   * не знает, — а администратор находит его и привязывает к клубу.
   *
   * Ровно одно поле за раз и только целиком: по куску почты можно было бы
   * перебрать людей чужих клубов, а это чужие персональные данные. Пока
   * человек не в клубе, имя отдаётся сокращённым — убедиться, что нашёлся
   * нужный, этого хватает, собрать базу перебором — нет.
   */
  async lookup(
    tenantId: string,
    query: { email?: string; phone?: string },
  ): Promise<PlatformPersonLookup> {
    const filled = [query.email, query.phone].filter(Boolean);

    if (filled.length !== 1) {
      throw new BadRequestException('Ищите либо по почте, либо по телефону — целиком');
    }

    // Двое, а не один: телефон в схеме НЕ уникален — семья с одним номером
    // на всех законна, — и молча взять первого значило бы привязать к клубу
    // не того человека, а потом писать ему чужие визиты и списания.
    const users = await this.prisma.user.findMany({
      where: {
        // Почта сравнивается без учёта регистра: человек диктует её вслух, и
        // «Ivanov@» с «ivanov@» — один и тот же адрес.
        ...(query.email ? { email: { equals: query.email, mode: 'insensitive' as const } } : {}),
        ...(query.phone ? { phone: query.phone } : {}),
        // Отключённый на платформе и анонимизированный не находятся: первому
        // вход закрыт вовсе, у второго персональные данные затёрты.
        deactivatedAt: null,
        anonymizedAt: null,
      },
      select: {
        id: true,
        fullName: true,
        memberships: { where: { tenantId }, select: { tenantId: true } },
      },
      take: 2,
    });

    if (users.length === 0) {
      return { found: false, ambiguous: false, person: null };
    }

    if (users.length > 1) {
      return { found: true, ambiguous: true, person: null };
    }

    const user = users[0]!;
    const member = user.memberships.length > 0;

    return {
      found: true,
      ambiguous: false,
      person: { id: user.id, name: member ? user.fullName : shortName(user.fullName), member },
    };
  }

  /**
   * Привязать человека к клубу.
   *
   * Тем же кодом, что и первая запись: `MembershipService.ensureClient`
   * заводит привязку и анкету клиента одной транзакцией. Второй путь завёл бы
   * членство без анкеты — то есть человека, который не может ни на что
   * записаться.
   *
   * Идемпотентно: второе нажатие — то же намерение, и отвечать на него надо
   * тем же состоянием, а не ошибкой.
   */
  async attach(tenantId: string, userId: string): Promise<ClubPerson> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deactivatedAt: null, anonymizedAt: null },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('Человек не найден на платформе');
    }

    await this.membership.ensureClient(tenantId, userId);

    return (await this.card(tenantId, userId)).person;
  }

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

    const [entries, visits, player, family, coach, subscriptions] = await Promise.all([
      this.entries.listForUser(userId, tenantId),
      this.attendance.walkInsOf(tenantId, userId),
      this.players.profile(userId),
      this.family.familyOf(userId, tenantId),
      // Карточка тренера — только у тренера, и её может ещё не быть: роль
      // могли назначить минуту назад.
      membership.role === Role.COACH ? this.coaches.inClub(tenantId, userId) : null,
      this.subscriptions.forCard(tenantId, userId),
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
            // Запись по абонементу начислений не несёт: деньги пришли продажей.
            prepaid: entry.paidBy !== null,
          }),
        })),
        visits,
        new Date(),
      ),
      entries: history,
      visits,
      player,
      family,
      coach,
      subscriptions,
    };
  }
}
