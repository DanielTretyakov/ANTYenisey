'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  availableInAny,
  type ClubCatalogItem,
  type PublicPlan,
  type PublicTenant,
} from '@yenisey/types';
import { CoachHeart } from '@/components/coach/CoachHeart';
import { PlayerAvatar } from '@/components/player/PlayerView';
import { PlanGroups, PLANS_ANCHOR } from '@/components/subscriptions/PlanList';
import { CompactSelect } from '@/components/ui/CompactSelect';
import { Tab } from '@/components/ui/Tab';
import { api } from '@/lib/api';
import { formatKopecks } from '@/lib/money';
import { useSession } from '@/lib/useSession';
import { KindBadge, shortWhen } from './EventRow';
import { SectionHeading } from './SectionHeading';

/**
 * Вкладки выбранного зала (решения владельца от 25, 27 и 30.09.2026):
 * мероприятия, тренеры и абонементы. Всё — в пределах зала, выбранного выше.
 * Сам зал — карточкой прямо под выбором зала (`HallCards`), а не вкладкой:
 * выбрал зал — сразу видишь, где он и когда открыт.
 *
 * Выбранная вкладка живёт в адресе (`#meropriyatiya`…): ссылка «Больше абонементов»
 * из кабинета ведёт на `#abonementy` и обязана открыть именно её. Адрес
 * меняется через `replaceState` — переключение вкладки не должно ни
 * прокручивать страницу, ни копить историю «назад».
 */
const TABS = [
  { id: 'meropriyatiya', label: 'Мероприятия' },
  { id: 'trenery', label: 'Тренеры' },
  { id: PLANS_ANCHOR, label: 'Абонементы' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * Что во вкладке и что с ней можно сделать — строкой под лентой вкладок
 * (решение владельца от 30.09.2026: под каждым заголовком — описание).
 */
const TAB_LEADS: Record<TabId, string> = {
  meropriyatiya:
    'Чем здесь занимаются: виды тренировок и турниров с ценой и ближайшей датой. «Показать расписание» отберёт вид в «Предстоящих».',
  trenery: 'Кто ведёт занятия. В карточке тренера — достижения, инвентарь и цены.',
  [PLANS_ANCHOR]:
    'Абонемент оплачивает записи сам: визит списывается при записи и возвращается при отмене. Купить — у администратора клуба.',
};

/** Якорь самих вкладок — к нему прокручивает переход по `#abonementy`. */
export const TABS_ANCHOR = 'o-klube';

export function ClubTabs({
  tenant,
  catalog,
  plans,
  hallIds,
  onShowSchedule,
}: {
  tenant: PublicTenant | null;
  catalog: ClubCatalogItem[] | null;
  plans: PublicPlan[] | null;
  /** Выбранные фильтром залы; пусто — все (решение владельца от 25.09.2026). */
  hallIds: string[] | null;
  /** «Показать расписание» у вида — фильтр в «Предстоящих» и прокрутка к ним. */
  onShowSchedule: (item: ClubCatalogItem) => void;
}) {
  const [active, setActive] = useState<TabId>('meropriyatiya');
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
  // иначе обложка и описание, приехав позже, столкнули бы их вниз.
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

  // Фильтр залов: залы — выбранные, виды и тренеры — те, что там есть,
  // тарифы — те, что покрывают хоть один доступный там вид.
  const scoped = scopeTo(hallIds, tenant, catalog, plans);

  const counts: Record<TabId, number | null> = {
    meropriyatiya: scoped.catalog?.length ?? null,
    trenery: scoped.tenant?.coaches.length ?? null,
    [PLANS_ANCHOR]: scoped.plans?.length ?? null,
  };

  const labelOf = (tab: (typeof TABS)[number]): string => tab.label;

  // Заголовок блока — про выбранный зал, если он один (решение от 30.09.2026).
  const onlyHall = scoped.tenant?.halls.length === 1 ? scoped.tenant.halls[0]! : null;
  const canPick = (tenant?.halls.length ?? 0) >= 2;

  return (
    <section id={TABS_ANCHOR} className="mb-14 scroll-mt-48">
      <SectionHeading
        title={onlyHall && canPick ? `В зале «${onlyHall.name}»` : 'Мероприятия, тренеры и абонементы'}
        description={
          canPick
            ? 'Виды занятий и турниров, тренеры и абонементы — в зале, выбранном выше. Сменить зал — там же.'
            : 'Виды занятий и турниров, тренеры и абонементы клуба — по вкладкам.'
        }
      />

      {/* На телефоне — список: три вкладки со счётчиками в ширину не влезают
          (решение владельца от 03.10.2026). */}
      <CompactSelect
        label="Показать"
        value={active}
        options={TABS.map((tab) => ({ value: tab.id, label: counts[tab.id] ? `${tab.label} · ${counts[tab.id]}` : tab.label }))}
        onChange={(id) => {
          const tab = TABS.find((candidate) => candidate.id === id);
          if (tab) choose(tab.id);
        }}
        className="mb-3 sm:hidden"
      />

      <div className="-mx-1 mb-3 hidden overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:block">
        <div className="flex w-max gap-1.5 border-b border-border pb-3" role="tablist" aria-label="О клубе">
          {TABS.map((tab) => (
            <Tab
              key={tab.id}
              inTablist
              active={active === tab.id}
              onClick={() => choose(tab.id)}
              badge={counts[tab.id] || undefined}
            >
              {labelOf(tab)}
            </Tab>
          ))}
        </div>
      </div>

      <p className="mb-5 text-[0.875rem] text-text-muted">{TAB_LEADS[active]}</p>

      <div role="tabpanel" aria-label={labelOf(TABS.find((tab) => tab.id === active)!)}>
        {active === 'meropriyatiya' && <CatalogTab catalog={scoped.catalog} onShowSchedule={onShowSchedule} />}
        {active === 'trenery' && <CoachesTab tenant={scoped.tenant} />}
        {active === PLANS_ANCHOR && <PlansTab plans={scoped.plans} />}
      </div>
    </section>
  );
}

/** Всё содержимое вкладок — в пределах выбранных залов. */
function scopeTo(
  hallIds: string[] | null,
  tenant: PublicTenant | null,
  catalog: ClubCatalogItem[] | null,
  plans: PublicPlan[] | null,
): {
  tenant: PublicTenant | null;
  catalog: ClubCatalogItem[] | null;
  plans: PublicPlan[] | null;
} {
  if (!hallIds) {
    return { tenant, catalog, plans };
  }

  const scopedCatalog = catalog?.filter((item) => availableInAny(item.hallIds, hallIds)) ?? null;
  const usable = new Set((scopedCatalog ?? []).map((item) => `${item.kind}:${item.typeId}`));

  return {
    tenant: tenant && {
      ...tenant,
      halls: tenant.halls.filter((hall) => hallIds.includes(hall.id)),
      coaches: tenant.coaches.filter((coach) => availableInAny(coach.hallIds, hallIds)),
    },
    catalog: scopedCatalog,
    // Тариф без покрытия (или пока справочник не приехал) не прячем: нечем
    // решить, где он пригодится.
    plans:
      plans?.filter(
        // Аренда стола есть в любом зале — тариф с ней пригодится везде.
        (plan) =>
          plan.typeKeys.length === 0 ||
          catalog === null ||
          plan.typeKeys.some((key) => key === 'TABLE' || usable.has(key)),
      ) ?? null,
  };
}

/** Фильтр вкладки «Мероприятия» (решение владельца от 27.09.2026). */
type CatalogKind = 'ALL' | ClubCatalogItem['kind'];

const CATALOG_KINDS: { value: CatalogKind; label: string }[] = [
  { value: 'ALL', label: 'Все' },
  { value: 'TOURNAMENT', label: 'Турниры' },
  { value: 'TRAINING', label: 'Тренировки' },
];

const CATALOG_EMPTY: Record<CatalogKind, string> = {
  ALL: 'Занятий и турниров здесь пока нет.',
  TOURNAMENT: 'Турниров здесь пока нет.',
  TRAINING: 'Тренировок здесь пока нет.',
};

/**
 * Что вообще есть в зале — все виды занятий и турниров, а не ближайшая
 * неделя: человек выбирает клуб по тому, чем в нём занимаются. Сверху —
 * «Все · Турниры · Тренировки».
 */
function CatalogTab({
  catalog,
  onShowSchedule,
}: {
  catalog: ClubCatalogItem[] | null;
  onShowSchedule: (item: ClubCatalogItem) => void;
}) {
  const [kind, setKind] = useState<CatalogKind>('ALL');

  if (!catalog) {
    return <CardsSkeleton />;
  }

  const count = (value: CatalogKind): number =>
    value === 'ALL' ? catalog.length : catalog.filter((item) => item.kind === value).length;
  const shown = kind === 'ALL' ? catalog : catalog.filter((item) => item.kind === kind);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Вид мероприятий">
        {CATALOG_KINDS.map((item) => (
          <Tab
            key={item.value}
            active={kind === item.value}
            onClick={() => setKind(item.value)}
            badge={count(item.value)}
          >
            {item.label}
          </Tab>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty>{CATALOG_EMPTY[kind]}</Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((item) => (
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
                  {item.nextStartsAt ? `Ближайшее: ${shortWhen(item.nextStartsAt, item.nextTimezone)}` : 'Сейчас в расписании нет'}
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
      )}
    </div>
  );
}

/**
 * Тренерский состав — карточки-ссылки на страницы тренеров. Сердечко «в мои
 * тренеры» — в углу карточки, вне ссылки (решение от 02.10.2026): щелчок по
 * нему не уводит на страницу тренера.
 */
function CoachesTab({ tenant }: { tenant: PublicTenant | null }) {
  const session = useSession();
  const [favourites, setFavourites] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (session.status !== 'ready') return;

    api
      .myCoaches()
      .then((list) => setFavourites(new Set(list.map((item) => item.id))))
      .catch(() => setFavourites(new Set()));
  }, [session.status]);

  if (!tenant) {
    return <CardsSkeleton />;
  }

  if (tenant.coaches.length === 0) {
    return <Empty>Тренеров в клубе пока нет.</Empty>;
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
      {tenant.coaches.map((coach) => (
        <li key={coach.id} className="relative">
          {!(session.status === 'ready' && session.user.id === coach.id) && session.status !== 'loading' && (
            <CoachHeart
              coachId={coach.id}
              size="sm"
              anonymous={session.status === 'anonymous'}
              favourite={session.status === 'anonymous' ? false : favourites ? favourites.has(coach.id) : null}
              onChange={(list) => setFavourites(new Set(list.map((item) => item.id)))}
              className="absolute top-2.5 right-2.5 z-10"
            />
          )}
          <Link
            href={`/coaches/${coach.id}`}
            className="group flex h-full flex-col items-center rounded-card border border-border bg-surface-raised px-3 py-5 text-center transition-colors hover:border-border-strong sm:px-5 sm:py-6"
          >
            <PlayerAvatar fileId={coach.photoFileId} name={coach.name} gender={coach.gender} size="lg" />
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
    <PlanGroups plans={plans} />
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-card border border-dashed border-border px-5 py-8 text-[0.9375rem] text-text-muted">
      {children}
    </p>
  );
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
