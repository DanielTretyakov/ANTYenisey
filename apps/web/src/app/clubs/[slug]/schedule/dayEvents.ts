import type { ClosureSlot, DayClosureDraft } from '@yenisey/types';
import { ApiError, type clubApi } from '@/lib/api';
import { formatMinute } from '@/lib/bookingGrid';
import { planDayEvents, toDayClosureDraft, type EventRef } from '@/lib/closureGrid';
import { zonedToInstant } from '@/lib/timezones';

/**
 * Заведение турниров и занятий под окна, которые администратор разметил.
 *
 * Что заводить и на что сослаться каждому окну, решает чистая `planDayEvents`
 * (`lib/closureGrid.ts`, под тестами): турнир — один на тип в дне, занятие —
 * одно на связный отрезок времени пары «тип + тренер», продление заведённой
 * группы идёт к ней. Здесь — только исполнение плана запросами.
 *
 * Мероприятия пишутся ДО `replaceDay`, и если тот упадёт, они останутся без
 * окна. Лечится это переносом заведения на сервер, в транзакцию дня; до тех
 * пор осиротевшее мероприятие видно в каталоге с пометкой «не в сетке», и
 * удалить его там можно.
 *
 * `saved` — окна дня до правки: по ним узнаются турнир и группа, которые
 * стёрли и тут же нарисовали заново, — чтобы не завести их вторыми.
 */
export async function resolveEvents(
  // Клиент API приходит аргументом: это обычная функция, хук в ней вызвать
  // нельзя, а мероприятие заводится в конкретном клубе.
  club: ReturnType<typeof clubApi>,
  slots: readonly ClosureSlot[],
  saved: readonly ClosureSlot[],
  day: { date: string; timezone: string; capacity: number },
): Promise<DayClosureDraft[]> {
  const { date, timezone, capacity } = day;
  const plan = planDayEvents(slots, saved);

  const instant = (minute: number, what: string): string => {
    const at = zonedToInstant(date, formatMinute(minute), timezone);

    if (!at) {
      throw new ApiError(`Не удалось определить время начала: ${what}`, 400);
    }

    return at.toISOString();
  };

  const tournamentIds: string[] = [];

  // Окончание сервер потом подтянет по всем окнам турнира при сохранении дня;
  // здесь — границы окон этого дня, чтобы турнир не заводился без них.
  for (const tournament of plan.tournaments) {
    const created = await club.createTournament({
      tournamentTypeId: tournament.tournamentTypeId,
      startsAt: instant(tournament.startMinute, 'турнир'),
      endsAt: instant(tournament.endMinute, 'турнир'),
    });

    tournamentIds.push(created.id);
  }

  const sessionIds: string[] = [];

  for (const session of plan.sessions) {
    const created = await club.createTrainingSession({
      trainingTypeId: session.trainingTypeId,
      coachId: session.coachId,
      startsAt: instant(session.startMinute, 'занятие'),
      endsAt: instant(session.endMinute, 'занятие'),
      capacity,
    });

    sessionIds.push(created.id);
  }

  const idOf = (ref: EventRef | null, created: string[]): string | null =>
    ref === null ? null : 'id' in ref ? ref.id : (created[ref.create] ?? null);

  return plan.slots.map(({ slot, tournament, session }) =>
    toDayClosureDraft({
      ...slot,
      // Тип турнира у окна даты не хранится — там уже есть проведение.
      tournamentTypeId: null,
      tournamentId: idOf(tournament, tournamentIds),
      trainingSessionId: idOf(session, sessionIds),
    }),
  );
}
