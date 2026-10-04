'use client';

import Link from 'next/link';
import { useState } from 'react';
import { openState, openStateLabel, type OpenState, type PublicTenant } from '@yenisey/types';
import { RiverBackdrop } from '@/components/brand/RiverBackdrop';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { EventViewer } from '@/lib/eventViewer';
import { formatKopecks } from '@/lib/money';
import { loginHref } from '@/lib/next';
import { plural } from '@/lib/plural';
import { ClubContacts } from './ClubAbout';
import { ClubMark } from './ClubMark';

/**
 * Обложка клуба — «витрина-журнал» (решение владельца от 30.09.2026, вариант
 * Д): крупное название, ценности строкой-манифестом, под ними факты — залы,
 * тренеры, цена стола «от», открыт ли клуб сейчас — и главные действия.
 *
 * Действия те же, что были под баннером: «Забронировать стол» (сотруднику не
 * показывается — бронь ссылается на карточку клиента; ребёнку до 14 — пояснение
 * вместо кнопки), запись на тренировку ведёт к расписанию, сердечко «мой
 * клуб». Фон — плоскость в цвете клуба с рекой: снимков у клуба нет (решение
 * от 02.10.2026), оформление — фирменный цвет и квадратный логотип.
 *
 * Внизу, под кнопками, — контакты клуба одной строкой (`ClubContacts`), в
 * правом верхнем углу — сердечко «мой клуб» иконкой (решение от 01.10.2026).
 *
 * Высота задана до ответа сервера — иначе содержимое страницы подпрыгивало
 * бы, когда приедут название и факты.
 */
export function ClubHero({
  tenant,
  slug,
  viewer,
  anonymous,
  favourite,
  onFavourite,
  onSchedule,
}: {
  tenant: PublicTenant | null;
  slug: string;
  viewer: EventViewer;
  anonymous: boolean;
  favourite: boolean | null;
  onFavourite: (value: boolean) => void;
  /** «Записаться на тренировку» — к расписанию. */
  onSchedule: () => void;
}) {
  const places = tenant ? [tenant.city, ...tenant.otherCities].filter(Boolean).join(', ') : '';
  const manifesto = tenant?.values.map((value) => value.title.replace(/[.!]+$/, '')).join('. ');

  return (
    <header className="relative mt-6 mb-4 overflow-hidden rounded-[1.375rem] text-white sm:mt-8">
      <div
        className="relative flex min-h-[23rem] flex-col justify-end px-6 pt-16 pb-7 sm:px-11 sm:pb-9"
        // Плоскость в цвете клуба, притемнённая: белый текст на произвольном
        // фирменном цвете иначе читался бы не всегда.
        style={{ background: 'color-mix(in oklab, var(--accent) 50%, var(--ink-950))' }}
      >
        <RiverBackdrop orientation="landscape" />
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(900px 320px at 85% -10%, color-mix(in oklab, var(--accent) 45%, transparent), transparent 65%)',
          }}
        />

        {/* Сердечко «мой клуб» — иконкой в правом верхнем углу обложки
            (решение от 01.10.2026). */}
        <div className="absolute top-5 right-5 z-20 sm:top-6 sm:right-6">
          <HeartButton slug={slug} anonymous={anonymous} favourite={favourite} onChange={onFavourite} />
        </div>

        <div className="relative z-10">
          <div className="min-w-0">
            {tenant ? (
              <>
                <div className="flex items-center gap-3">
                  <ClubMark club={tenant} size="sm" />
                  <p className="text-[0.75rem] font-semibold tracking-[0.12em] text-white/75 uppercase">
                    {places ? `${places} · ` : ''}клуб настольного тенниса
                  </p>
                </div>

                <h1 className="mt-4 font-display text-[2.25rem] leading-[0.98] text-white [overflow-wrap:anywhere] sm:text-[3.75rem]">
                  {tenant.name}
                </h1>

                {manifesto && (
                  <p className="mt-4 max-w-3xl font-display text-[1rem] leading-snug text-white/90 sm:text-[1.0625rem]">
                    {manifesto}.
                  </p>
                )}

                <Facts tenant={tenant} />
              </>
            ) : (
              <>
                <span className="block h-9 w-9 rounded-control bg-white/20" />
                <span className="mt-5 block h-12 w-80 max-w-full rounded-full bg-white/20" />
                <span className="mt-4 block h-4 w-96 max-w-full rounded-full bg-white/15" />
              </>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <BookingAction slug={slug} viewer={viewer} />
              <button
                type="button"
                onClick={onSchedule}
                className="inline-flex h-11 items-center rounded-control border border-white/40 bg-black/20 px-4 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-black/35"
              >
                Записаться на тренировку
              </button>
            </div>

            {viewer === 'child' && (
              <p className="mt-3 text-[0.875rem] text-white/80">
                Пока тебе нет 14, стол бронирует родитель — со своей страницы.
              </p>
            )}
          </div>

          {/* Контакты — внизу обложки, под кнопками, одной строкой (решение
              от 01.10.2026). */}
          {tenant && (
            <div className="mt-6 border-t border-white/15 pt-5">
              <ClubContacts tenant={tenant} />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/** Факты пилюлями: залы, тренеры, стол «от», открыт ли сейчас. */
function Facts({ tenant }: { tenant: PublicTenant }) {
  const halls = tenant.halls.length;
  const coaches = tenant.coaches.length;
  const cheapest = halls > 0 ? Math.min(...tenant.halls.map((hall) => hall.tableHourPrice)) : null;
  const open = clubOpenState(tenant.halls, new Date());

  const pill = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.8125rem] font-medium';

  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {halls > 0 && (
        <span className={cn(pill, 'bg-white/15')}>
          {halls} {plural(halls, 'зал', 'зала', 'залов')}
        </span>
      )}
      {coaches > 0 && (
        <span className={cn(pill, 'bg-white/15')}>
          {coaches} {plural(coaches, 'тренер', 'тренера', 'тренеров')}
        </span>
      )}
      {cheapest !== null && <span className={cn(pill, 'bg-white/15')}>стол от {formatKopecks(cheapest)}/час</span>}
      {open && (
        <span className={cn(pill, open.open ? 'bg-white text-ink-950' : 'bg-black/30 text-white/85')}>
          <span
            aria-hidden="true"
            className={cn('h-1.5 w-1.5 rounded-full', open.open ? 'bg-accent' : 'bg-white/60')}
          />
          {openStateLabel(open)}
        </span>
      )}
    </div>
  );
}

/**
 * Открыт ли клуб: хоть один зал открыт — «открыто до» самого позднего из
 * открытых; все закрыты — ближайшее открытие. Часов нет ни у одного — null.
 */
export function clubOpenState(halls: PublicTenant['halls'], now: Date): OpenState | null {
  const states = halls
    .map((hall) => openState(hall.workingHours, now, hall.timezone))
    .filter((state): state is OpenState => state !== null);

  const open = states.filter((state): state is Extract<OpenState, { open: true }> => state.open);

  if (open.length > 0) {
    return open.reduce((latest, state) => (state.closesAt > latest.closesAt ? state : latest));
  }

  const closed = states.filter(
    (state): state is Extract<OpenState, { open: false }> => !state.open && state.opensAt !== null,
  );

  if (closed.length > 0) {
    return closed.reduce((soonest, state) => {
      const a = state.opensAt!;
      const b = soonest.opensAt!;
      return a.inDays < b.inDays || (a.inDays === b.inDays && a.time < b.time) ? state : soonest;
    });
  }

  return states.length > 0 ? states[0]! : null;
}

/**
 * «Забронировать стол». Сотруднику кнопки нет — бронь ссылается на карточку
 * клиента, которой у него нет. Ребёнку — пояснение под кнопками. Анониму —
 * сразу на сетку: она открыта без входа, вход понадобится на последнем шаге.
 */
function BookingAction({ slug, viewer }: { slug: string; viewer: EventViewer }) {
  if (viewer === 'staff' || viewer === 'child') {
    return null;
  }

  return (
    <Link
      href={`/clubs/${slug}/booking`}
      className="inline-flex h-11 items-center rounded-control bg-white px-4 text-[0.9375rem] font-semibold text-ink-950 transition-colors hover:bg-white/90"
    >
      Забронировать стол
    </Link>
  );
}

/**
 * Сердечко «мой клуб» (решение владельца от 24.09.2026): контур — не отмечен,
 * красная заливка — отмечен.
 *
 * Избранное и заявленная принадлежность — одна кнопка, а не две: разделять их
 * значило бы объяснять человеку разницу, которой в его голове нет. Анониму
 * сердечко ведёт ко входу и обратно сюда.
 */
function HeartButton({
  slug,
  anonymous,
  favourite,
  onChange,
}: {
  slug: string;
  anonymous: boolean;
  favourite: boolean | null;
  onChange: (value: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = favourite === true;
  const label = active ? 'Убрать из моих клубов' : 'Сделать клуб своим';

  async function toggle(): Promise<void> {
    setPending(true);
    setError(null);

    try {
      const clubs = active ? await api.removeClub(slug) : await api.addClub(slug);
      onChange(clubs.some((item) => item.slug === slug));
    } catch (cause) {
      // Отказ «клубов уже три» приходит сюда текстом от сервера: предел живёт
      // в базе, и повторять его здесь числом значило бы завести второе место,
      // где он записан.
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  const heart = (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path
        d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"
        fill={active ? '#e5484d' : 'none'}
        stroke={active ? '#e5484d' : 'currentColor'}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );

  // Только иконка (решение от 01.10.2026): красная заливка — свой клуб,
  // контур — нет. Слова — в подсказке и для диктора.
  const className = cn(
    'grid h-12 w-12 shrink-0 place-items-center rounded-full border border-white/40 bg-black/25 text-white backdrop-blur-sm',
    'transition-transform hover:scale-105 disabled:opacity-60',
  );

  return (
    <div className="flex flex-col items-end gap-2">
      {anonymous ? (
        <Link
          href={loginHref()}
          title="Войти, чтобы сделать клуб своим"
          aria-label="Войти, чтобы сделать клуб своим"
          className={className}
        >
          {heart}
        </Link>
      ) : (
        <button
          type="button"
          aria-pressed={active}
          title={label}
          aria-label={label}
          disabled={pending || favourite === null}
          onClick={() => void toggle()}
          className={className}
        >
          {heart}
        </button>
      )}

      {error && (
        <p
          className="max-w-xs rounded-control bg-black/60 px-3 py-2 text-right text-[0.8125rem] text-white"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
