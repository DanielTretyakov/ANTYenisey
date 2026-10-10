'use client';

import type { BookingEntry, PublicTenant } from '@yenisey/types';
import { openState, openStateLabel } from '@yenisey/types';
import { PlayerAvatar } from '@/components/player/PlayerView';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/plural';
import { shortWhen } from './EventRow';

/**
 * «Коротко» — ряд плиток мозаики под новостями и рейтингом (решение владельца
 * от 30.09.2026, вариант Д): открыт ли сейчас каждый зал, ближайшая своя
 * запись и тренеры клуба. Ничего нового здесь нет — те же данные, что ниже
 * на странице, собранные в один взгляд; плитки ведут к своим блокам.
 */
export function ClubGlance({
  tenant,
  mine,
  anonymous,
  onJump,
}: {
  tenant: PublicTenant | null;
  /** Записи смотрящего; null — грузятся или аноним. */
  mine: BookingEntry[] | null;
  anonymous: boolean;
  /** Переход к блоку страницы по якорю. */
  onJump: (anchor: string) => void;
}) {
  if (!tenant) {
    return null;
  }

  const now = new Date();
  const halls = tenant.halls.map((hall) => ({ hall, state: openState(hall.workingHours, now, hall.timezone) }));
  const next = (mine ?? [])
    .filter((entry) => entry.status === 'BOOKED' && new Date(entry.startsAt).getTime() > now.getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];

  const tile =
    'flex min-w-0 flex-col rounded-card border border-border bg-surface-raised px-5 py-4 text-left transition-colors hover:border-border-strong';
  const kicker = 'text-[0.75rem] font-semibold tracking-[0.1em] text-text-subtle uppercase';

  return (
    <div className="mb-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <button type="button" className={cn(tile, 'lg:col-span-2')} onClick={() => onJump('vybor-zala')}>
        <span className={kicker}>Сейчас</span>
        <ul className="mt-3 grid gap-1.5 text-[0.875rem] sm:grid-cols-2 sm:gap-x-6">
          {halls.slice(0, 4).map(({ hall, state }) => (
            <li key={hall.id} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn('h-2 w-2 shrink-0 rounded-full', state?.open ? 'bg-accent' : 'bg-text-subtle/50')}
              />
              <span className="min-w-0 truncate text-text">{hall.name}</span>
              <span className="ml-auto shrink-0 text-[0.8125rem] text-text-muted">
                {state ? shortOpen(openStateLabel(state)) : 'часы не указаны'}
              </span>
            </li>
          ))}
        </ul>
      </button>

      <button type="button" className={tile} onClick={() => onJump(next ? 'moi' : 'raspisanie')}>
        <span className={kicker}>Моя ближайшая запись</span>
        {next ? (
          <>
            <span className="mt-3 font-display text-[1.0625rem] text-text">{shortWhen(next.startsAt, next.timezone)}</span>
            <span className="mt-0.5 truncate text-[0.875rem] text-text-muted">{next.title}</span>
          </>
        ) : (
          <span className="mt-3 text-[0.875rem] text-text-muted">
            {anonymous ? 'Войдите — здесь появится ваша ближайшая запись.' : 'Пока никуда не записаны — расписание ниже.'}
          </span>
        )}
      </button>

      <button type="button" className={tile} onClick={() => onJump('trenery')}>
        <span className={kicker}>Тренеры</span>
        {tenant.coaches.length === 0 ? (
          <span className="mt-3 text-[0.875rem] text-text-muted">Тренеров в клубе пока нет.</span>
        ) : (
          <span className="mt-3 flex flex-col gap-2">
            <span className="flex -space-x-2.5">
              {tenant.coaches.slice(0, 5).map((coach) => (
                <span key={coach.id} className="rounded-full ring-2 ring-surface-raised">
                  <PlayerAvatar fileId={coach.photoFileId} name={coach.name} gender={coach.gender} size="xs" />
                </span>
              ))}
            </span>
            <span className="text-[0.875rem] text-text-muted" title={tenant.coaches.map((coach) => coach.name).join(', ')}>
              {tenant.coaches.length} {plural(tenant.coaches.length, 'тренер', 'тренера', 'тренеров')} →
            </span>
          </span>
        )}
      </button>
    </div>
  );
}

/** «Открыто до 23:00» → «до 23:00»: в плитке слово «открыто» говорит точка. */
function shortOpen(label: string): string {
  return label.replace(/^Открыто /, '').replace(/^Закрыто · откроется /, 'откроется ');
}
