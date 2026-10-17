'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { openState, openStateLabel, workingHoursLines, type PublicTenant } from '@yenisey/types';
import { Button } from '@/components/ui/Button';
import { CarouselArrow, LoopCarousel, useLoopCarousel } from '@/components/ui/LoopCarousel';
import { cn } from '@/lib/cn';
import type { EventViewer } from '@/lib/eventViewer';
import { formatKopecks } from '@/lib/money';
import { formatPhone } from '@/lib/phone';
import { plural } from '@/lib/plural';
import { streetOf } from '@/lib/hallAddress';
import { SectionHeading } from './SectionHeading';

/** Больше стольких залов — карусель, а не второй ряд. */
const PER_ROW = 3;

/**
 * Залы клуба (решения владельца от 17.10.2026): по три в ряд, больше трёх —
 * каруселью по кругу, как клубы на стартовой. Слева во всю высоту — полоса
 * в духе прежней обложки карточки: тёмный градиент цвета клуба. В карточке
 * сверху вниз — название, адрес (город, ниже улица), контакты, часы работы,
 * столы, цена часа аренды (робот — пометкой под ней) и сколько тренировок и
 * турниров в зале за ближайшую неделю.
 *
 * Строки карточек — общие строки сетки (CSS subgrid): высота строки — по
 * самой высокой ячейке в ней, поэтому строки соседних карточек стоят
 * вровень, а то, чего нет ни у одного зала (робот, кнопка брони), строки не
 * занимает вовсе. Фиксированные высоты оставляли бы пустое место там, где
 * у всех карточек пусто.
 */
export function HallCards({
  slug,
  tenant,
  viewer,
  title,
  description,
}: {
  slug: string;
  tenant: PublicTenant | null;
  viewer: EventViewer;
  title: string;
  description: string;
}) {
  const halls = tenant?.halls ?? [];
  const looped = halls.length > PER_ROW;
  const carousel = useLoopCarousel(halls.length, looped, halls.map((hall) => hall.id).join(','));

  // Бронирует стол клиент; сотруднику и ребёнку до 14 кнопки нет — и строки под неё тоже.
  const canBook = (viewer === 'client' || viewer === 'anonymous') && halls.some((hall) => hall.tables > 0);
  // Строк в карточке: название, адрес, контакты, часы, столы, цена, мероприятия (+ кнопка).
  const span = canBook ? 'row-span-8' : 'row-span-7';
  const cell = cn(span, 'grid grid-rows-subgrid gap-y-0');
  const card = (hall: Hall): ReactNode =>
    tenant && <HallCard hall={hall} tenant={tenant} slug={slug} canBook={canBook} span={span} />;

  return (
    <>
      <SectionHeading
        title={title}
        description={description}
        action={
          looped ? (
            // Стрелки — в строке заголовка, как у клубов на стартовой; на
            // телефоне ряд листают пальцем.
            <span className="hidden gap-2 sm:flex">
              <CarouselArrow side="left" label="Предыдущие залы" onClick={() => carousel.page(-1)} />
              <CarouselArrow side="right" label="Следующие залы" onClick={() => carousel.page(1)} />
            </span>
          ) : undefined
        }
      />

      {!tenant && <div className="h-64 rounded-card border border-border bg-surface-raised" aria-busy="true" />}

      {tenant && halls.length === 0 && (
        <p className="rounded-card border border-dashed border-border px-5 py-8 text-[0.9375rem] text-text-muted">
          Залы клуб пока не указал.
        </p>
      )}

      {tenant && halls.length > 0 && !looped && (
        <ul className="grid gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {halls.map((hall) => (
            <li key={hall.id} className={cell}>
              {card(hall)}
            </li>
          ))}
        </ul>
      )}

      {tenant && looped && (
        <LoopCarousel
          items={halls}
          keyOf={(hall) => hall.id}
          render={card}
          track={carousel.track}
          label="Залы клуба — листайте вбок"
          itemClassName={cell}
          layout={cn(
            'grid grid-flow-col gap-x-4 auto-cols-[85%] sm:auto-cols-[calc((100%-1rem)/2)] lg:auto-cols-[calc((100%-2rem)/3)]',
            canBook ? 'grid-rows-[repeat(8,auto)]' : 'grid-rows-[repeat(7,auto)]',
          )}
        />
      )}
    </>
  );
}

type Hall = PublicTenant['halls'][number];

function HallCard({
  hall,
  tenant,
  slug,
  canBook,
  span,
}: {
  hall: Hall;
  tenant: PublicTenant;
  slug: string;
  canBook: boolean;
  span: string;
}) {
  // Свои телефон и почта зала (решение от 25.09.2026), а без них — клуба.
  const phone = hall.phone ?? tenant.phone;
  const email = hall.email ?? tenant.email;
  const shared = hall.phone === null && hall.email === null && (phone !== null || email !== null);
  const street = streetOf(hall);
  const { trainings, tournaments } = hall.weekEvents;

  return (
    <article
      className={cn(
        span,
        'grid grid-cols-[2.625rem_minmax(0,1fr)] grid-rows-subgrid gap-y-0 overflow-hidden rounded-card border border-border bg-surface-raised',
      )}
    >
      {/* Полоса в духе прежней обложки (просьба владельца от 17.10.2026):
          цвет клуба, притемнённый к чернилам, и отблеск сверху. */}
      <span
        aria-hidden="true"
        className="col-start-1 row-span-full row-start-1"
        style={{
          background:
            'radial-gradient(160px 260px at 0% 0%, color-mix(in oklab, var(--accent) 60%, transparent), transparent 75%), linear-gradient(180deg, color-mix(in oklab, var(--accent) 45%, var(--ink-950)), var(--ink-950))',
        }}
      />

      <h3 className="col-start-2 px-5 pt-4 pb-1.5 font-display text-[1.1875rem] leading-snug">{hall.name}</h3>

      <Row label="Адрес" first>
        <span className="block">{hall.city ?? 'Город не указан'}</span>
        {street ? (
          <>
            <span className="block">{street}</span>
            <a
              href={mapHref(hall)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[0.8125rem] text-text-accent underline-offset-2 hover:underline"
            >
              На карте
            </a>
          </>
        ) : (
          <span className="block text-text-muted">адрес уточняйте у клуба</span>
        )}
      </Row>

      <Row label="Контакты">
        {phone && (
          <a href={`tel:${phone}`} className="block text-text-accent underline-offset-2 hover:underline">
            {formatPhone(phone)}
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} className="block break-all text-text-accent underline-offset-2 hover:underline">
            {email}
          </a>
        )}
        {!phone && !email && <span className="text-text-muted">не указаны</span>}
        {shared && <span className="block text-[0.75rem] text-text-subtle">общие контакты клуба</span>}
      </Row>

      <Row label="Часы работы">
        <Hours hall={hall} />
      </Row>

      <Row label="Столов">{hall.tables}</Row>

      <Row label="Аренда стола, час">
        <span className="font-display text-[1.0625rem] text-text-accent">{formatKopecks(hall.tableHourPrice)}</span>
        {hall.robotHourPrice !== null && (
          <span className="flex items-center gap-1.5 text-[0.8125rem] whitespace-nowrap text-text-muted">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--hue-amber)]" />
            С роботом — {formatKopecks(hall.robotHourPrice)}/час
          </span>
        )}
      </Row>

      <Row label="Мероприятий за 7 дней" last={!canBook}>
        {trainings + tournaments > 0 ? (
          `${trainings} ${plural(trainings, 'тренировка', 'тренировки', 'тренировок')}, ${tournaments} ${plural(tournaments, 'турнир', 'турнира', 'турниров')}`
        ) : (
          <span className="text-text-muted">пока нет</span>
        )}
      </Row>

      {canBook && (
        <div className="col-start-2 self-end px-5 pt-2 pb-5">
          {hall.tables > 0 && (
            <Link href={`/clubs/${slug}/booking?hall=${hall.id}`}>
              <Button size="sm" variant="gradient" className="w-full">
                Забронировать стол
              </Button>
            </Link>
          )}
        </div>
      )}
    </article>
  );
}

/** Строка карточки — ячейка общей строки сетки. */
function Row({ label, first, last, children }: { label: string; first?: boolean; last?: boolean; children: ReactNode }) {
  return (
    <div className={cn('col-start-2 px-5', first ? 'pt-1' : 'pt-2', last ? 'pb-4' : 'pb-2')}>
      <div className={cn(!first && 'border-t border-border pt-2')}>
        <p className="text-[0.75rem] text-text-subtle">{label}</p>
        <div className="text-[0.875rem] leading-snug text-text">{children}</div>
      </div>
    </div>
  );
}

/**
 * Часы работы — всегда: не указаны — так и написано, пустое место читалось бы
 * как «работает всегда». «Открыто сейчас» — по часам зала.
 */
function Hours({ hall }: { hall: Hall }) {
  if (!hall.workingHours) {
    return <span className="text-text-muted">не указаны, уточняйте по телефону</span>;
  }

  const state = openState(hall.workingHours, new Date(), hall.timezone);

  return (
    <>
      {state && (
        <span className={cn('flex items-center gap-1.5 font-medium', state.open ? 'text-text-accent' : 'text-text-muted')}>
          <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', state.open ? 'bg-accent' : 'bg-text-subtle')} />
          {openStateLabel(state)}
        </span>
      )}
      <ul className="mt-0.5 text-text-muted" aria-label="Часы работы по дням">
        {workingHoursLines(hall.workingHours).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </>
  );
}

/**
 * Где зал: город и адрес одной строкой. Город приписывается, только если его
 * в адресе ещё нет: DaData пишет «г Красноярск, ул …», и «Красноярск, г
 * Красноярск» читалось бы как ошибка вёрстки.
 */
function placeOf(hall: Hall): string {
  if (!hall.address) {
    return hall.city ?? '';
  }

  const repeats = hall.city !== null && hall.address.toLowerCase().includes(hall.city.toLowerCase());

  return repeats || !hall.city ? hall.address : `${hall.city}, ${hall.address}`;
}

/** Яндекс.Карты: по координатам дома, а без них — поиском по адресу. */
function mapHref(hall: Hall): string {
  if (hall.latitude !== null && hall.longitude !== null) {
    return `https://yandex.ru/maps/?pt=${hall.longitude},${hall.latitude}&z=17&l=map`;
  }

  return `https://yandex.ru/maps/?text=${encodeURIComponent(placeOf(hall))}`;
}
