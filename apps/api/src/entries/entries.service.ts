import { Injectable } from '@nestjs/common';
import { BookingStatus } from '@yenisey/database';
import type { BookingEntry, ClubRef, PaidBySubscription } from '@yenisey/types';
import { shortName } from '@yenisey/types';
import { cancellationOpen, cancellationPercent } from '../booking/availability';
import { PrismaService } from '../prisma/prisma.service';
import { subscriptionCancelRatio } from '../subscriptions/subscription-rules';

/**
 * Записи человека: аренда столов, занятия и турниры одним списком.
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

    const [tables, trainings, tournaments, tiers] = await Promise.all([
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
      this.prisma.trainingBooking.findMany({
        where: { clientId: userId, ...scope },
        select: {
          id: true,
          priceAtBooking: true,
          status: true,
          chargeRatio: true,
          tenant: CLUB_SELECT,
          subscription: SUBSCRIPTION_SELECT,
          session: {
            select: {
              id: true,
              startsAt: true,
              endsAt: true,
              trainingType: { select: { name: true } },
              coach: {
                select: { membership: { select: { user: { select: { fullName: true } } } } },
              },
            },
          },
        },
      }),
      this.prisma.tournamentRegistration.findMany({
        where: { clientId: userId, ...scope },
        select: {
          id: true,
          priceAtBooking: true,
          status: true,
          chargeRatio: true,
          tenant: CLUB_SELECT,
          subscription: SUBSCRIPTION_SELECT,
          tournament: {
            select: {
              id: true,
              startsAt: true,
              endsAt: true,
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
        entryId: booking.id,
        kind: 'TABLE' as const,
        club: clubOf(booking.tenant),
        softRule: booking.tenant.subscriptionBurnsOnNoShowOnly,
        paidBy: null,
        title: booking.withRobot ? 'Аренда стола с роботом' : 'Аренда стола',
        subtitle: `${booking.table.hall.name}, ${booking.table.label}`,
        startsAt: booking.startsAt.toISOString(),
        endsAt: booking.endsAt.toISOString(),
        price: booking.priceAtBooking,
        status: booking.status,
        chargeRatio: booking.chargeRatio,
      })),
      ...trainings.map((booking) => ({
        // Идентификатор ЗАНЯТИЯ, а не строки записи — по той же причине, что у
        // турнира: по нему идёт отмена, и человеку в списке нужен адрес
        // действия.
        id: booking.session.id,
        entryId: booking.id,
        kind: 'TRAINING' as const,
        club: clubOf(booking.tenant),
        softRule: booking.tenant.subscriptionBurnsOnNoShowOnly,
        paidBy: paidByOf(booking.subscription),
        title: booking.session.trainingType.name,
        subtitle: `Тренер: ${shortName(booking.session.coach.membership.user.fullName)}`,
        startsAt: booking.session.startsAt.toISOString(),
        endsAt: booking.session.endsAt.toISOString(),
        price: booking.priceAtBooking,
        status: booking.status,
        chargeRatio: booking.chargeRatio,
      })),
      ...tournaments.map((registration) => ({
        // Идентификатор ТУРНИРА, а не строки регистрации: по нему идёт отмена
        // (DELETE /clubs/:slug/tournaments/:id/registration), и человеку в
        // списке нужен именно адрес действия.
        id: registration.tournament.id,
        entryId: registration.id,
        kind: 'TOURNAMENT' as const,
        club: clubOf(registration.tenant),
        softRule: registration.tenant.subscriptionBurnsOnNoShowOnly,
        paidBy: paidByOf(registration.subscription),
        title: titleOf(
          registration.tournament.tournamentType.name,
          registration.tournament.tournamentType.ratingLabel,
        ),
        subtitle: null,
        startsAt: registration.tournament.startsAt.toISOString(),
        endsAt: registration.tournament.endsAt.toISOString(),
        price: registration.priceAtBooking,
        status: registration.status,
        chargeRatio: registration.chargeRatio,
      })),
    ].map(({ chargeRatio, softRule, ...entry }) => {
      const cancellable =
        entry.status === BookingStatus.BOOKED && cancellationOpen(new Date(entry.startsAt), new Date());

      // Сколько спишется при отмене прямо сейчас — вопрос, на который человек
      // должен получить ответ ДО нажатия кнопки, а не после. Ступени берутся
      // по клубу записи: политика отмены у каждого клуба своя.
      const percentNow = cancellable
        ? cancellationPercent(tiers.get(entry.club.slug) ?? [], minutesUntil(new Date(entry.startsAt)))
        : null;

      // У записи по абонементу отмена стоит не денег, а визита: вернётся он
      // или сгорит — по тому же правилу, что применит сама отмена.
      const byVisit = entry.paidBy !== null;

      return {
        ...entry,
        chargePercent: chargeRatio,
        cancellable,
        cancelChargePercentNow: byVisit ? null : percentNow,
        cancelOutcome:
          byVisit && percentNow !== null
            ? subscriptionCancelRatio(softRule, percentNow) === 100
              ? ('BURN' as const)
              : ('REFUND' as const)
            : null,
      };
    });

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

/**
 * Клуб записи: минимум, которого хватает, чтобы его назвать и открыть, —
 * плюс его правило абонемента, чтобы ответить, что будет с визитом при отмене.
 */
const CLUB_SELECT = {
  select: { slug: true, name: true, accentColor: true, subscriptionBurnsOnNoShowOnly: true },
} as const;

const SUBSCRIPTION_SELECT = {
  select: { id: true, plan: { select: { name: true } } },
} as const;

function clubOf(tenant: ClubRef): ClubRef {
  return { slug: tenant.slug, name: tenant.name, accentColor: tenant.accentColor };
}

function paidByOf(sub: { id: string; plan: { name: string } } | null): PaidBySubscription | null {
  return sub ? { subscriptionId: sub.id, planName: sub.plan.name } : null;
}

/** Сколько минут осталось до момента. Отрицательное — момент уже прошёл. */
function minutesUntil(instant: Date): number {
  return Math.floor((instant.getTime() - Date.now()) / 60_000);
}
