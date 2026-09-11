import type { ClosurePurpose, DeskLoadHour, DeskTableBusy } from '@yenisey/types';

/**
 * Состояние зала в минутах: что занято, чем и когда освободится.
 *
 * Чистая арифметика, отделённая от базы намеренно. Отсюда берутся числа,
 * которым администратор верит не глядя — «свободно 3 из 8», «освободится в
 * 20:00», — и ошибка на границе интервала здесь не падает, а тихо отдаёт занятый
 * стол как свободный. Такое проверяется тестами, а не поднятым Postgres.
 *
 * Относительных импортов нет: тесты идут через `node --test` (см. CLAUDE.md).
 */

/** Занятый промежуток с причиной — в отличие от клиентского, где причины нет. */
export interface BusySpan {
  startMinute: number;
  endMinute: number;
  source: 'BOOKING' | 'SCHEDULE';
  purpose: ClosurePurpose;
  /** Кто за столом: клиент брони, тренер занятия, закреплённый арендатор. */
  person: string | null;
}

/**
 * Чем занят стол в указанную минуту.
 *
 * Промежуток полуоткрытый: бронь до 20:00 в 20:00 уже не занимает стол. Та же
 * семантика, что у exclusion-констрейнта в базе и у `overlaps` в closures.ts —
 * разойтись им нельзя, иначе экран покажет занятым то, что база отдаёт
 * свободным.
 *
 * Бронь важнее расписания, когда они наложились: администратор посадил
 * человека поверх запланированной тренировки, и за столом сидит именно он.
 * Показать в этом месте «тренировка» значило бы спрятать того, кто пришёл.
 */
export function busyAt(spans: readonly BusySpan[], minute: number): DeskTableBusy | null {
  const covering = spans.filter(
    (span) => span.startMinute <= minute && minute < span.endMinute,
  );

  if (covering.length === 0) {
    return null;
  }

  const chosen =
    covering.find((span) => span.source === 'BOOKING') ?? covering[0]!;

  return {
    source: chosen.source,
    purpose: chosen.purpose,
    person: chosen.person,
    // Освободится не тогда, когда кончится выбранный промежуток, а когда
    // кончатся все идущие подряд: две брони встык — это занятый стол до конца
    // второй, и «до 20:00» с последующей занятостью до 21:00 вводит в
    // заблуждение сильнее, чем отсутствие подсказки.
    untilMinute: runEnd(spans, chosen.endMinute),
  };
}

/**
 * Конец непрерывной занятости, начиная с указанной границы.
 *
 * Промежутки, начинающиеся ровно там, где кончился предыдущий, продлевают
 * занятость. Разрыв хотя бы в минуту её обрывает.
 */
function runEnd(spans: readonly BusySpan[], from: number): number {
  let end = from;
  let extended = true;

  while (extended) {
    extended = false;

    for (const span of spans) {
      if (span.startMinute <= end && span.endMinute > end) {
        end = span.endMinute;
        extended = true;
      }
    }
  }

  return end;
}

/**
 * С какой минуты стол будет занят в следующий раз после указанной.
 *
 * `null` — до конца дня больше ничего. У свободного стола это ответ на
 * вопрос «до скольки он свободен», у занятого — «есть ли за этим следующее».
 */
export function nextFrom(spans: readonly BusySpan[], minute: number): number | null {
  const upcoming = spans
    .filter((span) => span.startMinute > minute)
    .map((span) => span.startMinute);

  return upcoming.length === 0 ? null : Math.min(...upcoming);
}

/**
 * Сколько столов занято в каждый час.
 *
 * Стол считается занятым в час, если занятость перекрывает его хотя бы
 * частично: получасовая бронь в 19:30 делает стол занятым в девятнадцатом
 * часу. Считать по «занят весь час» было бы точнее арифметически и бесполезнее
 * на практике — вечерний пик из получасовых броней просто исчез бы с графика.
 */
export function loadByHour(
  perTable: readonly (readonly BusySpan[])[],
  openMinute: number,
  closeMinute: number,
): DeskLoadHour[] {
  const hours: DeskLoadHour[] = [];

  for (let hour = Math.floor(openMinute / 60); hour < Math.ceil(closeMinute / 60); hour += 1) {
    const from = hour * 60;
    const to = from + 60;

    hours.push({
      hour,
      busyTables: perTable.filter((spans) =>
        spans.some((span) => span.startMinute < to && from < span.endMinute),
      ).length,
    });
  }

  return hours;
}
