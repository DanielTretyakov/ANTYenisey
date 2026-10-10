import { CANCEL_REASON_MAX, CANCEL_REASON_MIN } from '@yenisey/types';

/** Проведение в том объёме, в каком его судит отмена. */
export interface CancellableEvent {
  endsAt: Date;
  cancelledAt: Date | null;
}

/** Почему отменить нельзя: 409 — уже отменено, 400 — остальное. */
export type CancelProblem =
  | { status: 409; message: string }
  | { status: 400; message: string };

/**
 * Можно ли клубу отменить занятие или турнир (решения владельца от 10.10.2026).
 *
 * Отменять можно до окончания, а не только до начала: свет отключили посреди
 * занятия — неотмеченные записи отменяются с возвратом, отмеченные остаются.
 * После окончания отменять нечего: остались отметки, и их правит смена.
 *
 * Причина обязательна — её прочтёт каждый записавшийся. Границы — те же, что
 * у CHECK `*_cancel_explained`, по обрезанной строке: «  » — не причина.
 */
export function cancelProblem(event: CancellableEvent, now: Date, reason: string): CancelProblem | null {
  if (event.cancelledAt) {
    return { status: 409, message: 'Уже отменено' };
  }

  if (event.endsAt.getTime() <= now.getTime()) {
    return { status: 400, message: 'Уже закончилось — отменять нечего, отметки правятся на смене' };
  }

  const trimmed = reason.trim();

  if (trimmed.length < CANCEL_REASON_MIN) {
    return { status: 400, message: 'Напишите причину — её получат записавшиеся' };
  }

  if (trimmed.length > CANCEL_REASON_MAX) {
    return { status: 400, message: `Причина длиннее ${CANCEL_REASON_MAX} знаков — сократите` };
  }

  return null;
}
