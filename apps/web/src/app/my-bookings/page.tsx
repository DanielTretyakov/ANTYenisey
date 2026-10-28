'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BookingEntry, BookingStatus, ClubEvent, ClubRef, EventKind } from '@yenisey/types';
import { ClubMark } from '@/components/club/ClubMark';
import { DayGroup, groupByDay } from '@/components/club/DayGroups';
import { EventRow } from '@/components/club/EventRow';
import { MonthCalendar, type CalendarPaint } from '@/components/club/MonthCalendar';
import { SectionHeading } from '@/components/club/SectionHeading';
import { PersonSwitch } from '@/components/family/PersonSwitch';
import { WhenSpan } from '@/components/club/When';
import { Tab } from '@/components/ui/Tab';
import { EventDialog } from '@/components/events/EventDialog';
import { CancelEntry } from '@/components/events/CancelEntry';
import { HelpHint } from '@/components/help/HelpHint';
import { AppShell } from '@/components/layout/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { api, ApiError, clubApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import { icsFile } from '@/lib/ics';
import { dayKey, monthEnd, monthLabel, monthStart } from '@/lib/month';
import { dayIn } from '@/lib/zonedTime';
import { eventViewerOf } from '@/lib/eventViewer';
import { useDisclosure } from '@/lib/useDisclosure';
import { cancelButtonLabel, entryPriceLabel, visitFateLabel } from '@/lib/subscriptions';
import { usePersonSwitch } from '@/lib/usePersonSwitch';
import { useSession } from '@/lib/useSession';

/** Сколько записей видно в «Моих мероприятиях», пока не нажато «Показать все». */
const MINE_SHOWN = 3;
/** Календарь листается на полгода назад (история) и на пять месяцев вперёд, как в клубе. */
const MONTHS_BACK = 6;
const MONTHS_AHEAD = 5;

/**
 * «Мой календарь» — бывшие «Мои записи» (решение владельца от 26.10.2026):
 * сверху «Мои мероприятия» — три ближайшие записи и «Показать все», ниже —
 * календарь месяца с мероприятиями моих клубов: серым — куда можно
 * записаться, цветом платформы — куда записан. Плашка открывает стандартное
 * окно мероприятия с записью. Адрес прежний, `/my-bookings`: на него ведут
 * сообщения в MAX и письма.
 *
 * Раздел живёт на уровне платформы, а не клуба: аккаунт один, и человеку
 * незачем обходить три клубные страницы, чтобы собрать расписание своей недели
 * (ТЗ → «Мои записи»). Блок «Мои мероприятия» со страницы клуба поэтому снят.
 *
 * Сюда же уехал список записей из личного кабинета — целиком, вместе с
 * прошедшими и с турнирами. Два списка записей в двух местах разошлись бы в
 * поведении отмены и в том, что каждый из них показывает.
 *
 * Родитель переключателем смотрит и отменяет записи своего ребёнка младше 14.
 * Сам ребёнок свои записи видит, но отменять их не может: это делает родитель.
 */
export default function MyBookingsPage() {
  const router = useRouter();
  const session = useSession();
  const family = usePersonSwitch();
  const forPerson = family.forPerson;

  const [entries, setEntries] = useState<BookingEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Растёт после записи или отмены из окна — список и календарь перечитываются.
  const [version, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login');
    }
  }, [session.status, router]);

  useEffect(() => {
    if (session.status !== 'ready') {
      return;
    }

    setEntries(null);
    api
      .myBookings(forPerson)
      .then(setEntries)
      .catch((cause: unknown) =>
        setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'),
      );
  }, [session.status, forPerson, version]);

  // По строке записи, а не по мероприятию: у одного занятия бывают две
  // строки — отменённая и живая после повторной записи.
  function replace(updated: BookingEntry): void {
    setEntries((current) =>
      (current ?? []).map((entry) => (entry.entryId === updated.entryId ? updated : entry)),
    );
  }

  const rentalsFirst =
    entries === null ||
    entries.some((entry) => entry.kind === 'TABLE') ||
    !entries.some((entry) => entry.kind !== 'TABLE');

  return (
    <AppShell footer="line">
      <h1 className="text-[1.75rem]">
        {family.selected ? `Календарь: ${family.selected.fullName}` : 'Мой календарь'}
      </h1>
      <HelpHint slug="moj-kalendar" className="mt-1 mb-8" />

      <PersonSwitch
        people={family.children}
        selected={family.selected}
        onChoose={family.choose}
        className="-mt-4 mb-8"
      />

      {family.selfIsChild && (
        <Alert tone="info">Отменить запись до 14 лет может родитель — или администратор клуба.</Alert>
      )}

      {error && <Alert>{error}</Alert>}

      {entries === null && <Skeleton />}

      {/* Аренда — отдельным блоком и первой (решение владельца от 26.10.2026).
          Пустая аренда при живых записях — ниже них: на телефоне она
          отодвигала первую запись за край экрана (прогон 28.10.2026). */}
      {entries && rentalsFirst && (
        <EntriesBlock
          title={family.selected ? 'Аренда' : 'Моя аренда'}
          description="Забронированные столы — по всем клубам, ближайшее сверху."
          empty={
            <>
              Впереди аренд нет. Забронировать стол можно на странице{' '}
              <Link href="/" className="text-text-accent underline-offset-2 hover:underline">
                клуба
              </Link>
              .
            </>
          }
          entries={entries.filter((entry) => entry.kind === 'TABLE')}
          forPerson={forPerson}
          canCancel={!family.selfIsChild}
          onChanged={replace}
          onError={setError}
        />
      )}

      {entries && (
        <EntriesBlock
          title={family.selected ? 'Мероприятия' : 'Мои мероприятия'}
          description="Куда записаны — по всем клубам, ближайшее сверху."
          empty={
            <>
              Впереди записей нет. Выберите мероприятие в календаре ниже или{' '}
              <Link href="/" className="text-text-accent underline-offset-2 hover:underline">
                найдите клуб
              </Link>
              .
            </>
          }
          entries={entries.filter((entry) => entry.kind !== 'TABLE')}
          forPerson={forPerson}
          canCancel={!family.selfIsChild}
          onChanged={replace}
          onError={setError}
        />
      )}

      {entries && !rentalsFirst && (
        <EntriesBlock
          title={family.selected ? 'Аренда' : 'Моя аренда'}
          description="Забронированные столы — по всем клубам, ближайшее сверху."
          empty={
            <>
              Впереди аренд нет. Забронировать стол можно на странице{' '}
              <Link href="/" className="text-text-accent underline-offset-2 hover:underline">
                клуба
              </Link>
              .
            </>
          }
          entries={entries.filter((entry) => entry.kind === 'TABLE')}
          forPerson={forPerson}
          canCancel={!family.selfIsChild}
          onChanged={replace}
          onError={setError}
        />
      )}

      {session.status === 'ready' && (
        <MyMonth
          entries={entries}
          forPerson={forPerson}
          selfIsChild={family.selfIsChild}
          version={version}
          onChanged={changed}
          onEntryChanged={replace}
          onError={setError}
        />
      )}
      {/* Линия и в конце страницы — та же, что между разделами. */}
      <div aria-hidden="true" className="section-rule mt-14 [--rule-gap:3.5rem]" />
    </AppShell>
  );
}

/**
 * Плашка календаря: мероприятие клуба или моя запись — с клубом, чтобы
 * открыть окно, и тоном, чтобы покрасить. У мероприятия моего клуба есть
 * строка `event` (для списка дня), у записи — `entry`.
 */
interface MonthItem {
  key: string;
  id: string;
  kind: EventKind | 'TABLE';
  startsAt: string;
  timezone: string;
  title: string;
  club: ClubRef;
  tone: Tone;
  event: ClubEvent | null;
  entry: BookingEntry | null;
}

type Tone = 'event' | 'rental' | 'open';

/**
 * Краски календаря (решение владельца от 26.10.2026): куда записан или где
 * был — изумрудом платформы, аренда столов — синим, куда можно записаться в
 * моих клубах — серым. Страница вне клуба, и `--accent` здесь — платформенный.
 */
const PAINT: Record<Tone, CalendarPaint> = {
  event: {
    fill: 'var(--accent)',
    mark: 'color-mix(in oklab, var(--accent) 70%, #000)',
    text: 'var(--accent-text)',
  },
  rental: {
    fill: 'oklch(0.56 0.16 256)',
    mark: 'oklch(0.44 0.17 258)',
    text: '#ffffff',
  },
  open: {
    fill: 'color-mix(in oklab, var(--text-subtle) 16%, var(--surface-raised))',
    mark: 'var(--text-subtle)',
  },
};

/** Какие клубы человек выключил в календаре — помнит браузер. */
const HIDDEN_CLUBS_KEY = 'yenisey.calendarHiddenClubs';

function readHidden(): string[] {
  try {
    const raw = window.localStorage.getItem(HIDDEN_CLUBS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeHidden(slugs: string[]): void {
  try {
    window.localStorage.setItem(HIDDEN_CLUBS_KEY, JSON.stringify(slugs));
  } catch {
    // Хранилище недоступно (приватное окно) — выбор живёт до перезагрузки.
  }
}

/**
 * Календарь месяца «Моего календаря» (решения владельца от 26.10.2026):
 * занятия и турниры моих клубов (отмеченных сердечком) — серым, мои записи
 * на них — изумрудом, аренда — синим, в том числе в клубах без сердечка.
 * Прошедшее чужое не показывается: на него уже не записаться. Клубы можно
 * выключить списком над календарём. Плашка мероприятия открывает его окно,
 * плашка аренды — список дня под календарём, где та же строка, что в клубе.
 */
function MyMonth({
  entries,
  forPerson,
  selfIsChild,
  version,
  onChanged,
  onEntryChanged,
  onError,
}: {
  entries: BookingEntry[] | null;
  forPerson: string | null;
  selfIsChild: boolean;
  version: number;
  onChanged: () => void;
  onEntryChanged: (entry: BookingEntry) => void;
  onError: (message: string) => void;
}) {
  const session = useSession();
  const [offset, setOffset] = useState(0);
  const [favourites, setFavourites] = useState<ClubRef[] | null>(null);
  const [events, setEvents] = useState<{ club: ClubRef; event: ClubEvent }[] | null>(null);
  const [day, setDay] = useState<string | null>(() => dayKey(new Date()));
  const [open, setOpen] = useState<MonthItem | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => setHidden(readHidden()), []);

  const month = useMemo(() => monthStart(new Date(), offset), [offset]);

  useEffect(() => {
    api
      .myClubs()
      .then((list) => setFavourites(list.map(({ slug, name, accentColor }) => ({ slug, name, accentColor }))))
      .catch(() => setFavourites([]));
  }, []);

  // Клубы для выбора: мои (с сердечком) и те, где у меня есть записи.
  const clubs = useMemo(() => {
    const found = new Map<string, Pick<ClubRef, 'slug' | 'name'>>();

    for (const club of favourites ?? []) found.set(club.slug, club);
    for (const entry of entries ?? []) if (!found.has(entry.club.slug)) found.set(entry.club.slug, entry.club);

    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [favourites, entries]);

  // Мероприятия моих клубов за месяц — запросом на клуб: клубов не больше трёх.
  useEffect(() => {
    if (favourites === null) return;

    let cancelled = false;
    const range = { from: month.toISOString(), to: monthEnd(month).toISOString() };

    setEvents(null);
    Promise.all(
      favourites.map((club) =>
        clubApi(club.slug)
          .events(forPerson, range)
          .then((list) => list.map((event) => ({ club, event })))
          .catch(() => []),
      ),
    ).then((lists) => {
      if (!cancelled) setEvents(lists.flat());
    });

    return () => {
      cancelled = true;
    };
  }, [favourites, month, forPerson, version]);

  const items = useMemo(() => {
    if (events === null || entries === null) return null;

    const from = month.getTime();
    const to = monthEnd(month).getTime();
    const now = Date.now();
    const found = new Map<string, MonthItem>();

    for (const { club, event } of events) {
      // Прошедшее, куда я не записан, — не показываем: на него уже не записаться.
      if (!event.registered && Date.parse(event.startsAt) <= now) continue;

      const key = `${event.kind}-${event.id}`;
      found.set(key, {
        key,
        id: event.id,
        kind: event.kind,
        startsAt: event.startsAt,
        timezone: event.timezone,
        title: event.title,
        club,
        tone: event.registered ? 'event' : 'open',
        event,
        entry: null,
      });
    }

    // Мои записи и аренды — цветом, и в клубах без сердечка тоже.
    for (const entry of entries) {
      if (entry.status === 'CANCELLED') continue;

      const at = Date.parse(entry.startsAt);
      if (at < from || at >= to) continue;

      const key = `${entry.kind}-${entry.id}`;
      found.set(key, {
        key,
        id: entry.id,
        kind: entry.kind,
        startsAt: entry.startsAt,
        timezone: entry.timezone,
        title: entry.title,
        club: entry.club,
        tone: entry.kind === 'TABLE' ? 'rental' : 'event',
        event: found.get(key)?.event ?? null,
        entry,
      });
    }

    return [...found.values()]
      .filter((item) => !hidden.includes(item.club.slug))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [events, entries, month, hidden]);

  const ofDay =
    day === null || items === null ? [] : items.filter((item) => dayIn(item.startsAt, item.timezone) === day);
  const step = (delta: number): void => {
    setOffset((value) => value + delta);
    setDay(null);
  };
  const chooseHidden = (slugs: string[]): void => {
    setHidden(slugs);
    writeHidden(slugs);
  };

  // Плашка мероприятия — его окно; у аренды окна нет — её день под календарём.
  const openItem = (item: MonthItem): void => {
    if (item.kind === 'TABLE') {
      setDay(dayIn(item.startsAt, item.timezone));
      return;
    }

    setOpen(item);
  };

  return (
    <section className="section-rule [--rule-gap:3.5rem]">
      <SectionHeading
        title="Календарь"
        description="Изумрудом — куда вы записаны, синим — аренда столов, серым — куда можно записаться в ваших клубах. Нажмите на мероприятие — откроется его окно."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" aria-label="Предыдущий месяц" disabled={offset <= -MONTHS_BACK} onClick={() => step(-1)}>
          ‹
        </Button>
        <span className="min-w-36 text-center text-[1rem] capitalize">{monthLabel(month)}</span>
        <Button variant="secondary" size="sm" aria-label="Следующий месяц" disabled={offset >= MONTHS_AHEAD} onClick={() => step(1)}>
          ›
        </Button>

        {clubs.length > 1 && <ClubMenu clubs={clubs} hidden={hidden} onChange={chooseHidden} />}

        <span className="flex flex-wrap items-center gap-4 text-[0.8125rem] text-text-muted sm:ml-auto">
          <Legend paint={PAINT.event} label="Записаны" />
          <Legend paint={PAINT.rental} label="Аренда" />
          <Legend paint={PAINT.open} label="Можно записаться" />
        </span>
      </div>

      {favourites !== null && favourites.length === 0 && (
        <p className="mb-4 text-[0.875rem] text-text-muted">
          Отметьте клубы сердечком на их страницах — их занятия и турниры появятся в календаре.{' '}
          <Link href="/" className="text-text-accent underline-offset-2 hover:underline">
            Найти клуб
          </Link>
        </p>
      )}

      {items === null ? (
        <div className="h-96 animate-pulse rounded-card border border-border bg-surface-raised" aria-busy="true" />
      ) : (
        <MonthCalendar
          start={month}
          events={items}
          selected={day}
          onSelect={setDay}
          onOpen={openItem}
          keyOf={(item) => item.key}
          paint={(item) => PAINT[item.tone]}
        />
      )}

      {/* День под календарём — так же, как «Предстоящие» на странице клуба:
          дата слева под общей чертой, справа строки с записью (решение
          владельца от 26.10.2026). На телефоне в клетках только точки, и
          выбор — здесь. */}
      {day && items !== null && (
        <div className="mt-6">
          {ofDay.length === 0 ? (
            <p className="border-t border-border py-6 text-[0.9375rem] text-text-muted">
              {new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(
                new Date(`${day}T12:00:00`),
              )}
              : мероприятий нет.
            </p>
          ) : (
            <ul className="border-t border-border">
              {groupByDay(ofDay).map((group) => (
                <DayGroup key={group.key} weekday={group.weekday} date={group.date} rule={false}>
                  {group.items.map((item) => (
                    <li key={item.key}>
                      <ClubStripe color={item.club.accentColor}>
                      {item.event ? (
                        <EventRow
                          slug={item.club.slug}
                          event={item.event}
                          viewer={eventViewerOf(session, item.club.slug, forPerson, selfIsChild)}
                          forPerson={forPerson}
                          onChanged={onChanged}
                          onOpen={() => setOpen(item)}
                          hideDate
                          clubName={item.club.name}
                        />
                      ) : item.entry ? (
                        <Row
                          entry={item.entry}
                          forPerson={forPerson}
                          canCancel={!selfIsChild}
                          onChanged={onEntryChanged}
                          onError={onError}
                          showClub
                        />
                      ) : null}
                      </ClubStripe>
                    </li>
                  ))}
                </DayGroup>
              ))}
            </ul>
          )}
        </div>
      )}

      {open && open.kind !== 'TABLE' && (
        <EventDialog
          slug={open.club.slug}
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
 * Какие клубы показывать в календаре — галочками, как «Все залы ▾» в клубе.
 * Выключенный клуб пропадает и с мероприятиями, и с моими записями в нём.
 */
function ClubMenu({
  clubs,
  hidden,
  onChange,
}: {
  clubs: Pick<ClubRef, 'slug' | 'name'>[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
}) {
  const menu = useDisclosure();
  const shown = clubs.filter((club) => !hidden.includes(club.slug));
  const label =
    shown.length === clubs.length ? 'Все клубы' : shown.length === 1 ? shown[0]!.name : `Клубы: ${shown.length} из ${clubs.length}`;

  const toggle = (slug: string): void =>
    onChange(hidden.includes(slug) ? hidden.filter((item) => item !== slug) : [...hidden, slug]);

  return (
    <div ref={menu.root} className="relative">
      <button
        type="button"
        {...menu.buttonProps}
        aria-haspopup="true"
        onClick={menu.toggle}
        className={cn(
          'flex max-w-[16rem] items-center gap-1.5 rounded-control border px-3.5 py-1.5 text-[0.875rem] whitespace-nowrap transition-colors',
          hidden.length > 0
            ? 'border-border-accent bg-surface-accent-soft text-text-accent'
            : 'border-border text-text-muted hover:bg-surface-sunken',
        )}
      >
        <span className="truncate">{label}</span>
        <svg aria-hidden="true" viewBox="0 0 12 12" className={cn('h-3 w-3 shrink-0 transition-transform', menu.open && 'rotate-180')}>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {menu.open && (
        <div
          id={menu.panelId}
          role="group"
          aria-label="Клубы в календаре"
          className="absolute top-full left-0 z-20 mt-1.5 max-h-80 w-max max-w-[min(20rem,calc(100vw-2.5rem))] min-w-[13rem] overflow-y-auto rounded-card border border-border bg-surface-raised p-1 shadow-lg"
        >
          <button
            type="button"
            onClick={() => {
              onChange([]);
              menu.close();
            }}
            className={cn(
              'flex w-full items-center rounded-control px-3 py-2 text-left text-[0.875rem] font-medium transition-colors',
              hidden.length === 0 ? 'bg-surface-accent-soft text-text-accent' : 'text-text hover:bg-surface-sunken',
            )}
          >
            Все клубы
          </button>
          {clubs.map((club) => (
            <label
              key={club.slug}
              className="flex cursor-pointer items-center gap-2.5 rounded-control px-3 py-2 text-[0.875rem] text-text transition-colors hover:bg-surface-sunken"
            >
              <input
                type="checkbox"
                checked={!hidden.includes(club.slug)}
                onChange={() => toggle(club.slug)}
                className="h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
              {club.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function Legend({ paint, label }: { paint: CalendarPaint; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="h-3 w-4 rounded-[0.25rem]"
        style={{ background: paint.fill, boxShadow: `inset 2px 0 0 ${paint.mark}` }}
      />
      {label}
    </span>
  );
}

/**
 * Строка в цвете своего клуба (решение владельца от 26.10.2026): полоска
 * слева у каждой записи, а не одна на день — в одном дне бывают разные клубы.
 * Клуб без своего цвета — в изумруде платформы.
 */
function ClubStripe({ color, children }: { color: string | null; children: ReactNode }) {
  return (
    // Граница и отступ строки — у обёртки: их уплотняет и снимает у последней
    // `DayGroup`, а строке внутри они не нужны.
    <div className="relative border-b border-border pl-4 [&>div]:border-b-0 [&>div]:py-0">

      <span
        aria-hidden="true"
        className="absolute inset-y-3 left-0 w-[3px] rounded-full"
        style={{ background: color ?? 'var(--accent)' }}
      />
      {children}
    </div>
  );
}

/** История по умолчанию — за 30 дней от сегодня; старше — фильтром (решение от 26.10.2026). */
const HISTORY_PERIODS = [
  { days: 30, label: '30 дней' },
  { days: 90, label: '3 месяца' },
  { days: 365, label: 'Год' },
  { days: 0, label: 'Всё время' },
] as const;

const DAY_MS = 86_400_000;

/**
 * Блок записей одного рода — «Моя аренда» или «Мои мероприятия».
 *
 * Свёрнут — три ближайшие живые записи с клубом в строке. «Показать все» —
 * ближайшие целиком и история по клубам, прямо в блоке, без разделительной
 * линии (решение владельца от 26.10.2026). История — за 30 дней, старше —
 * переключателем срока.
 */
function EntriesBlock({
  title,
  description,
  empty,
  entries,
  forPerson,
  canCancel,
  onChanged,
  onError,
}: {
  title: string;
  description: string;
  empty: ReactNode;
  entries: BookingEntry[];
  forPerson: string | null;
  canCancel: boolean;
  onChanged: (entry: BookingEntry) => void;
  onError: (message: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [period, setPeriod] = useState<number>(HISTORY_PERIODS[0].days);

  const { upcoming, past } = useMemo(() => split(entries), [entries]);
  const ahead = upcoming.filter((entry) => entry.status === 'BOOKED');
  const since = period === 0 ? 0 : Date.now() - period * DAY_MS;
  const history = past.filter((entry) => Date.parse(entry.startsAt) >= since);

  const row = (entry: BookingEntry, showClub: boolean) => (
    <li key={entry.entryId}>
      <ClubStripe color={entry.club.accentColor}>
        <Row
          entry={entry}
          forPerson={forPerson}
          canCancel={canCancel}
          onChanged={onChanged}
          onError={onError}
          showClub={showClub}
        />
      </ClubStripe>
    </li>
  );

  return (
    // Линия — над вторым и следующими блоками (решение владельца от 26.10.2026).
    <section className="mb-14 [section+&]:section-rule [section+&]:[--rule-gap:3.5rem]">
      <SectionHeading title={title} description={description} />

      {!showAll &&
        (ahead.length === 0 ? (
          <p className="max-w-md text-[0.9375rem] leading-relaxed text-text-muted">{empty}</p>
        ) : (
          <ByDay entries={ahead.slice(0, MINE_SHOWN)} render={(entry) => row(entry, true)} />
        ))}

      {showAll && (
        <div className="grid gap-10">
          <Group title="Ближайшие" groups={byClub(upcoming)} render={(entry) => row(entry, false)} empty="Впереди ничего нет." />

          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-[1.125rem]">История</h3>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="За какой срок">
                {HISTORY_PERIODS.map((item) => (
                  <Tab key={item.days} active={period === item.days} onClick={() => setPeriod(item.days)}>
                    {item.label}
                  </Tab>
                ))}
              </div>
            </div>
            <Group
              groups={byClub(history)}
              render={(entry) => row(entry, false)}
              empty={period === 0 ? 'Истории пока нет.' : 'За этот срок ничего нет — выберите срок больше.'}
            />
          </div>
        </div>
      )}

      {entries.length > 0 && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Свернуть' : 'Показать все'}
        </Button>
      )}
    </section>
  );
}

/**
 * Записи, сгруппированные по клубу.
 *
 * Группировка по клубу, а не сплошной список: человек, который ходит в три
 * клуба, читает расписание по клубам, а не по времени — «когда мне в Енисей»
 * это отдельный вопрос от «когда мне вообще».
 */
function Group({
  title,
  groups,
  render,
  empty,
}: {
  title?: string;
  groups: [string, BookingEntry[]][];
  render: (entry: BookingEntry) => ReactNode;
  empty: string;
}) {
  return (
    <div>
      {title && <h3 className="mb-4 text-[1.125rem]">{title}</h3>}

      {groups.length === 0 ? (
        <p className="text-[0.875rem] text-text-muted">{empty}</p>
      ) : (
        <div className="grid gap-8">
          {groups.map(([slug, list]) => (
            <div key={slug}>
              <Link
                href={`/clubs/${slug}`}
                className="group inline-flex items-center gap-3 transition-colors hover:text-text-accent"
              >
                <ClubMark club={list[0]!.club} size="sm" />
                <span className="text-[1rem] text-text group-hover:text-text-accent">{list[0]!.club.name}</span>
              </Link>

              <ByDay entries={list} render={render} className="mt-3" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Записи по дням: соседние одного дня — под общей чертой, как «Вся неделя» в клубе. */
function ByDay({
  entries,
  render,
  className,
}: {
  entries: BookingEntry[];
  render: (entry: BookingEntry) => ReactNode;
  className?: string;
}) {
  return (
    <ul className={cn('border-t border-border', className)}>
      {groupByDay(entries).map((group) => (
        <DayGroup key={`${group.key}-${group.items[0]!.entryId}`} weekday={group.weekday} date={group.date} rule={false}>
          {group.items.map(render)}
        </DayGroup>
      ))}
    </ul>
  );
}

const STATUS_LABELS: Record<BookingStatus, string> = {
  BOOKED: 'Активна',
  CANCELLED: 'Отменена',
  ATTENDED: 'Состоялась',
  NO_SHOW: 'Неявка',
};

/**
 * Что показать в статусе строки.
 *
 * Началась, а статус всё ещё «записан» — значит, клуб присутствие не отметил.
 * «Активна» в истории читалась бы как «можно отменить», а отменить нельзя:
 * после начала запись только отмечается. Списание — только у отмены и неявки:
 * «Состоялась, списано 100%» было бы шумом, цена и так в строке.
 */
function statusOf(entry: BookingEntry): string {
  if (entry.status === 'BOOKED') {
    return entry.cancellable ? STATUS_LABELS.BOOKED : 'Ждёт отметки клуба';
  }

  // Клуб отменил само занятие или турнир — без денег, визит вернулся.
  if (entry.clubCancelReason !== null) {
    return entry.paidBy ? 'Отменена клубом, визит вернулся' : 'Отменена клубом, без списания';
  }

  // У записи по абонементу процент — судьба визита, а не деньги.
  if (entry.paidBy && (entry.status === 'CANCELLED' || entry.status === 'NO_SHOW')) {
    return `${STATUS_LABELS[entry.status]}, ${visitFateLabel(entry.chargePercent)}`;
  }

  if (entry.status === 'NO_SHOW' && entry.chargePercent === 0) {
    return 'Неявка, без списания';
  }

  const charged =
    (entry.status === 'CANCELLED' || entry.status === 'NO_SHOW') && (entry.chargePercent ?? 0) > 0
      ? `, списано ${entry.chargePercent}%`
      : '';

  return `${STATUS_LABELS[entry.status]}${charged}`;
}

function Row({
  entry,
  forPerson,
  canCancel,
  onChanged,
  onError,
  showClub = false,
}: {
  entry: BookingEntry;
  forPerson: string | null;
  canCancel: boolean;
  onChanged: (entry: BookingEntry) => void;
  onError: (message: string) => void;
  /** Клуб в строке — там, где записи не сгруппированы по клубам. */
  showClub?: boolean;
}) {
  // Строка всегда в группе дня (`DayGroup`): дата и черта — у группы, здесь
  // только время (решение владельца от 26.10.2026).
  /**
   * Отмена идёт КЛУБНЫМ маршрутом, а не платформенным.
   *
   * Строка несёт код своего клуба, и второй путь отмены на уровне платформы
   * разошёлся бы с клубным — сначала в мелочах, потом в деньгах.
   */
  async function cancel(): Promise<void> {
    try {
      const club = clubApi(entry.club.slug);

      // Аренда стола отвечает своей формой (`BookingResult`), а мероприятия —
      // уже готовой строкой списка: их отмену собирает тот же сервис, что и
      // сам список.
      onChanged(
        entry.kind === 'TABLE'
          ? toEntry(entry, await club.cancelBooking(entry.id, forPerson))
          : entry.kind === 'TRAINING'
            ? await club.cancelTrainingBooking(entry.id, forPerson)
            : await club.cancelTournamentRegistration(entry.id, forPerson),
      );
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border py-4">
      <WhenSpan startsAt={entry.startsAt} endsAt={entry.endsAt} timezone={entry.timezone} hideDate />

      <span className={cn('min-w-0 grow', entry.status !== 'BOOKED' && 'opacity-70')}>
        <span className="block text-[0.9375rem] text-text">{entry.title}</span>
        <span className="mt-0.5 block text-[0.8125rem] text-text-muted">
          {showClub ? `${entry.club.name} · ` : ''}
          {entry.subtitle ? `${entry.subtitle} · ` : ''}
          {entryPriceLabel(entry)}
        </span>
        {entry.clubCancelReason !== null && (
          <span className="mt-0.5 block text-[0.8125rem] text-text-muted">Причина: {entry.clubCancelReason}</span>
        )}
      </span>

      <span className="text-[0.8125rem] whitespace-nowrap text-text-subtle">{statusOf(entry)}</span>

      {/* В календарь — у предстоящей живой записи (решение от 12.10.2026). */}
      {entry.status === 'BOOKED' && new Date(entry.startsAt).getTime() > Date.now() && (
        <Button variant="ghost" size="sm" onClick={() => downloadIcs(entry)}>
          В календарь
        </Button>
      )}

      {/* Можно ли отменить, решает сервер: его часы — часы клуба, а после
          начала запись не отменяется, а отмечается. */}
      {entry.cancellable && canCancel && (
        <CancelEntry
          kind={entry.kind}
          id={entry.id}
          forPerson={forPerson}
          terms={entry}
          label={cancelButtonLabel(entry)}
          size="sm"
          variant="danger"
          onConfirm={cancel}
        />
      )}
    </div>
  );
}

/**
 * Файл .ics записи — календарь телефона или почты откроет его сам. Повторный
 * импорт обновит событие, а не задвоит: идентификатор — строка записи.
 */
function downloadIcs(entry: BookingEntry): void {
  const file = icsFile({
    uid: `${entry.entryId}@knt`,
    title: `${entry.title} · ${entry.club.name}`,
    startsAt: entry.startsAt,
    endsAt: entry.endsAt,
    location: entry.subtitle,
    url: `${window.location.origin}/my-bookings`,
  });
  const link = document.createElement('a');

  link.href = URL.createObjectURL(new Blob([file], { type: 'text/calendar;charset=utf-8' }));
  link.download = `${entry.title}.ics`.replace(/[\\/:*?"<>|]/g, '');
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function Skeleton() {
  return (
    <div aria-busy="true">
      <span className="block h-4 w-32 rounded-full bg-border/50" />
      <div className="mt-5 border-t border-border">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-5 border-b border-border py-4">
            <span className="h-3.5 w-36 shrink-0 rounded-full bg-border/50" />
            <span className="h-3.5 w-52 rounded-full bg-border/40" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Ближайшие сверху, прошедшие историей ниже. Граница проходит по «сейчас». */
function split(entries: BookingEntry[]): { upcoming: BookingEntry[]; past: BookingEntry[] } {
  const now = Date.now();

  return {
    upcoming: entries.filter((entry) => new Date(entry.startsAt).getTime() >= now),
    // История — свежее сверху: последнее, что было, вспоминают чаще всего.
    past: entries
      .filter((entry) => new Date(entry.startsAt).getTime() < now)
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
  };
}

/** Записи по клубам, порядок клубов — по первой записи в каждом. */
function byClub(entries: BookingEntry[]): [string, BookingEntry[]][] {
  const groups = new Map<string, BookingEntry[]>();

  for (const entry of entries) {
    const list = groups.get(entry.club.slug) ?? [];
    list.push(entry);
    groups.set(entry.club.slug, list);
  }

  return [...groups.entries()];
}

/**
 * Ответ клубного маршрута отмены брони — обратно в общую строку.
 *
 * Клубный маршрут отдаёт `ClientBooking`: он старше платформенного списка и
 * про клуб ничего не знает, потому что в своём ответе клуб и так известен.
 * Клуб и заголовок берём у той строки, которую отменяли.
 */
function toEntry(
  original: BookingEntry,
  cancelled: {
    startsAt: string;
    endsAt: string;
    price: number;
    status: BookingStatus;
    chargePercent: number | null;
    cancelChargePercentNow: number | null;
  },
): BookingEntry {
  return {
    ...original,
    startsAt: cancelled.startsAt,
    endsAt: cancelled.endsAt,
    price: cancelled.price,
    status: cancelled.status,
    chargePercent: cancelled.chargePercent,
    cancelChargePercentNow: cancelled.cancelChargePercentNow,
    // Отменённая больше не отменяется.
    cancellable: false,
  };
}
