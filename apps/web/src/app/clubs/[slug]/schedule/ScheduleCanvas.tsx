'use client';

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
  askCapacity,
  allowClient = false,
  booked,
  onRange,
  nightCount,
  nowMinute = null,
}: {
  grid: ScheduleGridState;
  lane: string;
  /**
   * Спрашивать ли число мест. Только в дне: занятие с лимитом заводится из
   * расписания даты, а шаблон повторяется и конкретного занятия не несёт.
   */
  askCapacity: boolean;
  /** Сажать ли клиента кистью аренды — только в расписании даты. */
  allowClient?: boolean;
  /** Брони этого дня: сетка их показывает, но кистью не трогает. */
  booked?: Map<string, BookedCell>;
  /** Протяжка выделяет промежуток под бронь вместо закраски. */
  onRange?: (tableId: string, startSlot: number, endSlot: number) => void;
  nightCount: number;
  nowMinute?: number | null;
}) {
  return (
    <>
      <SchedulePalette {...grid.palette} askCapacity={askCapacity} allowClient={allowClient} />

      {grid.loading ? (
        <div
          className="h-[24rem] animate-pulse rounded-control border border-border bg-surface-sunken"
          aria-busy="true"
        />
      ) : (
        <ScheduleGrid
          tables={grid.own}
          lane={lane}
          cells={grid.cells}
          booked={booked}
          nameOf={grid.nameOf}
          captionOf={grid.captionOf}
          colors={grid.colors}
          painting={grid.painting}
          brushValue={grid.brushValue}
          onPaint={grid.paint}
          onRange={onRange}
          nowMinute={nowMinute}
        />
      )}

      {!grid.loading && (
        <ScheduleLegend cells={grid.cells} lane={lane} nameOf={grid.nameOf} colors={grid.colors} />
      )}

      <NightNotice count={nightCount} />
    </>
  );
}
