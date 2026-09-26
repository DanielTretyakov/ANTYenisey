'use client';

import { useEffect, useMemo, useState } from 'react';
import { availableInAny, type ClubCatalogItem, type ClubEvent, type EventKind } from '@yenisey/types';
import { EventDialog } from '@/components/events/EventDialog';
import { inputClassName } from '@/components/ui/Field';
import { Tab } from '@/components/ui/Tab';
import type { EventsFilter } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { EventViewer } from '@/lib/eventViewer';
import { dayKey, monthEnd, monthLabel, monthStart } from '@/lib/month';
import { tintMark } from '@/lib/personColor';
import { useClubApi } from '@/lib/useClubApi';
import { sameDay, weekDays, weekEnd, weekLabel, weekStart } from '@/lib/week';
import { EventRow, KIND_PAINT, RowSkeleton, shortWhen } from './EventRow';
import { MonthCalendar } from './MonthCalendar';

/** Выбранный вид мероприятия — «только детские тренировки». */
export interface KindFilter {
  kind: EventKind;
  typeId: string;
}

/** Якорь блока — к нему прокручивает «Показать расписание» из вкладки. */
export const UPCOMING_ANCHOR = 'raspisanie';

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
/** Сколько месяцев вперёд листает календарь: дальше расписание не заводят. */
const MONTHS_AHEAD = 5;
/** Сколько ближайших проведений выбранного вида показать сверху. */
const NEAREST = 5;

/**
 * Предстоящие мероприятия клуба. Аренды столов здесь нет: к чужой броне не
 * присоединиться.
 *
 * Два вида (решение владельца от 25.09.2026): неделя списком — с днями и
 * поиском по названию, как раньше, — и месяц календарём, чтобы видеть общую
 * картину. Поверх обоих — фильтр по виду мероприятия и блок «Ближайшее» по
 * всем будущим датам: «когда ближайшая детская тренировка» — вопрос не о
 * неделе и не о месяце.
 */
export function UpcomingEvents({
  slug,
  version,
  viewer,
  forPerson,
  selfIsChild,
  onChanged,
  catalog,
  filter,
  onFilter,
  hallIds,
}: {
  slug: string;
  /** Растёт после записи или отмены — список перечитывается. */
  version: number;
  viewer: EventViewer;
  forPerson: string | null;
  selfIsChild: boolean;
  onChanged: () => void;
  /** Виды мероприятий клуба — чипы фильтра. */
  catalog: ClubCatalogItem[] | null;
  filter: KindFilter | null;
  onFilter: (filter: KindFilter | null) => void;
  /** Залы фильтра страницы; пусто — все. */
  hallIds: string[] | null;
}) {
  const club = useClubApi();
  const [view, setView] = useState<'week' | 'month'>('week');
  const [open, setOpen] = useState<ClubEvent | null>(null);

  const [weekOffset, setWeekOffset] = useState(0);
  const [day, setDay] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const [monthOffset, setMonthOffset] = useState(0);
  const [monthDay, setMonthDay] = useState<string | null>(null);

  const [loaded, setLoaded] = useState<ClubEvent[] | null>(null);
  const [nearest, setNearest] = useState<ClubEvent[] | null>(null);

  const week = useMemo(() => weekStart(new Date(), weekOffset), [weekOffset]);
  const days = useMemo(() => weekDays(week), [week]);
  const month = useMemo(() => monthStart(new Date(), monthOffset), [monthOffset]);
  const searching = view === 'week' && query.trim() !== '';
  // Залы — строкой: массив новый на каждой отрисовке, а эффекту нужна
  // стабильная зависимость.
  const halls = hallIds?.join(',') ?? '';

  // Окно списка: неделя, месяц или — при поиске — всё предстоящее. С
  // выбранным ребёнком отметка «записан» в списке — его, а не родителя.
  useEffect(() => {
    let cancelled = false;
    const inHalls: EventsFilter = halls ? { halls } : {};
    const range: EventsFilter = searching
      ? { ...inHalls }
      : view === 'week'
        ? { from: week.toISOString(), to: weekEnd(week).toISOString(), ...inHalls }
        : { from: month.toISOString(), to: monthEnd(month).toISOString(), ...inHalls };

    setLoaded(null);

    const timer = setTimeout(
      () => {
        club
          .events(forPerson, range)
          .then((found) => {
            if (!cancelled) setLoaded(found);
          })
          .catch(() => {
            if (!cancelled) setLoaded([]);
          });
      },
      searching ? 250 : 0,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [club, forPerson, view, week, month, searching, query, version, halls]);

  // Ближайшие проведения выбранного вида — по всем датам, не по окну.
  useEffect(() => {
    if (!filter) {
      setNearest(null);
      return;
    }

    let cancelled = false;
    setNearest(null);

    club
      .events(forPerson, { kind: filter.kind, typeId: filter.typeId, limit: NEAREST, ...(halls ? { halls } : {}) })
      .then((found) => {
        if (!cancelled) setNearest(found);
      })
      .catch(() => {
        if (!cancelled) setNearest([]);
      });

    return () => {
      cancelled = true;
    };
  }, [club, forPerson, filter, version, halls]);

  const needle = query.trim().toLowerCase();
  const ofKind = (event: ClubEvent): boolean =>
    !filter || (event.kind === filter.kind && event.typeId === filter.typeId);
  const inWindow = loaded === null ? null : loaded.filter(ofKind);

  const listed =
    inWindow === null
      ? null
      : view === 'week'
        ? inWindow.filter((event) =>
            searching
              ? `${event.title} ${event.subtitle ?? ''}`.toLowerCase().includes(needle)
              : day === null || sameDay(new Date(event.startsAt), days[day]!),
          )
        : monthDay === null
          ? []
          : inWindow.filter((event) => dayKey(new Date(event.startsAt)) === monthDay);

  const chips = (catalog ?? []).filter(
    (item) => item.upcomingCount > 0 && (!hallIds || availableInAny(item.hallIds, hallIds)),
  );
  const chosen = filter ? (catalog ?? []).find((item) => item.kind === filter.kind && item.typeId === filter.typeId) : null;
  const today = new Date();

  const row = (event: ClubEvent) => (
    <li key={`${event.kind}-${event.id}`}>
      <EventRow
        slug={slug}
        event={event}
        viewer={viewer}
        forPerson={forPerson}
        onChanged={onChanged}
        onOpen={() => setOpen(event)}
      />
    </li>
  );

  return (
    <section id={UPCOMING_ANCHOR} className="mb-16 scroll-mt-24">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[1.375rem]">Предстоящие мероприятия</h2>

        <div className="flex gap-1.5" role="tablist" aria-label="Вид расписания">
          <Tab inTablist active={view === 'week'} onClick={() => setView('week')}>
            Неделя
          </Tab>
          <Tab
            inTablist
            active={view === 'month'}
            onClick={() => {
              setView('month');
              setMonthDay((current) => current ?? (monthOffset === 0 ? dayKey(today) : null));
            }}
          >
            Месяц
          </Tab>
        </div>
      </div>

      {/* Фильтр по виду: «Детская тренировка» — и остальное не мешает. */}
      {chips.length > 1 && (
        <div className="-mx-1 mb-5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          <div className="flex w-max gap-1.5" role="group" aria-label="Вид мероприятия">
            <Tab active={filter === null} onClick={() => onFilter(null)}>
              Все
            </Tab>
            {chips.map((item) => (
              <Tab
                key={`${item.kind}-${item.typeId}`}
                active={filter?.kind === item.kind && filter.typeId === item.typeId}
                onClick={() => onFilter({ kind: item.kind, typeId: item.typeId })}
              >
                <span
                  aria-hidden="true"
                  className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ background: tintMark(KIND_PAINT[item.kind]) }}
                />
                {item.name}
              </Tab>
            ))}
          </div>
        </div>
      )}

      {filter && (
        <Nearest
          name={chosen?.name ?? 'Этот вид'}
          kind={filter.kind}
          events={nearest}
          onOpen={setOpen}
          onClear={() => onFilter(null)}
        />
      )}

      {view === 'week' ? (
        <div className="mb-5 grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Stepper
              labels={['Предыдущая неделя', 'Следующая неделя']}
              disabledBack={weekOffset === 0 || searching}
              disabledForward={weekOffset >= 7 || searching}
              onBack={() => {
                setWeekOffset((value) => value - 1);
                setDay(null);
              }}
              onForward={() => {
                setWeekOffset((value) => value + 1);
                setDay(null);
              }}
            >
              <span className={cn(searching && 'text-text-subtle')}>
                {weekOffset === 0 ? 'Эта неделя' : weekOffset === 1 ? 'Следующая неделя' : weekLabel(week)}
                <span className="block text-[0.75rem] text-text-subtle">{weekLabel(week)}</span>
              </span>
            </Stepper>

            <label className="ml-auto w-full sm:w-64">
              <span className="sr-only">Поиск мероприятия</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Найти по названию или тренеру"
                className={cn(inputClassName, 'py-2')}
              />
            </label>
          </div>

          {!searching && (
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="День недели">
              <Tab inTablist active={day === null} onClick={() => setDay(null)}>
                Вся неделя
              </Tab>
              {days.map((date, index) => (
                <Tab key={date.toISOString()} inTablist active={day === index} onClick={() => setDay(index)}>
                  <span
                    className={cn(
                      date < new Date(today.getFullYear(), today.getMonth(), today.getDate()) && 'opacity-50',
                    )}
                  >
                    {DAY_NAMES[index]} {date.getDate()}
                  </span>
                </Tab>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mb-5 grid gap-4">
          <Stepper
            labels={['Предыдущий месяц', 'Следующий месяц']}
            disabledBack={monthOffset === 0}
            disabledForward={monthOffset >= MONTHS_AHEAD}
            onBack={() => {
              setMonthOffset((value) => value - 1);
              setMonthDay(monthOffset - 1 === 0 ? dayKey(today) : null);
            }}
            onForward={() => {
              setMonthOffset((value) => value + 1);
              setMonthDay(null);
            }}
          >
            {monthLabel(month)}
          </Stepper>

          {inWindow === null ? (
            <div className="h-96 animate-pulse rounded-card border border-border bg-surface-raised" aria-busy="true" />
          ) : (
            <MonthCalendar start={month} events={inWindow} selected={monthDay} onSelect={setMonthDay} onOpen={setOpen} />
          )}

          {monthDay && (
            <h3 className="mt-2 text-[1.0625rem]">
              {new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(
                new Date(`${monthDay}T12:00:00`),
              )}
            </h3>
          )}
        </div>
      )}

      {listed === null && <RowSkeleton />}

      {listed?.length === 0 && (view === 'week' || monthDay !== null) && (
        <p className="border-t border-border py-8 text-[0.9375rem] text-text-muted">
          {searching
            ? `По запросу «${query.trim()}» предстоящих мероприятий нет.`
            : view === 'month'
              ? 'В этот день мероприятий нет.'
              : day === null
                ? filter
                  ? 'На этой неделе такого нет — ближайшие даты выше.'
                  : 'На этой неделе мероприятий нет — загляните на следующую.'
                : 'В этот день мероприятий нет.'}
        </p>
      )}

      {view === 'month' && monthDay === null && inWindow !== null && (
        <p className="text-[0.875rem] text-text-muted">Выберите день в календаре — ниже появится его расписание.</p>
      )}

      {viewer === 'staff' && listed && listed.length > 0 && (
        <p className="mb-4 text-[0.8125rem] text-text-subtle">
          Сотрудники записываются на мероприятия клуба как все — кроме администратора в день его смены и тренера на
          своё занятие.
        </p>
      )}

      {viewer === 'child' && listed && listed.length > 0 && (
        <p className="mb-4 text-[0.8125rem] text-text-subtle">
          До 14 лет на мероприятия записывает родитель — или администратор клуба у стойки.
        </p>
      )}

      {/* Ключ из вида и идентификатора: занятия и турниры лежат в разных
          таблицах, и совпадение идентификаторов между ними ничем не запрещено. */}
      {listed && listed.length > 0 && <ul className="border-t border-border">{listed.map(row)}</ul>}

      {open && (
        <EventDialog
          slug={slug}
          kind={open.kind}
          id={open.id}
          forPerson={forPerson}
          selfIsChild={selfIsChild}
          onClose={() => setOpen(null)}
          onChanged={onChanged}
        />
      )}
    </section>
  );
}

/**
 * «Ближайшая детская тренировка — чт 26 сентября, 18:00» и ещё несколько дат
 * после неё. Первая выделена: это ответ на вопрос, ради которого фильтр и
 * выбирали.
 */
function Nearest({
  name,
  kind,
  events,
  onOpen,
  onClear,
}: {
  name: string;
  kind: EventKind;
  events: ClubEvent[] | null;
  onOpen: (event: ClubEvent) => void;
  onClear: () => void;
}) {
  const [first, ...rest] = events ?? [];

  return (
    <div
      className="mb-6 rounded-card border px-5 py-4"
      style={{
        borderColor: tintMark(KIND_PAINT[kind]),
        background: `color-mix(in oklab, ${KIND_PAINT[kind]} 8%, var(--surface-raised))`,
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[0.8125rem] tracking-wide text-text-muted uppercase">Ближайшее: {name}</p>
        <button
          type="button"
          onClick={onClear}
          className="text-[0.8125rem] text-text-accent underline-offset-2 hover:underline"
        >
          Показать все мероприятия
        </button>
      </div>

      {events === null && <p className="mt-2 text-[0.9375rem] text-text-muted">Ищу ближайшие даты…</p>}

      {events?.length === 0 && (
        <p className="mt-2 text-[0.9375rem] text-text">В расписании клуба этого пока нет — загляните позже.</p>
      )}

      {first && (
        <button type="button" onClick={() => onOpen(first)} className="mt-2 block text-left">
          <span className="block font-display text-[1.375rem] leading-tight text-text hover:underline">
            {shortWhen(first.startsAt)}
          </span>
          <span className="mt-0.5 block text-[0.875rem] text-text-muted">
            {first.subtitle ? `${first.subtitle} · ` : ''}
            {first.freeSeats === null ? 'места без ограничений' : first.freeSeats > 0 ? `свободно ${first.freeSeats}` : 'мест нет'}
            {first.registered && ' · вы записаны'}
          </span>
        </button>
      )}

      {rest.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.875rem]">
          <span className="text-text-muted">Потом:</span>
          {rest.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => onOpen(event)}
              className="text-text underline-offset-2 hover:underline"
            >
              {shortWhen(event.startsAt)}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}

/** «‹ Эта неделя ›» — листалка недели или месяца. */
function Stepper({
  labels,
  children,
  disabledBack,
  disabledForward,
  onBack,
  onForward,
}: {
  labels: [string, string];
  children: React.ReactNode;
  disabledBack: boolean;
  disabledForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  const button =
    'grid h-9 w-9 place-items-center rounded-control border border-border text-text-muted hover:bg-surface-sunken disabled:opacity-40';

  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label={labels[0]} disabled={disabledBack} onClick={onBack} className={button}>
        ‹
      </button>
      <span className="min-w-44 text-center text-[0.9375rem]">{children}</span>
      <button type="button" aria-label={labels[1]} disabled={disabledForward} onClick={onForward} className={button}>
        ›
      </button>
    </div>
  );
}
