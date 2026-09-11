import type {
  AttendanceKind,
  AttendancePhase,
  BookingStatus,
  DeskDay,
  DeskMarkInfo,
  DeskPerson,
  MarkAttendanceRequest,
} from '@yenisey/types';

/**
 * Отметка присутствия на экране смены — то, что считается без React.
 *
 * Отдельным модулем ради тестов: сколько ждёт отметки, что предложить при
 * исправлении и как назвать отметку — ошибка в этом показывает администратору
 * не ту цифру или не ту кнопку, а за кнопкой здесь деньги.
 *
 * Относительных импортов нет: модуль гоняется через `node --test` (см.
 * CLAUDE.md).
 */

/** Сколько записей ждёт отметки и сколько из них просрочено. */
export function pendingCounts(pending: DeskDay['pending']): { total: number; overdue: number } {
  let total = 0;
  let overdue = 0;

  for (const booking of pending.bookings) {
    total += 1;
    if (booking.phase === 'OVERDUE') overdue += 1;
  }

  for (const event of pending.events) {
    const waiting = event.participants.filter((entry) => entry.status === 'BOOKED').length;
    total += waiting;
    if (event.phase === 'OVERDUE') overdue += waiting;
  }

  return { total, overdue };
}

/** Подпись фазы у того, что ждёт отметки. Ранней фазы в этом списке не бывает. */
export const PHASE_LABELS: Record<AttendancePhase, string> = {
  UPCOMING: 'ещё не началось',
  ONGOING: 'идёт',
  AWAITING: 'закончилось',
  OVERDUE: 'просрочено',
};

/** Как назвать отметку, которая стоит у записи. */
export function markLabel(status: BookingStatus, chargePercent: number | null): string {
  switch (status) {
    case 'ATTENDED':
      return 'пришёл';
    case 'NO_SHOW':
      // Процент — снимок в момент отметки. Пустой бывает только у строк,
      // отмеченных до появления отметки в продукте, и считается полным.
      return chargePercent === 0 ? 'неявка без списания' : `неявка, списано ${chargePercent ?? 100}%`;
    case 'CANCELLED':
      return 'отменена';
    case 'BOOKED':
      return 'ждёт отметки';
  }
}

/** Вариант исправления уже поставленной отметки. */
export interface Correction {
  key: 'ATTENDED' | 'NO_SHOW' | 'WAIVE';
  label: string;
  request: Omit<MarkAttendanceRequest, 'reason'>;
}

/**
 * Во что можно исправить отметку.
 *
 * Только в то, что отличается от нынешней: «исправить на то же самое» сервер
 * ответит «ничего не изменилось», и кнопка, которая ничего не делает, —
 * хуже её отсутствия. Вернуть в «не отмечено» нельзя вовсе.
 */
export function correctionsFor(
  status: BookingStatus,
  chargePercent: number | null,
  noShowChargePercent: number,
): Correction[] {
  const attended: Correction = { key: 'ATTENDED', label: 'пришёл', request: { status: 'ATTENDED' } };
  const noShow: Correction = {
    key: 'NO_SHOW',
    label: `неявка, списать ${noShowChargePercent}%`,
    request: { status: 'NO_SHOW' },
  };
  const waive: Correction = {
    key: 'WAIVE',
    label: 'неявка без списания',
    request: { status: 'NO_SHOW', waiveCharge: true },
  };

  if (status === 'ATTENDED') {
    return [noShow, waive];
  }

  if (status === 'NO_SHOW') {
    return chargePercent === 0 ? [attended, noShow] : [attended, waive];
  }

  return [];
}

/** Строка «Отмечено в этот день»: бронь или участник мероприятия. */
export interface MarkedRow {
  key: string;
  kind: AttendanceKind;
  entryId: string;
  person: DeskPerson;
  /** Что это было: «аренда · Стол 3», «Общая групповая». */
  what: string;
  startsAt: string;
  status: BookingStatus;
  chargePercent: number | null;
  mark: DeskMarkInfo | null;
}

/**
 * Всё отмеченное за день зала — брони и участники мероприятий одним списком.
 *
 * По времени начала: администратор разбирает день так, как он шёл.
 */
export function markedRows(day: Pick<DeskDay, 'bookings' | 'events'>): MarkedRow[] {
  const marked = (status: BookingStatus): boolean => status === 'ATTENDED' || status === 'NO_SHOW';
  const rows: MarkedRow[] = [];

  for (const booking of day.bookings) {
    if (!marked(booking.status)) continue;

    rows.push({
      key: `TABLE-${booking.id}`,
      kind: 'TABLE',
      entryId: booking.id,
      person: booking.client,
      what: `${booking.withRobot ? 'робот' : 'аренда'} · ${booking.tableLabel}`,
      startsAt: booking.startsAt,
      status: booking.status,
      chargePercent: booking.chargePercent,
      mark: booking.mark,
    });
  }

  for (const event of day.events) {
    for (const entry of event.participants) {
      if (!marked(entry.status)) continue;

      rows.push({
        key: `${event.kind}-${entry.entryId}`,
        kind: event.kind,
        entryId: entry.entryId,
        person: entry,
        what: event.title,
        startsAt: event.startsAt,
        status: entry.status,
        chargePercent: entry.chargePercent,
        mark: entry.mark,
      });
    }
  }

  return rows.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.key.localeCompare(b.key));
}
