/**
 * Сетка дня глазами посетителя: чем занят каждый стол (решение владельца от
 * 24.09.2026 — «где забронировать нельзя, должно быть чётко понятно, чем
 * забронировано»).
 *
 * Чистый модуль без относительных импортов — его гоняет `node --test`. Всё
 * внешнее — окна расписания, брони, названия — приходит аргументами.
 *
 * Что наружу НЕ уходит никогда: кто арендовал стол, его телефон, цена брони,
 * причина закрытия «прочее». Сетка открыта без входа, и аренда в ней — просто
 * «Стол арендован», как табличка на столе, а не строка из журнала стойки.
 */

export type BoardBlockKind = 'RENT' | 'SPARRING' | 'TRAINING' | 'TOURNAMENT' | 'CLOSED';

export interface BoardBlock {
  startMinute: number;
  endMinute: number;
  kind: BoardBlockKind;
  /** Подпись блока: «Стол арендован», «Общая групповая», «Клуб 100». */
  title: string;
  /** Тренер занятия, «Фамилия И.». */
  subtitle: string | null;
  /** Мероприятие, на которое можно записаться, — открывает его окно. */
  event: { kind: 'TRAINING' | 'TOURNAMENT'; id: string } | null;
}

/** Окно расписания в том объёме, что нужен сетке. */
export interface BoardSlot {
  tableId: string;
  startMinute: number;
  endMinute: number;
  purpose: 'RENT' | 'SPARRING' | 'TRAINING' | 'ROBOT' | 'TOURNAMENT' | 'OTHER';
  coachId: string | null;
  trainingTypeId: string | null;
  trainingSessionId: string | null;
  tournamentId: string | null;
  tournamentTypeId: string | null;
}

export interface BoardBooking {
  tableId: string;
  startMinute: number;
  endMinute: number;
  sparring: boolean;
}

/** Названия, собранные сервисом по идентификаторам из окон. */
export interface BoardNames {
  trainingTypes: Map<string, string>;
  /** Турнир дня → название его типа. */
  tournaments: Map<string, string>;
  tournamentTypes: Map<string, string>;
  /** Тренер (userId) → «Фамилия И.». */
  coaches: Map<string, string>;
}

export const RENT_TITLE = 'Стол арендован';
export const SPARRING_TITLE = 'Спарринг';
export const CLOSED_TITLE = 'Стол занят';

/**
 * Блоки одного стола: окна расписания и брони, по времени, соседние
 * одинаковые — слитыми (занятие, закрашенное шестью получасами, — один блок).
 *
 * Бронь поверх окна расписания показывается бронью: администратор может
 * посадить человека и на закрытое время («жизнь в зале сложнее расписания»),
 * и тогда стол занят именно арендой.
 */
export function boardBlocks(slots: BoardSlot[], bookings: BoardBooking[], names: BoardNames): BoardBlock[] {
  const blocks: BoardBlock[] = [
    ...bookings.map((booking) => ({
      startMinute: booking.startMinute,
      endMinute: booking.endMinute,
      kind: (booking.sparring ? 'SPARRING' : 'RENT') as BoardBlockKind,
      title: booking.sparring ? SPARRING_TITLE : RENT_TITLE,
      subtitle: null,
      event: null,
    })),
  ];

  for (const slot of slots) {
    const view = slotView(slot, names);

    // Часть окна, не накрытая бронью: бронь важнее. Окно режется по броням,
    // а не выбрасывается целиком — тренировка до и после аренды остаётся.
    for (const piece of subtract(slot, bookings)) {
      blocks.push({ ...piece, ...view });
    }
  }

  return merge(blocks.sort((a, b) => a.startMinute - b.startMinute));
}

function slotView(slot: BoardSlot, names: BoardNames): Omit<BoardBlock, 'startMinute' | 'endMinute'> {
  if (slot.purpose === 'TRAINING') {
    const coach = slot.coachId ? names.coaches.get(slot.coachId) : undefined;

    return {
      kind: 'TRAINING',
      title: (slot.trainingTypeId && names.trainingTypes.get(slot.trainingTypeId)) || 'Тренировка',
      subtitle: coach ? `Тренер: ${coach}` : null,
      event: slot.trainingSessionId ? { kind: 'TRAINING', id: slot.trainingSessionId } : null,
    };
  }

  if (slot.purpose === 'TOURNAMENT') {
    const title =
      (slot.tournamentId && names.tournaments.get(slot.tournamentId)) ||
      (slot.tournamentTypeId && names.tournamentTypes.get(slot.tournamentTypeId)) ||
      'Турнир';

    return {
      kind: 'TOURNAMENT',
      title,
      subtitle: null,
      event: slot.tournamentId ? { kind: 'TOURNAMENT', id: slot.tournamentId } : null,
    };
  }

  if (slot.purpose === 'SPARRING') {
    return { kind: 'SPARRING', title: SPARRING_TITLE, subtitle: null, event: null };
  }

  // Аренда мимо сайта, робот и «прочее» — для посетителя одно: стол занят.
  // Причину закрытия («ремонт», «зал целиком») клуб наружу не объявлял.
  return { kind: 'CLOSED', title: CLOSED_TITLE, subtitle: null, event: null };
}

/** Промежуток минус брони того же стола — оставшиеся куски. */
function subtract(
  slot: { tableId: string; startMinute: number; endMinute: number },
  bookings: BoardBooking[],
): { startMinute: number; endMinute: number }[] {
  let pieces = [{ startMinute: slot.startMinute, endMinute: slot.endMinute }];

  for (const booking of bookings) {
    if (booking.tableId !== slot.tableId) continue;

    pieces = pieces.flatMap((piece) => {
      if (booking.endMinute <= piece.startMinute || booking.startMinute >= piece.endMinute) return [piece];

      return [
        { startMinute: piece.startMinute, endMinute: Math.max(piece.startMinute, booking.startMinute) },
        { startMinute: Math.min(piece.endMinute, booking.endMinute), endMinute: piece.endMinute },
      ].filter((part) => part.endMinute > part.startMinute);
    });
  }

  return pieces;
}

/** Соседние (стык или нахлёст) одинаковые блоки — одним. */
function merge(sorted: BoardBlock[]): BoardBlock[] {
  const merged: BoardBlock[] = [];

  for (const block of sorted) {
    const last = merged.at(-1);

    if (last && same(last, block) && block.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, block.endMinute);
    } else {
      merged.push({ ...block });
    }
  }

  return merged;
}

function same(a: BoardBlock, b: BoardBlock): boolean {
  return (
    a.kind === b.kind &&
    a.title === b.title &&
    a.subtitle === b.subtitle &&
    a.event?.id === b.event?.id &&
    a.event?.kind === b.event?.kind
  );
}
