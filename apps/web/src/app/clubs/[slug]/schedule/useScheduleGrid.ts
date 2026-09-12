'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ClubCoach,
  ClubPerson,
  ClubTable,
  Tournament,
  TournamentType,
  TrainingType,
} from '@yenisey/types';
import { cellKey, personOf, sameCells, type CellValue, type Cells } from '@/lib/closureGrid';
import { personColors } from '@/lib/personColor';
import { useClubApi } from '@/lib/useClubApi';
import { attachmentOf, ERASER, type Brush } from './SchedulePalette';

/**
 * Общее ядро сетки расписания: клетки, кисть, закраска.
 *
 * Хук, а не компонент-обёртка. Обёртке пришлось бы отдать наружу ровно то же
 * самое — клетки, закраску, цвета, — только через render-проп, и вдобавок
 * продиктовать раскладку: у дня лента дат стоит над палитрой, а «Вернуть день
 * к шаблону» — под сеткой, у шаблона — вкладки дней недели и копирование. Хук
 * отдаёт объект и в раскладку не лезет.
 *
 * О режиме хук не знает вовсе: дорожку (`lane`) ему передают. Это единственное
 * место, где шаблон недели отличается от дня, — у шаблона семь дорожек по дням
 * недели, у дня одна.
 */
export function useScheduleGrid({
  hallId,
  lane,
  tables,
  coaches,
  trainingTypes,
  tournamentTypes,
  tournaments,
}: {
  hallId: string;
  lane: string;
  tables: ClubTable[];
  coaches: ClubCoach[];
  trainingTypes: TrainingType[];
  tournamentTypes: TournamentType[];
  /** Уже заведённые турниры — чтобы подписать окна, поставленные раньше. */
  tournaments: Tournament[];
}) {
  const club = useClubApi();

  const [cells, setCells] = useState<Cells>(new Map());
  /** Снимок последнего сохранения или загрузки — с ним сравнивается сетка. */
  const [saved, setSaved] = useState<Cells>(new Map());

  const [brush, setBrush] = useState<Brush>('TRAINING');
  const [coachId, setCoachId] = useState<string | null>(coaches[0]?.id ?? null);
  const [client, setClient] = useState<ClubPerson | null>(null);
  const [trainingTypeId, setTrainingTypeId] = useState<string | null>(
    trainingTypes[0]?.id ?? null,
  );
  const [tournamentTypeId, setTournamentTypeId] = useState<string | null>(
    tournamentTypes[0]?.id ?? null,
  );
  /**
   * Мест в группе для занятий, которые заведутся из этой правки.
   *
   * Десять — рабочее значение, а не правило: сколько человек влезет, знает
   * тренер, и он же поправит число перед закрашиванием.
   */
  const [capacity, setCapacity] = useState(10);

  /**
   * Имена людей, встречающихся в расписании.
   *
   * Тренеры приходят готовым списком, а клиентов у клуба тысячи — их имена
   * подтягиваются точечно, по идентификаторам из уже загруженных окон.
   */
  const [names, setNames] = useState<Map<string, string>>(new Map());

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  const own = useMemo(() => tables.filter((table) => table.hallId === hallId), [tables, hallId]);
  const tableIds = useMemo(() => own.map((table) => table.id), [own]);
  const dirty = !sameCells(cells, saved);

  /** Все, кто встречается в загруженном расписании, плюс тренеры клуба. */
  const peopleInView = useMemo(() => {
    const ids = new Set<string>(coaches.map((coach) => coach.id));

    for (const value of cells.values()) {
      const person = personOf(value);
      if (person) ids.add(person);
    }

    return ids;
  }, [cells, coaches]);

  const colors = useMemo(() => personColors([...peopleInView]), [peopleInView]);

  /**
   * Чем занято окно: название занятия или турнира.
   *
   * Цвет клетки говорит, КТО занят, а подпись — ЧЕМ: «просто тренировка» не
   * отличает детскую группу от «Первой подачи».
   */
  const captionOf = useCallback(
    (value: CellValue): string | null => {
      if (value.purpose === 'TRAINING' && value.trainingTypeId) {
        // Подпись даёт ТИП, а не заведённое занятие: своего названия у занятия
        // нет — оно и есть проведение этого типа.
        return trainingTypes.find((type) => type.id === value.trainingTypeId)?.name ?? null;
      }

      if (value.purpose === 'TOURNAMENT') {
        // Тип турнира — у окна, которое только что закрасили или которое пришло
        // из шаблона; проведение — у окна, уже сохранённого в дне.
        if (value.tournamentTypeId) {
          return tournamentTypes.find((type) => type.id === value.tournamentTypeId)?.name ?? null;
        }

        return tournaments.find((item) => item.id === value.tournamentId)?.typeName ?? null;
      }

      return null;
    },
    [trainingTypes, tournamentTypes, tournaments],
  );

  const nameOf = useCallback(
    (id: string): string =>
      coaches.find((coach) => coach.id === id)?.fullName ?? names.get(id) ?? 'без имени',
    [coaches, names],
  );

  // Имена клиентов, закреплённых за окнами, подтягиваются точечно: тянуть
  // ради них весь список клиентов клуба нельзя — их тысячи.
  useEffect(() => {
    const missing = [...peopleInView].filter(
      (id) => !coaches.some((coach) => coach.id === id) && !names.has(id),
    );

    if (missing.length === 0) return;

    let cancelled = false;

    club
      .people({ ids: missing, limit: missing.length })
      .then((page) => {
        if (cancelled) return;
        setNames((previous) => {
          const next = new Map(previous);
          for (const person of page.items) next.set(person.id, person.fullName);
          return next;
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [peopleInView, coaches, names, club]);

  /**
   * Что делает перетаскивание — закрашивает или стирает.
   *
   * Решается по первой клетке: начали с занятой тем же, чем красим, — тянем
   * стирание, иначе закраску. Так же ведёт себя выделение в таблицах.
   */
  const painting = useRef<CellValue | null | undefined>(undefined);

  useEffect(() => {
    const stop = (): void => {
      painting.current = undefined;
    };

    // Кнопку мыши могли отпустить за пределами таблицы — без этого закраска
    // «залипла» бы и продолжилась при следующем наведении.
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);

    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  function brushValue(): CellValue | null {
    if (brush === ERASER) return null;

    // Тренер кладётся только туда, где он осмыслен: у занятия и спарринга.
    // У аренды он запрещён — иначе в его статистику попадут чужие часы.
    // Клиента у окна нет вовсе: выбранным клиентом сажают человека бронью.
    const attachment = attachmentOf(brush);

    return {
      purpose: brush,
      coachId: attachment === 'coach' ? coachId : null,
      trainingTypeId: brush === 'TRAINING' ? trainingTypeId : null,
      // Занятие и проведение турнира в клетке не хранятся: они заводятся при
      // сохранении дня — из типа, тренера и границ закрашенного окна.
      trainingSessionId: null,
      tournamentId: null,
      tournamentTypeId: brush === 'TOURNAMENT' ? tournamentTypeId : null,
    };
  }

  function paint(tableId: string, slot: number, value: CellValue | null): void {
    setCells((previous) => {
      const key = cellKey(lane, tableId, slot);
      const next = new Map(previous);

      if (value === null) next.delete(key);
      else next.set(key, value);

      return next;
    });
    setError(null);
  }

  function clearLane(): void {
    setCells((previous) => {
      const next = new Map(previous);

      for (const key of previous.keys()) {
        if (key.startsWith(`${lane}|`)) next.delete(key);
      }

      return next;
    });
  }

  /**
   * Принять пришедшее с сервера: и в сетку, и в снимок сохранённого.
   *
   * Одним вызовом, а не двумя сеттерами у каждого места загрузки: забытый
   * второй — и сетка сразу после загрузки считается изменённой.
   */
  const accept = useCallback((next: Cells): void => {
    setCells(next);
    setSaved(next);
  }, []);

  return {
    own,
    tableIds,
    cells,
    setCells,
    saved,
    dirty,
    accept,
    colors,
    nameOf,
    captionOf,
    painting,
    brushValue,
    paint,
    clearLane,
    error,
    setError,
    loading,
    setLoading,
    pending,
    setPending,
    palette: {
      brush,
      onBrush: setBrush,
      coaches,
      coachId,
      onCoach: setCoachId,
      client,
      onClient: setClient,
      colors,
      trainingTypes,
      trainingTypeId,
      onTrainingType: setTrainingTypeId,
      capacity,
      onCapacity: setCapacity,
      tournamentTypes,
      tournamentTypeId,
      onTournamentType: setTournamentTypeId,
    },
  };
}

export type ScheduleGridState = ReturnType<typeof useScheduleGrid>;
