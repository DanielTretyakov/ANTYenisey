'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ClubCatalogItem, PublicPlan, PublicTenant } from '@yenisey/types';
import { PlayerAvatar } from '@/components/player/PlayerView';
import { PlanGroups, PLANS_ANCHOR } from '@/components/subscriptions/PlanList';
import { Button } from '@/components/ui/Button';
import { Tab } from '@/components/ui/Tab';
import type { EventViewer } from '@/lib/eventViewer';
import { formatKopecks } from '@/lib/money';
import { plural } from '@/lib/plural';
import { KindBadge, shortWhen } from './EventRow';

/**
 * Четыре вкладки страницы клуба (решение владельца от 25.09.2026): залы,
 * что есть в клубе, тренерский состав и абонементы.
 *
 * Выбранная вкладка живёт в адресе (`#zaly`…): ссылка «Больше абонементов»
 * из кабинета ведёт на `#abonementy` и обязана открыть именно её. Адрес
 * меняется через `replaceState` — переключение вкладки не должно ни
 * прокручивать страницу, ни копить историю «назад».
 */
const TABS = [
  { id: 'zaly', label: 'Залы' },
  { id: 'meropriyatiya', label: 'Мероприятия клуба' },
  { id: 'trenery', label: 'Тренерский состав' },
  { id: PLANS_ANCHOR, label: 'Абонементы' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Якорь самих вкладок — к нему прокручивает переход по `#abonementy`. */
const TABS_ANCHOR = 'o-klube';

export function ClubTabs({
  slug,
  tenant,
  catalog,
  plans,
  viewer,
  onShowSchedule,
}: {
  slug: string;
  tenant: PublicTenant | null;
  catalog: ClubCatalogItem[] | null;
  plans: PublicPlan[] | null;
  viewer: EventViewer;
  /** «Показать расписание» у вида — фильтр в «Предстоящих» и прокрутка к ним. */
  onShowSchedule: (item: ClubCatalogItem) => void;
}) {
  const [active, setActive] = useState<TabId>('zaly');
  const [fromHash, setFromHash] = useState(false);

  // Вкладка из адреса. В эффекте, а не в начальном состоянии: на сервере
  // адреса нет, и разметка разошлась бы с первой отрисовкой в браузере.
  useEffect(() => {
    const read = (): void => {
      const hash = window.location.hash.slice(1);
      const found = TABS.find((tab) => tab.id === hash);

      if (found) {
        setActive(found.id);
        setFromHash(true);
      }
    };

    read();
    window.addEventListener('hashchange', read);

    return () => window.removeEventListener('hashchange', read);
  }, []);

  // Пришли по якорю — прокручиваем к вкладкам, когда выше всё загрузилось:
  // иначе баннер и описание, приехав позже, столкнули бы их вниз.
  const ready = tenant !== null && catalog !== null && plans !== null;

  useEffect(() => {
    if (fromHash && ready) {
      document.getElementById(TABS_ANCHOR)?.scrollIntoView({ block: 'start' });
      setFromHash(false);
    }
  }, [fromHash, ready]);

  const choose = (id: TabId): void => {
    setActive(id);
    window.history.replaceState(null, '', `#${id}`);
  };

  const counts: Record<TabId, number | null> = {
    zaly: tenant?.halls.length ?? null,
    meropriyatiya: catalog?.length ?? null,
    trenery: tenant?.coaches.length ?? null,
    [PLANS_ANCHOR]: plans?.length ?? null,
  };

  return (
    <section id={TABS_ANCHOR} className="mb-14 scroll-mt-24">
      <div className="-mx-1 mb-6 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        <div className="flex w-max gap-1.5 border-b border-border pb-3" role="tablist" aria-label="О клубе">
          {TABS.map((tab) => (
            <Tab
              key={tab.id}
              inTablist
              active={active === tab.id}
              onClick={() => choose(tab.id)}
              badge={counts[tab.id] || undefined}
            >
              {tab.label}
            </Tab>
          ))}
        </div>
      </div>

      <div role="tabpanel" aria-label={TABS.find((tab) => tab.id === active)?.label}>
        {active === 'zaly' && <HallsTab slug={slug} tenant={tenant} viewer={viewer} />}
        {active === 'meropriyatiya' && <CatalogTab catalog={catalog} onShowSchedule={onShowSchedule} />}
        {active === 'trenery' && <CoachesTab tenant={tenant} />}
        {active === PLANS_ANCHOR && <PlansTab plans={plans} />}
      </div>
    </section>
  );
}

/**
 * Залы: куда ехать, почём стол, где на карте. Адрес — крупно: ради него на
 * страницу и приходят (решение владельца от 25.09.2026).
 */
function HallsTab({ slug, tenant, viewer }: { slug: string; tenant: PublicTenant | null; viewer: EventViewer }) {
  if (!tenant) {
    return <CardsSkeleton />;
  }

  if (tenant.halls.length === 0) {
    return <Empty>Залы клуб пока не указал.</Empty>;
  }

  // Бронирует стол клиент; сотруднику и ребёнку до 14 кнопка не нужна.
  const canBook = viewer === 'client' || viewer === 'anonymous';

  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {tenant.halls.map((hall) => (
        <li key={hall.id} className="flex flex-col rounded-card border border-border bg-surface-raised px-5 py-5">
          <h3 className="text-[1.125rem]">{hall.name}</h3>

          <div className="mt-3 flex items-start gap-2.5">
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

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-4 text-[0.875rem]">
            <div>
              <dt className="text-text-subtle">Стол, час</dt>
              <dd className="font-display text-[1.0625rem] text-text">{formatKopecks(hall.tableHourPrice)}</dd>
            </div>
            <div>
              <dt className="text-text-subtle">Дальше, полчаса</dt>
              <dd className="font-display text-[1.0625rem] text-text">{formatKopecks(hall.tableExtra30MinPrice)}</dd>
            </div>
            {hall.robotHourPrice !== null && (
              <div>
                <dt className="text-text-subtle">С роботом, час</dt>
                <dd className="font-display text-[1.0625rem] text-text">{formatKopecks(hall.robotHourPrice)}</dd>
              </div>
            )}
            <div>
              <dt className="text-text-subtle">Столов</dt>
              <dd className="font-display text-[1.0625rem] text-text">
                {hall.tables} {plural(hall.tables, 'стол', 'стола', 'столов')}
              </dd>
            </div>
          </dl>

          {canBook && hall.tables > 0 && (
            <div className="mt-auto pt-5">
              <Link href={`/clubs/${slug}/booking?hall=${hall.id}`}>
                <Button variant="secondary" size="sm">
                  Забронировать в этом зале
                </Button>
              </Link>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Что вообще есть в клубе — все виды занятий и турниров, а не ближайшая
 * неделя: человек выбирает клуб по тому, чем в нём занимаются.
 */
function CatalogTab({
  catalog,
  onShowSchedule,
}: {
  catalog: ClubCatalogItem[] | null;
  onShowSchedule: (item: ClubCatalogItem) => void;
}) {
  if (!catalog) {
    return <CardsSkeleton />;
  }

  if (catalog.length === 0) {
    return <Empty>Занятий и турниров клуб пока не завёл.</Empty>;
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {catalog.map((item) => (
        <li
          key={`${item.kind}-${item.typeId}`}
          className="flex flex-col rounded-card border border-border bg-surface-raised px-5 py-5"
        >
          <KindBadge kind={item.kind} />
          <h3 className="mt-3 text-[1.125rem] leading-snug">
            {item.name}
            {item.ratingLabel && !item.name.includes(item.ratingLabel) && (
              <span className="ml-2 text-[0.8125rem] text-text-subtle">рейтинг до {item.ratingLabel}</span>
            )}
          </h3>
          {item.description && (
            <p className="mt-2 line-clamp-4 text-[0.875rem] leading-relaxed whitespace-pre-line text-text-muted">
              {item.description}
            </p>
          )}

          <div className="mt-auto pt-4">
            <p className="font-display text-[1.125rem] text-text">{formatKopecks(item.price)}</p>
            <p className="mt-0.5 text-[0.8125rem] text-text-muted">
              {item.nextStartsAt
                ? `Ближайшее: ${shortWhen(item.nextStartsAt)}`
                : 'Сейчас в расписании нет'}
              {item.upcomingCount > 1 && ` · всего впереди ${item.upcomingCount}`}
            </p>

            {item.upcomingCount > 0 && (
              <button
                type="button"
                onClick={() => onShowSchedule(item)}
                className="mt-3 text-[0.875rem] text-text-accent underline-offset-2 hover:underline"
              >
                Показать расписание →
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Тренерский состав — карточки-ссылки на страницы тренеров. */
function CoachesTab({ tenant }: { tenant: PublicTenant | null }) {
  if (!tenant) {
    return <CardsSkeleton />;
  }

  if (tenant.coaches.length === 0) {
    return <Empty>Тренеров в клубе пока нет.</Empty>;
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
      {tenant.coaches.map((coach) => (
        <li key={coach.id}>
          <Link
            href={`/coaches/${coach.id}`}
            className="group flex h-full flex-col items-center rounded-card border border-border bg-surface-raised px-3 py-5 text-center transition-colors hover:border-border-strong sm:px-5 sm:py-6"
          >
            <PlayerAvatar fileId={coach.photoFileId} name={coach.name} size="lg" />
            <span className="mt-4 text-[1.0625rem] text-text group-hover:underline">{coach.name}</span>
            {coach.leads.length > 0 && (
              <span className="mt-1 text-[0.8125rem] text-text-muted">Ведёт: {coach.leads.join(', ')}</span>
            )}
            <span className="mt-auto flex flex-wrap justify-center gap-1.5 pt-4">
              {coach.groupPrice !== null && <PricePill label="Группа" price={coach.groupPrice} />}
              {coach.individualPrice !== null && <PricePill label="Индивидуально" price={coach.individualPrice} />}
              {coach.groupPrice === null && coach.individualPrice === null && (
                <span className="text-[0.8125rem] text-text-subtle">Цены — у тренера</span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PricePill({ label, price }: { label: string; price: number }) {
  return (
    <span className="rounded-full border border-border px-2.5 py-1 text-[0.8125rem] text-text-muted">
      {label} <span className="text-text">{formatKopecks(price)}</span>
    </span>
  );
}

/** Все абонементы клуба — сюда ведёт «Больше абонементов» из кабинета. */
function PlansTab({ plans }: { plans: PublicPlan[] | null }) {
  if (!plans) {
    return <CardsSkeleton />;
  }

  if (plans.length === 0) {
    return <Empty>Абонементов клуб пока не продаёт — записи оплачиваются по цене мероприятия.</Empty>;
  }

  return (
    <div className="grid gap-4">
      <p className="text-[0.875rem] text-text-muted">
        Абонемент оплачивает записи сам: визит списывается при записи и возвращается при отмене. Купить — у
        администратора клуба.
      </p>
      <PlanGroups plans={plans} />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-card border border-dashed border-border px-5 py-8 text-[0.9375rem] text-text-muted">{children}</p>;
}

function CardsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-busy="true">
      {[0, 1].map((key) => (
        <div key={key} className="h-44 rounded-card border border-border bg-surface-raised" />
      ))}
    </div>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-text-accent" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
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
