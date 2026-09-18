'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { BookingStatus, ClubPersonCard, ClubPersonEntry, Role } from '@yenisey/types';
import { fullYears } from '@yenisey/types';
import { CoachCard } from '@/components/coach/CoachCard';
import { ClubFamilyBlock } from '@/components/family/ClubFamilyBlock';
import { AdminShell } from '@/components/layout/AdminShell';
import { PlayerReview } from '@/components/player/PlayerReview';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';
import { roleInClub } from '@/lib/membership';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { useSession } from '@/lib/useSession';

const MANAGERS: Role[] = ['ADMIN', 'OWNER'];

const ROLE_LABELS: Record<Role, string> = {
  CLIENT: 'клиент',
  COACH: 'тренер',
  ADMIN: 'администратор',
  OWNER: 'руководство',
};

/**
 * Карточка человека в клубе.
 *
 * Отвечает на вопросы, которые задают у стойки: когда он был в последний раз,
 * сколько раз не пришёл, сколько на нём начислено. До неё «Состав клуба»
 * показывал имя и телефон, а вся история лежала в базе и никуда не выходила.
 *
 * Показывается только история В ЭТОМ КЛУБЕ — так её собирает сервер. Тот же
 * человек в соседнем клубе администратору не виден, и это свойство запроса, а
 * не забытая проверка.
 */
export default function PersonPage() {
  const session = useSession();
  const router = useRouter();
  const slug = useClubSlug();
  const club = useClubApi();
  const params = useParams<{ id: string }>();
  const personId = params.id;

  const role = session.status === 'ready' ? roleInClub(session.user, slug) : null;
  const allowed = role !== null && MANAGERS.includes(role);

  const [card, setCard] = useState<ClubPersonCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login');
    }
  }, [session.status, router]);

  const load = useCallback(() => {
    if (!allowed) return;

    club
      .person(personId)
      .then((loaded) => {
        setCard(loaded);
        setError(null);
      })
      .catch((cause: unknown) => {
        setCard(null);
        setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');
      });
  }, [allowed, club, personId]);

  useEffect(load, [load]);

  return (
    <AdminShell>
      <Link
        href={`/clubs/${slug}/people`}
        className="text-[0.875rem] text-text-muted underline-offset-2 hover:text-text hover:underline"
      >
        ← Состав клуба
      </Link>

      {session.status === 'ready' && !allowed && (
        <Alert>Карточка человека доступна только администратору и руководству клуба.</Alert>
      )}

      {error && <Alert>{error}</Alert>}

      {allowed && !card && !error && <Skeleton />}

      {card && (
        <div className="mt-4 grid gap-6">
          <header>
            <h1 className="text-[1.75rem]">{card.person.fullName}</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9375rem] text-text-muted">
              <span>{ROLE_LABELS[card.person.role]}</span>
              <a href={`tel:${card.person.phone}`} className="hover:text-text">
                {card.person.phone}
              </a>
              <span>{card.person.email}</span>
              <span>
                {age(card.person.birthDate)} · в клубе с {shortDate(card.person.createdAt)}
              </span>
              {card.person.deactivated && (
                <span className="rounded-full border border-warning-border bg-warning-soft px-2 py-px text-[0.75rem] text-warning">
                  отключён в клубе
                </span>
              )}
            </p>
          </header>

          <Summary card={card} />

          <PlayerReview
            player={card.player}
            personId={card.person.id}
            personName={card.person.fullName}
            self={session.status === 'ready' && session.user.id === card.person.id}
            onChange={(player) => setCard((loaded) => (loaded ? { ...loaded, player } : loaded))}
            onStale={load}
          />

          {card.coach && (
            <CoachCard
              coach={card.coach}
              personId={card.person.id}
              personName={card.person.fullName}
              onChange={(coach) => setCard((loaded) => (loaded ? { ...loaded, coach } : loaded))}
            />
          )}

          <ClubFamilyBlock
            personId={card.person.id}
            personPhone={card.person.phone}
            family={card.family}
            onChanged={load}
          />

          <Card>
            <CardHeader
              title="Записи"
              description="Аренда, занятия и турниры в этом клубе — свежие сверху. Списание показано у отмен и неявок: за ними стоят деньги."
            />

            {card.entries.length === 0 ? (
              <CardBody>
                <p className="text-[0.9375rem] text-text-muted">Записей в этом клубе пока нет.</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {card.entries.map((entry) => (
                  <li key={entry.entryId} className="px-6 py-3.5">
                    <EntryRow entry={entry} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {card.visits.length > 0 && (
            <Card>
              <CardHeader
                title="Визиты с порога"
                description="Человек пришёл без брони или визит внесли задним числом при сверке истории. Денег такой визит не двигает."
              />
              <ul className="divide-y divide-border">
                {card.visits.map((visit) => (
                  <li
                    key={visit.id}
                    className="flex flex-wrap items-center gap-x-5 gap-y-1 px-6 py-3"
                  >
                    <span className="min-w-[9rem] text-[0.875rem] tabular-nums">
                      {fullMoment(visit.visitedAt)}
                    </span>
                    <span className="min-w-[12rem] flex-1 text-[0.875rem] text-text-muted">
                      {[
                        visit.coachName ? `тренер ${visit.coachName}` : '',
                        visit.note ? `«${visit.note}»` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'без тренера'}
                    </span>
                    <span className="text-[0.8125rem] text-text-subtle">
                      {visit.recordedBy ? `внёс ${visit.recordedBy}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </AdminShell>
  );
}

function Summary({ card }: { card: ClubPersonCard }) {
  const { summary } = card;

  return (
    <div className="grid gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        title="Визитов"
        value={String(summary.visits)}
        note={
          summary.lastVisitAt ? `последний — ${shortDate(summary.lastVisitAt)}` : 'ещё не приходил'
        }
      />
      <Tile
        title="Неявок"
        value={String(summary.noShows)}
        note={summary.noShows === 0 ? 'ни разу' : 'не пришёл и не отменил'}
        alert={summary.noShows > 0}
      />
      <Tile
        title="Отмен"
        value={String(summary.cancellations)}
        note={
          summary.lateCancellations > 0
            ? `из них поздних ${summary.lateCancellations}`
            : 'все заранее'
        }
      />
      <Tile
        title="Начислено"
        // Не «оплачено»: платёжного шлюза нет, сумма сложена из копий цен на
        // момент записи. Та же оговорка, что на экране смены.
        value={formatKopecks(summary.accrued)}
        note={summary.upcoming > 0 ? `впереди записей: ${summary.upcoming}` : 'по цене на момент записи'}
      />
    </div>
  );
}

function Tile({
  title,
  value,
  note,
  alert = false,
}: {
  title: string;
  value: string;
  note: string;
  alert?: boolean;
}) {
  return (
    <div className="bg-surface-raised px-5 py-4">
      <p className="text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">{title}</p>
      <p
        className={cn(
          'mt-1.5 font-display text-[1.625rem] leading-tight tabular-nums',
          alert && 'text-warning',
        )}
      >
        {value}
      </p>
      {note && <p className="mt-0.5 text-[0.8125rem] text-text-muted">{note}</p>}
    </div>
  );
}

const STATUS_LABELS: Record<BookingStatus, string> = {
  BOOKED: 'записан',
  CANCELLED: 'отменена',
  ATTENDED: 'пришёл',
  NO_SHOW: 'неявка',
};

/**
 * Что написать в статусе.
 *
 * Началась, а статус всё ещё «записан» — значит, клуб её не отметил. То же
 * слово, что видит у себя клиент в «Моих записях»: администратор и человек
 * должны читать одно и то же.
 */
function statusOf(entry: ClubPersonEntry): string {
  return entry.status === 'BOOKED' && !entry.cancellable ? 'ждёт отметки' : STATUS_LABELS[entry.status];
}

function EntryRow({ entry }: { entry: ClubPersonEntry }) {
  const charged =
    (entry.status === 'CANCELLED' || entry.status === 'NO_SHOW') && (entry.chargePercent ?? 0) > 0
      ? `, списано ${entry.chargePercent}%`
      : entry.status === 'NO_SHOW' && entry.chargePercent === 0
        ? ', без списания'
        : '';

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
      <span className="min-w-[9rem] text-[0.875rem] tabular-nums">{fullMoment(entry.startsAt)}</span>

      <span className="min-w-[12rem] flex-1">
        <span className="block text-[0.9375rem]">{entry.title}</span>
        <span className="mt-0.5 block text-[0.8125rem] text-text-muted">
          {[entry.subtitle, formatKopecks(entry.price)].filter(Boolean).join(' · ')}
        </span>
      </span>

      <span className="text-[0.8125rem] text-text-muted">
        <span
          className={cn(
            entry.status === 'ATTENDED' && 'text-text-accent',
            entry.status === 'NO_SHOW' && entry.chargePercent !== 0 && 'text-warning',
            entry.status === 'BOOKED' && !entry.cancellable && 'text-warning',
          )}
        >
          {statusOf(entry)}
          {charged}
        </span>
        {entry.mark && (
          <span className="text-text-subtle">
            {' · '}
            {entry.mark.auto ? 'отметила система' : `отметил ${entry.mark.by ?? '—'}`}
            {entry.mark.reason ? ` · «${entry.mark.reason}»` : ''}
          </span>
        )}
      </span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mt-4 grid gap-6" aria-busy="true">
      <span className="block h-7 w-64 rounded-full bg-border/50" />
      <div className="grid gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <div key={tile} className="bg-surface-raised px-5 py-4">
            <span className="block h-2.5 w-24 rounded-full bg-border/60" />
            <span className="mt-3 block h-6 w-16 rounded-full bg-border/50" />
          </div>
        ))}
      </div>
      <div className="h-64 rounded-card border border-border bg-surface-raised" />
    </div>
  );
}

/** «12.09.2026, 18:30» — по часам браузера: администратор в своём зале. */
function fullMoment(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

/**
 * «34 года» из даты рождения.
 *
 * Возраст, а не дата: у стойки важно, взрослый перед тобой или ребёнок, а
 * пересчитывать «2011 год» в голове администратору незачем.
 */
function age(birthDate: string): string {
  // Годы считает общий пакет — тот же, по которому сервер решает, записывается
  // ли человек сам или за него пишет родитель.
  const years = fullYears(new Date(`${birthDate}T00:00:00Z`), new Date());

  const mod100 = years % 100;
  const mod10 = years % 10;
  const word =
    mod100 >= 11 && mod100 <= 14 ? 'лет' : mod10 === 1 ? 'год' : mod10 >= 2 && mod10 <= 4 ? 'года' : 'лет';

  return `${years} ${word}`;
}
