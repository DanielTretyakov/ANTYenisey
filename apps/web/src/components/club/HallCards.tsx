'use client';

import Link from 'next/link';
import {
  localWeekMinute,
  openState,
  openStateLabel,
  WEEKDAY_SHORT,
  workingHoursLines,
  type PublicTenant,
} from '@yenisey/types';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { EventViewer } from '@/lib/eventViewer';
import { formatKopecks } from '@/lib/money';
import { plural } from '@/lib/plural';

/**
 * Залы: куда ехать, когда открыто, почём стол, где на карте. Адрес — крупно:
 * ради него на страницу и приходят (решение владельца от 25.09.2026). Часы
 * работы и «открыто сейчас» — на виду, шапка карточки — в цвете клуба
 * (решение от 30.09.2026).
 */
export function HallCards({
  slug,
  tenant,
  viewer,
}: {
  slug: string;
  /** Клуб с залами, уже суженными выбором зала. */
  tenant: PublicTenant | null;
  viewer: EventViewer;
}) {
  if (!tenant) {
    return <div className="h-64 rounded-card border border-border bg-surface-raised" aria-busy="true" />;
  }

  if (tenant.halls.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-border px-5 py-8 text-[0.9375rem] text-text-muted">
        Залы клуб пока не указал.
      </p>
    );
  }

  // Бронирует стол клиент; сотруднику и ребёнку до 14 кнопка не нужна.
  const canBook = viewer === 'client' || viewer === 'anonymous';

  return (
    // Один зал — карточка во всю ширину колонки текста; несколько — сеткой.
    <ul className={cn('grid gap-5', tenant.halls.length === 1 ? 'max-w-2xl' : 'md:grid-cols-2')}>
      {tenant.halls.map((hall) => (
        <li key={hall.id} className="flex flex-col overflow-hidden rounded-card border border-border bg-surface-raised">
          {/* Обложка карточки в цвете клуба (вариант Д от 30.09.2026): место
              под снимок зала, пока его нет — плоскость с отблеском. */}
          <div
            className="relative flex h-28 items-end px-5 pb-3"
            style={{
              background:
                'radial-gradient(420px 140px at 90% 0%, color-mix(in oklab, var(--accent) 55%, transparent), transparent 70%), linear-gradient(135deg, color-mix(in oklab, var(--accent) 45%, var(--ink-950)), var(--ink-950))',
            }}
          >
            <OpenBadge hall={hall} />
          </div>
          <h3 className="px-5 pt-4 font-display text-[1.1875rem] leading-snug">{hall.name}</h3>

          <div className="flex flex-1 flex-col px-5 pt-3 pb-5">
            <div className="flex items-start gap-2.5">
              <PinIcon />
              <div className="min-w-0">
                {hall.address ? (
                  <>
                    <p className="text-[1rem] leading-snug text-text">{placeOf(hall)}</p>
                    <a
                      href={mapHref(hall)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-[0.875rem] text-text-accent underline-offset-2 hover:underline"
                    >
                      На карте
                    </a>
                  </>
                ) : (
                  <p className="text-[0.9375rem] text-text-muted">
                    {hall.city ? `${hall.city} — ` : ''}адрес уточняйте{' '}
                    {tenant.phone ? (
                      <a href={`tel:${tenant.phone}`} className="text-text-accent underline-offset-2 hover:underline">
                        по телефону
                      </a>
                    ) : (
                      'у клуба'
                    )}
                  </p>
                )}
              </div>
            </div>

            <HallContacts hall={hall} tenant={tenant} />

            <HallHours hall={hall} />

            <dl className="mt-4 grid grid-cols-2 gap-2 text-[0.8125rem]">
              <PriceTile label="Стол, час" value={formatKopecks(hall.tableHourPrice)} />
              <PriceTile label="Дальше, полчаса" value={formatKopecks(hall.tableExtra30MinPrice)} />
              {hall.robotHourPrice !== null && (
                <PriceTile label="С роботом, час" value={formatKopecks(hall.robotHourPrice)} />
              )}
              <PriceTile label="Столов" value={`${hall.tables} ${plural(hall.tables, 'стол', 'стола', 'столов')}`} />
            </dl>

            {canBook && hall.tables > 0 && (
              <div className="mt-auto pt-5">
                <Link href={`/clubs/${slug}/booking?hall=${hall.id}`}>
                  <Button size="sm">Забронировать в этом зале</Button>
                </Link>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

type Hall = PublicTenant['halls'][number];

/** «Открыто до 23:00» — заливкой цвета клуба; закрыто — приглушённо. */
function OpenBadge({ hall }: { hall: Hall }) {
  const state = openState(hall.workingHours, new Date(), hall.timezone);

  if (!state) {
    return null;
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.8125rem] font-medium whitespace-nowrap',
        state.open ? 'bg-white text-ink-950' : 'bg-black/45 text-white/85 backdrop-blur-sm',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('h-1.5 w-1.5 rounded-full', state.open ? 'bg-accent' : 'bg-white/60')}
      />
      {openStateLabel(state)}
    </span>
  );
}

/**
 * Часы работы — всегда отдельным блоком: «сегодня» крупно, неделя строками.
 * Не указаны — так и написано: пустое место читалось бы как «работает всегда».
 */
function HallHours({ hall }: { hall: Hall }) {
  const hours = hall.workingHours;

  if (!hours) {
    return (
      <div className="mt-4 flex items-start gap-2.5 rounded-control border border-dashed border-border px-3.5 py-3 text-[0.875rem] text-text-muted">
        <ClockIcon />
        <p>Часы работы клуб пока не указал — уточняйте по телефону.</p>
      </div>
    );
  }

  const { weekday } = localWeekMinute(new Date(), hall.timezone);
  const today = hours[weekday] ?? null;

  return (
    <div className="mt-4 rounded-control border border-border-accent/40 bg-surface-accent-soft/60 px-3.5 py-3 text-[0.875rem]">
      <p className="flex items-center gap-2.5 text-text">
        <ClockIcon />
        <span>
          <span className="text-text-muted">Сегодня, {WEEKDAY_SHORT[weekday]!.toLowerCase()}:</span>{' '}
          <span className="font-medium">{today ? `${today.open}–${today.close}` : 'выходной'}</span>
        </span>
      </p>
      <ul className="mt-1.5 pl-[1.625rem] text-text-muted" aria-label="Часы работы">
        {workingHoursLines(hours).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function PriceTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control border border-border px-3 py-2">
      <dt className="text-text-subtle">{label}</dt>
      <dd className="font-display text-[1.0625rem] text-text-accent">{value}</dd>
    </div>
  );
}

/**
 * Кому звонить про этот зал: свои телефон и почта зала (решение владельца от
 * 25.09.2026), а без них — клуба, с пометкой, что это общий номер.
 */
function HallContacts({ hall, tenant }: { hall: Hall; tenant: PublicTenant }) {
  const own = hall.phone !== null || hall.email !== null;
  const phone = hall.phone ?? tenant.phone;
  const email = hall.email ?? tenant.email;

  if (!phone && !email) {
    return null;
  }

  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.875rem]">
      {phone && (
        <a href={`tel:${phone}`} className="text-text-accent underline-offset-2 hover:underline">
          {phone}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className="text-text-accent underline-offset-2 hover:underline">
          {email}
        </a>
      )}
      {!own && <span className="text-[0.8125rem] text-text-subtle">общий номер клуба</span>}
    </p>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-text-accent" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.8V8l2.2 1.6" strokeLinecap="round" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="mt-0.5 h-4 w-4 shrink-0 text-text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M8 14.5s4.5-4.2 4.5-7.7a4.5 4.5 0 1 0-9 0c0 3.5 4.5 7.7 4.5 7.7Z" />
      <circle cx="8" cy="6.8" r="1.6" />
    </svg>
  );
}

/**
 * Где зал: город и адрес одной строкой. Город приписывается, только если его
 * в адресе ещё нет: DaData пишет «г Красноярск, ул …», и «Красноярск, г
 * Красноярск» читалось бы как ошибка вёрстки.
 */
function placeOf(hall: PublicTenant['halls'][number]): string {
  if (!hall.address) {
    return hall.city ?? '';
  }

  const repeats = hall.city !== null && hall.address.toLowerCase().includes(hall.city.toLowerCase());

  return repeats || !hall.city ? hall.address : `${hall.city}, ${hall.address}`;
}

/** Яндекс.Карты: по координатам дома, а без них — поиском по адресу. */
function mapHref(hall: PublicTenant['halls'][number]): string {
  if (hall.latitude !== null && hall.longitude !== null) {
    return `https://yandex.ru/maps/?pt=${hall.longitude},${hall.latitude}&z=17&l=map`;
  }

  return `https://yandex.ru/maps/?text=${encodeURIComponent(placeOf(hall))}`;
}
