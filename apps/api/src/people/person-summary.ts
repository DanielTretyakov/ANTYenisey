import type { BookingStatus, ClubPersonSummary } from '@yenisey/types';

/**
 * Сводка человека по клубу: визиты, неявки, отмены, начислено.
 *
 * Чистая арифметика, отделённая от базы: это первое, что администратор видит
 * в карточке, и по ней он решает, сажать ли человека без предоплаты. Цифра,
 * разошедшаяся со списком под ней, хуже отсутствующей — поэтому она считается
 * по тем же записям, что показаны, и проверяется тестами.
 *
 * Относительных импортов нет намеренно: модуль гоняется через `node --test`
 * (см. CLAUDE.md). Деньги приходят уже посчитанными — считает их `chargeOf`
 * из `desk/revenue.ts`, чтобы карточка и деньги дня не разошлись в правилах.
 */

/** Запись в том объёме, в каком она попадает в сводку. */
export interface SummaryEntry {
  status: BookingStatus;
  /** Момент начала в ISO. */
  startsAt: string;
  /** Начислено по этой записи, копейки. */
  charged: number;
}

/** Визит с порога: у него нет записи, но человек в клубе был. */
export interface SummaryVisit {
  visitedAt: string;
}

export function personSummary(
  entries: readonly SummaryEntry[],
  visits: readonly SummaryVisit[],
  now: Date,
): ClubPersonSummary {
  const summary: ClubPersonSummary = {
    visits: visits.length,
    noShows: 0,
    cancellations: 0,
    lateCancellations: 0,
    upcoming: 0,
    accrued: 0,
    lastVisitAt: null,
  };

  const wasHere: string[] = visits.map((visit) => visit.visitedAt);

  for (const entry of entries) {
    // Начислено — по СОСТОЯВШЕМУСЯ: пришёл, не пришёл, отменил. Будущая
    // бронь денег клубу ещё не принесла, и складывать её в общий итог значит
    // показать администратору сумму, которой нет. У дня на смене правило
    // другое и это не противоречие: там день идёт прямо сейчас, и «записан»
    // — это человек, который вот-вот придёт.
    if (entry.status !== 'BOOKED') {
      summary.accrued += entry.charged;
    }

    switch (entry.status) {
      case 'ATTENDED':
        summary.visits += 1;
        wasHere.push(entry.startsAt);
        break;

      case 'NO_SHOW':
        summary.noShows += 1;
        break;

      case 'CANCELLED':
        summary.cancellations += 1;
        // Поздняя — та, за которую по политике клуба списали процент. Считать
        // её по времени отмены значило бы завести второй расчёт рядом с тем,
        // который уже зафиксирован в записи.
        if (entry.charged > 0) summary.lateCancellations += 1;
        break;

      case 'BOOKED':
        // Начавшаяся, но не отмеченная запись «предстоящей» не считается: она
        // ждёт отметки клуба, и обещать по ней человека в зале нельзя.
        if (Date.parse(entry.startsAt) > now.getTime()) summary.upcoming += 1;
        break;
    }
  }

  // Последний визит — самый свежий из состоявшихся. Будущее сюда не попадает
  // по построению: у записи, которая ещё не началась, отметки нет.
  summary.lastVisitAt = wasHere.sort().at(-1) ?? null;

  return summary;
}
