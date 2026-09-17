'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { BookingEntry, BookingStatus } from '@yenisey/types';
import { ClubMark } from '@/components/club/ClubMark';
import { PersonSwitch } from '@/components/family/PersonSwitch';
import { WhenSpan } from '@/components/club/When';
import { AppShell } from '@/components/layout/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { api, ApiError, clubApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';
import { usePersonSwitch } from '@/lib/usePersonSwitch';
import { useSession } from '@/lib/useSession';

/**
 * «Мои записи» — все записи человека по всем клубам.
 *
 * Раздел живёт на уровне платформы, а не клуба: аккаунт один, и человеку
 * незачем обходить три клубные страницы, чтобы собрать расписание своей недели
 * (ТЗ → «Мои записи»).
 *
 * Сюда же уехал список записей из личного кабинета — целиком, вместе с
 * прошедшими и с турнирами. Два списка записей в двух местах разошлись бы в
 * поведении отмены и в том, что каждый из них показывает.
 *
 * Родитель переключателем смотрит и отменяет записи своего ребёнка младше 16.
 * Сам ребёнок свои записи видит, но отменять их не может: это делает родитель.
 */
export default function MyBookingsPage() {
  const router = useRouter();
  const session = useSession();
  const family = usePersonSwitch();
  const forPerson = family.forPerson;

  const [entries, setEntries] = useState<BookingEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [session.status, forPerson]);

  const { upcoming, past } = useMemo(() => split(entries ?? []), [entries]);

  // По строке записи, а не по мероприятию: у одного занятия бывают две
  // строки — отменённая и живая после повторной записи.
  function replace(updated: BookingEntry): void {
    setEntries((current) =>
      (current ?? []).map((entry) => (entry.entryId === updated.entryId ? updated : entry)),
    );
  }

  return (
    <AppShell>
      <h1 className="mb-8 text-[1.75rem]">
        {family.selected ? `Записи: ${family.selected.fullName}` : 'Мои записи'}
      </h1>

      <PersonSwitch
        people={family.children}
        selected={family.selected}
        onChoose={family.choose}
        className="-mt-4 mb-8"
      />

      {family.selfIsChild && (
        <Alert tone="info">Отменить запись до 16 лет может родитель — или администратор клуба.</Alert>
      )}

      {error && <Alert>{error}</Alert>}

      {entries === null && <Skeleton />}

      {entries?.length === 0 && (
        <p className="max-w-md text-[0.9375rem] leading-relaxed text-text-muted">
          Записей пока нет.{' '}
          <Link href="/" className="text-text-accent underline-offset-2 hover:underline">
            Найдите клуб
          </Link>{' '}
          и запишитесь на турнир или забронируйте стол.
        </p>
      )}

      {entries && entries.length > 0 && (
        <>
          <Group
            title="Ближайшие"
            groups={byClub(upcoming)}
            forPerson={forPerson}
            canCancel={!family.selfIsChild}
            onChanged={replace}
            onError={setError}
          />

          {past.length > 0 && (
            <Group
              title="История"
              groups={byClub(past)}
              forPerson={forPerson}
              canCancel={!family.selfIsChild}
              onChanged={replace}
              onError={setError}
            />
          )}
        </>
      )}
    </AppShell>
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
  forPerson,
  canCancel,
  onChanged,
  onError,
}: {
  title: string;
  groups: [string, BookingEntry[]][];
  /** Чьи записи: ребёнка — или свои. */
  forPerson: string | null;
  canCancel: boolean;
  onChanged: (entry: BookingEntry) => void;
  onError: (message: string) => void;
}) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <section className="mb-14">
      <h2 className="mb-5 text-[1.375rem]">{title}</h2>

      <div className="grid gap-8">
        {groups.map(([slug, list]) => (
          <div key={slug}>
            <Link
              href={`/clubs/${slug}`}
              className="group inline-flex items-center gap-3 transition-colors hover:text-text-accent"
            >
              <ClubMark club={list[0]!.club} size="sm" />
              <span className="text-[1rem] text-text group-hover:text-text-accent">
                {list[0]!.club.name}
              </span>
            </Link>

            <ul className="mt-3 border-t border-border">
              {list.map((entry) => (
                <li key={entry.entryId}>
                  <Row
                    entry={entry}
                    forPerson={forPerson}
                    canCancel={canCancel}
                    onChanged={onChanged}
                    onError={onError}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
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
}: {
  entry: BookingEntry;
  forPerson: string | null;
  canCancel: boolean;
  onChanged: (entry: BookingEntry) => void;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState(false);

  /**
   * Отмена идёт КЛУБНЫМ маршрутом, а не платформенным.
   *
   * Строка несёт код своего клуба, и второй путь отмены на уровне платформы
   * разошёлся бы с клубным — сначала в мелочах, потом в деньгах.
   */
  async function cancel(): Promise<void> {
    setPending(true);

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
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border py-4">
      <span
        aria-hidden="true"
        className={cn(
          'h-8 w-[3px] shrink-0 rounded-full',
          entry.status === 'BOOKED' ? '' : 'opacity-30',
        )}
        style={{ background: entry.club.accentColor ?? 'var(--accent)' }}
      />

      <WhenSpan startsAt={entry.startsAt} endsAt={entry.endsAt} />

      <span className="min-w-0 grow">
        <span className="block text-[0.9375rem] text-text">{entry.title}</span>
        <span className="mt-0.5 block text-[0.8125rem] text-text-muted">
          {entry.subtitle ? `${entry.subtitle} · ` : ''}
          {formatKopecks(entry.price)}
        </span>
      </span>

      <span className="text-[0.8125rem] whitespace-nowrap text-text-subtle">{statusOf(entry)}</span>

      {/* Можно ли отменить, решает сервер: его часы — часы клуба, а после
          начала запись не отменяется, а отмечается. */}
      {entry.cancellable && canCancel && (
        <Button variant="danger" size="sm" pending={pending} onClick={() => void cancel()}>
          Отменить
          {entry.cancelChargePercentNow ? ` (спишется ${entry.cancelChargePercentNow}%)` : ''}
        </Button>
      )}
    </div>
  );
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
