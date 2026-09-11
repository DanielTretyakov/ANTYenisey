'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  ClosureRule,
  ClosureRuleDraft,
  ClubCoach,
  ClubTable,
  Tournament,
  TournamentType,
  TrainingType,
  Weekday,
} from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Tab } from '@/components/ui/Tab';
import { ApiError } from '@/lib/api';
import {
  cellsToSlots,
  copyLane,
  countOnLane,
  slotsToCells,
  splitByGrid,
  toClosureRuleDraft,
  WEEKDAYS,
  WORKDAYS,
} from '@/lib/closureGrid';
import { useClubApi } from '@/lib/useClubApi';
import { ScheduleCanvas } from './ScheduleCanvas';
import { useScheduleGrid } from './useScheduleGrid';

const LANES = WEEKDAYS.map((day) => String(day.value));

/**
 * Шаблон недели: как зал живёт обычно.
 *
 * Семь дорожек — по одной на день недели. Турнир здесь хранится типом, а не
 * проведением: у повторяющегося окна даты нет, и конкретный турнир заводится,
 * когда администратор открывает дату.
 */
export function TemplateBoard({
  hallId,
  tables,
  coaches,
  trainingTypes,
  tournamentTypes,
  tournaments,
}: {
  hallId: string;
  tables: ClubTable[];
  coaches: ClubCoach[];
  trainingTypes: TrainingType[];
  tournamentTypes: TournamentType[];
  tournaments: Tournament[];
}) {
  const club = useClubApi();
  const [weekday, setWeekday] = useState<Weekday>(1);
  const lane = String(weekday);

  const grid = useScheduleGrid({
    hallId,
    lane,
    tables,
    coaches,
    trainingTypes,
    tournamentTypes,
    tournaments,
  });

  /** Ночные окна (до 06:00) в сетку не попадают и уезжают обратно нетронутыми. */
  const [night, setNight] = useState<ClosureRuleDraft[]>([]);

  const { accept, setError, setLoading, setPending } = grid;

  const show = useCallback(
    (rules: ClosureRule[]): void => {
      const split = splitByGrid(rules);

      setNight(split.night.map((rule) => toClosureRuleDraft(rule, rule.weekday)));
      accept(slotsToCells(split.inGrid, (slot) => String((slot as ClosureRule).weekday)));
    },
    [accept],
  );

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    club
      .template(hallId)
      .then((rules) => {
        if (!cancelled) show(rules);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [club, hallId, show, setError, setLoading]);

  async function save(): Promise<void> {
    setError(null);
    setPending(true);

    try {
      // Тип турнира в шаблоне сохраняется как есть: конкретное проведение
      // заводится позже, когда администратор откроет эту дату.
      const rules = cellsToSlots(grid.cells, LANES, grid.tableIds).map((slot) =>
        toClosureRuleDraft(slot, Number(slot.lane) as Weekday),
      );

      show(await club.replaceTemplate(hallId, [...night, ...rules]));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  if (grid.own.length === 0) {
    return <NoTables />;
  }

  return (
    <>
      <p className="mb-4 max-w-2xl text-[0.875rem] text-text-muted">
        Как зал живёт обычно. Правка шаблона действует на все дни, которые не отвязаны от него
        в режиме «День».
      </p>

      {grid.error && <Alert>{grid.error}</Alert>}

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="День недели">
        {WEEKDAYS.map((day) => {
          const count = countOnLane(grid.cells, String(day.value));

          return (
            <Tab
              key={day.value}
              inTablist
              active={weekday === day.value}
              onClick={() => setWeekday(day.value)}
              title={day.full}
              // Счётчик закрашенных клеток виден на вкладке, чтобы пустой день
              // недели был заметен, не открывая его.
              badge={count > 0 ? count : null}
            >
              {day.short}
            </Tab>
          );
        })}
      </div>

      <ScheduleCanvas grid={grid} lane={lane} askCapacity={false} nightCount={night.length} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => grid.setCells(copyLane(grid.cells, lane, WORKDAYS.map(String), grid.tableIds))}
        >
          Скопировать на все будни
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => grid.setCells(copyLane(grid.cells, lane, LANES, grid.tableIds))}
        >
          На всю неделю
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={grid.clearLane}>
          Очистить день недели
        </Button>

        <span className="ml-auto flex items-center gap-3">
          {grid.dirty && (
            <span className="text-[0.8125rem] text-text-subtle">Есть несохранённые правки</span>
          )}
          <Button
            type="button"
            pending={grid.pending}
            disabled={!grid.dirty}
            onClick={() => void save()}
          >
            Сохранить шаблон
          </Button>
        </span>
      </div>
    </>
  );
}

export function NoTables() {
  return (
    <p className="text-[0.9375rem] text-text-muted">
      В этом зале нет столов — составлять расписание пока не для чего. Столы заводятся в разделе
      «Настройки».
    </p>
  );
}

export function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'Сервис недоступен, попробуйте позже';
}
