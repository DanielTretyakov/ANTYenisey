import { Injectable } from '@nestjs/common';
import { BookingStatus } from '@yenisey/database';
import type { BookingEntry } from '@yenisey/types';
import { cancellationPercent } from '../booking/availability';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Записи человека: аренда столов и участие в турнирах одним списком.
 *
 * Сервис ОДИН на два экрана — раздел «Мои записи» по всем клубам и блок «Мои
 * мероприятия» на странице клуба. Это не экономия строк: два независимых
 * списка записей разошлись бы в поведении отмены и в том, что каждый из них
 * показывает, — ровно то, от чего предостерегает ТЗ, требуя убрать список
 * записей из личного кабинета целиком.
 *
 * Аренда стола попадает в «мои», но не в публичные списки клуба: к чужой броне
 * стола нельзя присоединиться (ТЗ → «Страница клуба»).
 */
@Injectable()
export class EntriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Все записи человека, ближайшие сверху.
   *
   * `tenantId` сужает выборку до одного клуба — для страницы клуба. Без него
   * собираются все клубы: аккаунт один, и человеку незачем обходить три
   * клубные страницы, чтобы увидеть расписание своей недели.
   */
  async listForUser(userId: string, tenantId?: string): Promise<BookingEntry[]> {
    const scope = tenantId ? { tenantId } : {};

    const [tables, tournaments, tiers] = await Promise.all([
      this.prisma.tableBooking.findMany({
        where: { clientId: userId, ...scope },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          withRobot: true,
          priceAtBooking: true,
          status: true,
          chargeRatio: true,
          tenant: CLUB_SELECT,
          table: { select: { label: true, hall: { select: { name: true } } } },
        },
      }),
      this.prisma.tournamentRegistration.findMany({
        where: { clientId: userId, ...scope },
        select: {
          priceAtBooking: true,
          status: true,
          chargeRatio: true,
          tenant: CLUB_SELECT,
          tournament: {
            select: {
              id: true,
              startsAt: true,
              tournamentType: { select: { name: true, ratingLabel: true } },
            },
          },
        },
      }),
      this.cancellationTiers(tenantId),
    ]);

    const entries: BookingEntry[] = [
      ...tables.map((booking) => ({
        id: booking.id,
        kind: 'TABLE' as const,
        club: booking.tenant,
        title: booking.withRobot ? 'Аренда стола с роботом' : 'Аренда стола',
        subtitle: `${booking.table.hall.name}, ${booking.table.label}`,
        startsAt: booking.startsAt.toISOString(),
        endsAt: booking.endsAt.toISOString(),
        price: booking.priceAtBooking,
        status: booking.status,
        chargeRatio: booking.chargeRatio,
      })),
      ...tournaments.map((registration) => ({
        // Идентификатор ТУРНИРА, а не строки регистрации: по нему идёт отмена
        // (DELETE /clubs/:slug/tournaments/:id/registration), и человеку в
        // списке нужен именно адрес действия.
        id: registration.tournament.id,
        kind: 'TOURNAMENT' as const,
        club: registration.tenant,
        title: titleOf(
          registration.tournament.tournamentType.name,
          registration.tournament.tournamentType.ratingLabel,
        ),
        subtitle: null,
        startsAt: registration.tournament.startsAt.toISOString(),
        // У турнира окончание в схеме не задано: известен только момент начала.
        endsAt: null,
        price: registration.priceAtBooking,
        status: registration.status,
        chargeRatio: registration.chargeRatio,
      })),
    ].map(({ chargeRatio, ...entry }) => ({
      ...entry,
      chargePercent: chargeRatio,
      // Сколько спишется при отмене прямо сейчас — вопрос, на который человек
      // должен получить ответ ДО нажатия кнопки, а не после. Ступени берутся
      // по клубу записи: политика отмены у каждого клуба своя.
      cancelChargePercentNow:
        entry.status === BookingStatus.BOOKED
          ? cancellationPercent(
              tiers.get(entry.club.slug) ?? [],
              minutesUntil(new Date(entry.startsAt)),
            )
          : null,
    }));

    // Ближайшие сверху. Прошедшие оказываются внизу сами — их момент меньше;
    // делить список на «предстоящие» и «историю» решает интерфейс, а не
    // сервер: граница проходит по «сейчас», и она у него та же.
    return entries.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  /**
   * Ступени политики отмены по клубам, ключ — код клуба.
   *
   * Одним запросом на все клубы записей: раздел «Мои записи» собирает три
   * клуба сразу, и поход в базу за ступенями каждого из них превратил бы один
   * экран в четыре запроса.
   */
  private async cancellationTiers(
    tenantId?: string,
  ): Promise<Map<string, { minMinutesBeforeStart: number; chargePercent: number }[]>> {
    const rows = await this.prisma.cancellationTier.findMany({
      where: tenantId ? { tenantId } : {},
      select: {
        minMinutesBeforeStart: true,
        chargePercent: true,
        tenant: { select: { slug: true } },
      },
    });

    const byClub = new Map<string, { minMinutesBeforeStart: number; chargePercent: number }[]>();

    for (const row of rows) {
      const list = byClub.get(row.tenant.slug) ?? [];
      list.push({
        minMinutesBeforeStart: row.minMinutesBeforeStart,
        chargePercent: row.chargePercent,
      });
      byClub.set(row.tenant.slug, list);
    }

    return byClub;
  }
}

/**
 * Название турнира в строке расписания.
 *
 * Справочное число-ограничение по рейтингу дописывается, только если его нет в
 * самом названии. У «Енисея» типы называются «Клуб 100», «Клуб 200» — то есть
 * число уже в названии, и приписка давала бы «Клуб 100 (100)».
 */
function titleOf(name: string, ratingLabel: string | null): string {
  return ratingLabel && !name.includes(ratingLabel) ? `${name} (${ratingLabel})` : name;
}

/** Клуб записи: минимум, которого хватает, чтобы его назвать и открыть. */
const CLUB_SELECT = {
  select: { slug: true, name: true, accentColor: true },
} as const;

/** Сколько минут осталось до момента. Отрицательное — момент уже прошёл. */
function minutesUntil(instant: Date): number {
  return Math.floor((instant.getTime() - Date.now()) / 60_000);
}
