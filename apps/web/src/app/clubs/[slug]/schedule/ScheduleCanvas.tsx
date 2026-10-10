'use client';

import type { ReactNode } from 'react';
import type { SlotRange } from '@/lib/closureGrid';
import { NightNotice, ScheduleGrid, ScheduleLegend, type BookedCell } from './ScheduleGrid';
import { SchedulePalette } from './SchedulePalette';
import type { ScheduleGridState } from './useScheduleGrid';

/**
 * То, что у шаблона недели и у дня одинаково: палитра, сетка, легенда.
 *
 * Панели над и под холстом у режимов разные — вкладки дней недели и
 * копирование у шаблона, лента дат и отвязка у дня, — поэтому холст о них не
 * знает и ставится между ними.
 */
export function ScheduleCanvas({
  grid,
  lane,
  booked,
  onPick,
  seat,
  seatPanel,
  nightCount,
  nowMinute = null,
}: {
  grid: ScheduleGridState;
  lane: string;
  /** Брони этого дня: сетка их показывает, но кистью не трогает. */
  booked?: Map<string, BookedCell>;
  /** Протяжка или щелчок выделяет промежуток под бронь вместо закраски. */
  onPick?: (pick: SlotRange) => void;
  /** Выбранное под бронь и карточка решения рядом с ним. */
  seat?: SlotRange | null;
  seatPanel?: ReactNode;
  nightCount: number;
  nowMinute?: number | null;
}) {
  return (
    <>
      {/* Число мест и клиент — только в расписании даты: занятие с лимитом и
          бронь заводятся на конкретное время, а шаблон повторяется. */}
      <SchedulePalette {...grid.palette} askCapacity={grid.day} allowClient={grid.day} />

      {grid.loading ? (
        <div
          className="h-[24rem] animate-pulse rounded-control border border-border bg-surface-sunken"
          aria-busy="true"
        />
      ) : (
        <ScheduleGrid
          tables={grid.own}
          lane={lane}
          day={grid.day}
          cells={grid.cells}
          booked={booked}
          nameOf={grid.nameOf}
          captionOf={grid.captionOf}
          colors={grid.colors}
          painting={grid.painting}
          brushValue={grid.brushValue}
          onPaint={grid.paint}
          onPick={onPick}
          seat={seat}
          seatPanel={seatPanel}
          nowMinute={nowMinute}
        />
      )}

      {!grid.loading && (
        <ScheduleLegend cells={grid.cells} lane={lane} day={grid.day} nameOf={grid.nameOf} colors={grid.colors} />
      )}

      <NightNotice count={nightCount} />
    </>
  );
}
