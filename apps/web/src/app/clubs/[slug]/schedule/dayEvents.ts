import type { ClosureSlot, DayClosureDraft } from '@yenisey/types';
import { ApiError, type clubApi } from '@/lib/api';
import { formatMinute } from '@/lib/bookingGrid';
import { toDayClosureDraft } from '@/lib/closureGrid';
import { zonedToInstant } from '@/lib/timezones';

/**
 * Заведение турниров и занятий под окна, которые администратор разметил.
 *
 * Мероприятие создаётся не мазком кисти, а сохранением: иначе база
 * наполнялась бы турнирами, которые тут же стёрли. Один турнир на тип и дату;
 * одно занятие на пару «тип + тренер» — групповое занятие идёт сразу на
 * нескольких столах, и заводить его на каждый стол значило бы показать группе
 * из десяти человек четыре разных занятия.
 *
 * **Занятия — только по тронутым окнам** (`touched`). День, отвязанный от
 * шаблона, полон окон с типом тренировки, но без занятия, — и без этого
 * условия первая же правка одной клетки аренды завела бы занятия, открытые для
 * записи, сразу на все такие окна.
 * Отличить их по полям нельзя: скопированное из шаблона и только что
 * нарисованное выглядят одинаково. Отличает их только то, коснулся ли их
 * администратор в этой правке.
 *
 * Мероприятия пишутся ДО `replaceDay`, и если тот упадёт, они останутся без
 * окна. Лечится это переносом заведения на сервер, в транзакцию дня; до тех
 * пор осиротевшее мероприятие видно в каталоге с пометкой «не в сетке», и
 * удалить его там можно.
 */
export async function resolveEvents(
  // Клиент API приходит аргументом: это обычная функция, хук в ней вызвать
  // нельзя, а мероприятие заводится в конкретном клубе.
  club: ReturnType<typeof clubApi>,
  closures: (ClosureSlot & { touched: boolean })[],
  day: { date: string; timezone: string; capacity: number },
  onCreated: () => void,
): Promise<DayClosureDraft[]> {
  const { date, timezone, capacity } = day;

  const instant = (minute: number, what: string): string => {
    const at = zonedToInstant(date, formatMinute(minute), timezone);

    if (!at) {
      throw new ApiError(`Не удалось определить время начала: ${what}`, 400);
    }

    return at.toISOString();
  };

  // --- Турниры: один на тип и дату.
  //
  // Здесь условия «тронуто» нет, и это не упущение, а требование базы: окно
  // турнира в расписании даты обязано ссылаться на само проведение
  // (`DayClosure_attachments_match_purpose`), а типа турнира у окна даты нет
  // вовсе. Турнирное окно из шаблона без проведения база просто не примет. Та же
  // логика у серверной отвязки дня: турнир в шаблоне — это «каждую субботу
  // Клуб 100», и зафиксировать субботу значит завести её Клуб 100.
  const pendingTournaments = closures.filter(
    (slot) => slot.purpose === 'TOURNAMENT' && !slot.tournamentId && slot.tournamentTypeId,
  );

  const tournaments = new Map<string, string>();

  for (const typeId of new Set(pendingTournaments.map((slot) => slot.tournamentTypeId!))) {
    const own = pendingTournaments.filter((slot) => slot.tournamentTypeId === typeId);

    const tournament = await club.createTournament({
      tournamentTypeId: typeId,
      startsAt: instant(Math.min(...own.map((slot) => slot.startMinute)), 'турнир'),
    });

    tournaments.set(typeId, tournament.id);
  }

  // --- Занятия: одно на пару «тип + тренер».
  //
  // Границы — по всем тронутым окнам пары, от самого раннего начала до самого
  // позднего конца: именно этот отрезок администратор и разметил.
  const pendingSessions = closures.filter(
    (slot) =>
      slot.purpose === 'TRAINING' && !slot.trainingSessionId && slot.trainingTypeId && slot.touched,
  );

  const sessions = new Map<string, string>();
  const sessionKey = (slot: Pick<ClosureSlot, 'trainingTypeId' | 'coachId'>): string =>
    `${slot.trainingTypeId}|${slot.coachId}`;

  for (const key of new Set(pendingSessions.map(sessionKey))) {
    const own = pendingSessions.filter((slot) => sessionKey(slot) === key);
    const first = own[0]!;

    const session = await club.createTrainingSession({
      trainingTypeId: first.trainingTypeId!,
      coachId: first.coachId!,
      startsAt: instant(Math.min(...own.map((slot) => slot.startMinute)), 'занятие'),
      endsAt: instant(Math.max(...own.map((slot) => slot.endMinute)), 'занятие'),
      capacity,
    });

    sessions.set(key, session.id);
  }

  if (tournaments.size > 0 || sessions.size > 0) {
    onCreated();
  }

  return closures.map((slot) =>
    toDayClosureDraft({
      ...slot,
      // Тип турнира у окна даты не хранится — там уже есть проведение.
      tournamentTypeId: null,
      tournamentId:
        slot.tournamentId ??
        (slot.tournamentTypeId ? (tournaments.get(slot.tournamentTypeId) ?? null) : null),
      trainingSessionId:
        slot.trainingSessionId ??
        (slot.purpose === 'TRAINING' && slot.touched ? (sessions.get(sessionKey(slot)) ?? null) : null),
    }),
  );
}
