'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  availableInAny,
  coachingYearsLabel,
  publicRankLabel,
  ratingNote,
  restrictionsLabel,
  type ClubCatalogItem,
  type PublicPlan,
  type PublicTenant,
} from '@yenisey/types';
import { CoachHeart } from '@/components/coach/CoachHeart';
import { AvatarPlaceholder } from '@/components/player/AvatarPlaceholder';
import { planGroups, PlanGroupCard, PLANS_ANCHOR } from '@/components/subscriptions/PlanList';
import { CompactSelect } from '@/components/ui/CompactSelect';
import { CARD_COVER as COVER, CardRow } from '@/components/ui/CardRow';
import { Tab } from '@/components/ui/Tab';
import { api } from '@/lib/api';
import { formatKopecks } from '@/lib/money';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { useFileUrl } from '@/lib/useFileUrl';
import { useSession } from '@/lib/useSession';
import { KindBadge, shortWhen } from './EventRow';
import { HallMenu } from './HallMenu';
import { SectionHeading } from './SectionHeading';

/**
 * Мероприятия, тренеры и абонементы клуба вкладками (решения владельца от
 * 25, 27 и 30.09.2026; вид — от 17.10.2026).
 *
 * С 17.10.2026: свой фильтр по залам справа в заголовке (тот же `HallMenu`,
 * что в «Предстоящих», у каждого блока свой выбор); карточки — одним рядом,
 * по четыре, больше четырёх — каруселью по кругу, одна под другой не встают.
 * Карточки видов и тренеров — высокие прямоугольники 9:16: тренер
 * показывает себя на фото в полный рост.
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
    'Виды тренировок и турниров с ценой и ближайшей датой. Кнопка «Показать расписание» оставит в «Предстоящих» только этот вид.',
  trenery: 'Кто ведёт занятия. В карточке тренера — достижения, инвентарь и цены.',
  [PLANS_ANCHOR]:
    'С абонементом не нужно платить за каждую запись: визит списывается при записи и возвращается при отмене. Купить абонемент можно у администратора клуба.',
};

/** Якорь самих вкладок — к нему прокручивает переход по `#abonementy`. */
export const TABS_ANCHOR = 'o-klube';


export function ClubTabs({
  tenant,
  catalog,
  plans,
  onShowSchedule,
}: {
  tenant: PublicTenant | null;
  /** Виды по всему клубу; при фильтре залов вкладка читает свои. */
  catalog: ClubCatalogItem[] | null;
  plans: PublicPlan[] | null;
  /** «Показать расписание» у вида — фильтр в «Предстоящих» и прокрутка к ним. */
  onShowSchedule: (item: ClubCatalogItem) => void;
}) {
  const [active, setActive] = useState<TabId>('meropriyatiya');
  const [fromHash, setFromHash] = useState(false);
  const halls = useTabHalls(tenant);

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

  // Фильтр залов: виды и тренеры — те, что там есть, тарифы — те, что
  // покрывают хоть один доступный там вид. «Ближайшее» у вида — в выбранных
  // залах: его считает сервер (`catalog?halls=`), как и список «Предстоящих».
  const hallCatalog = useHallCatalog(halls.ids, catalog);
  const scoped = scopeTo(halls.ids, tenant, hallCatalog, plans);

  const counts: Record<TabId, number | null> = {
    meropriyatiya: scoped.catalog?.length ?? null,
    trenery: scoped.tenant?.coaches.length ?? null,
    [PLANS_ANCHOR]: scoped.plans ? planGroups(scoped.plans).length : null,
  };

  return (
    <section id={TABS_ANCHOR} className="section-rule mb-14 scroll-mt-48">
      <SectionHeading
        title="Мероприятия, тренеры и абонементы"
        description="Виды занятий и турниров, тренеры и абонементы клуба — по вкладкам."
        action={
          tenant && tenant.halls.length > 1 ? (
            <HallMenu halls={tenant.halls} value={halls.ids} onChange={halls.choose} />
          ) : undefined
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
            <Tab key={tab.id} inTablist active={active === tab.id} onClick={() => choose(tab.id)} badge={counts[tab.id] || undefined}>
              {tab.label}
            </Tab>
          ))}
        </div>
      </div>

      <p className="mb-5 text-[0.875rem] text-text-muted">{TAB_LEADS[active]}</p>

      <div role="tabpanel" aria-label={TABS.find((tab) => tab.id === active)!.label}>
        {active === 'meropriyatiya' && <CatalogTab catalog={scoped.catalog} onShowSchedule={onShowSchedule} />}
        {active === 'trenery' && <CoachesTab tenant={scoped.tenant} />}
        {active === PLANS_ANCHOR && <PlansTab plans={scoped.plans} />}
      </div>
    </section>
  );
}

/**
 * Фильтр залов вкладок — свой, отдельно от «Предстоящих». Помнит браузер,
 * у каждого клуба свой ключ; зал, которого у клуба больше нет, отбрасывается,
 * а все залы разом — то же, что без фильтра.
 */
function useTabHalls(tenant: PublicTenant | null): { ids: string[] | null; choose: (ids: string[] | null) => void } {
  const slug = useClubSlug();
  const key = `yenisey.tabHalls.${slug}`;
  const [saved, setSaved] = useState<string[] | null>(null);

  useEffect(() => {
    try {
      const value = JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown;
      if (Array.isArray(value) && value.every((id) => typeof id === 'string')) setSaved(value);
    } catch {
      // нет хранилища — без фильтра
    }
  }, [key]);

  const choose = useCallback(
    (ids: string[] | null) => {
      setSaved(ids);
      try {
        window.localStorage.setItem(key, JSON.stringify(ids));
      } catch {
        // не запомнили — не беда
      }
    },
    [key],
  );

  const ids = useMemo(() => {
    if (!tenant || !saved) return null;
    const known = saved.filter((id) => tenant.halls.some((hall) => hall.id === id));
    return known.length === 0 || known.length === tenant.halls.length ? null : known;
  }, [tenant, saved]);

  return { ids, choose };
}

/** Виды с «Ближайшим» в выбранных залах; без фильтра — общий список страницы. */
function useHallCatalog(hallIds: string[] | null, catalog: ClubCatalogItem[] | null): ClubCatalogItem[] | null {
  const club = useClubApi();
  const halls = hallIds?.join(',') ?? '';
  const [scoped, setScoped] = useState<{ halls: string; items: ClubCatalogItem[] } | null>(null);

  useEffect(() => {
    if (!halls) return;
    let cancelled = false;

    club
      .catalog(halls)
      .then((items) => {
        if (!cancelled) setScoped({ halls, items });
      })
      .catch(() => {
        if (!cancelled) setScoped({ halls, items: [] });
      });

    return () => {
      cancelled = true;
    };
    // Перечитать и вслед за общим списком: после записи «ближайшее» сдвигается.
  }, [club, halls, catalog]);

  if (!halls) return catalog;

  return scoped?.halls === halls ? scoped.items : null;
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
 * Что вообще есть в клубе — все виды занятий и турниров, а не ближайшая
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
  const ofKind = kind === 'ALL' ? catalog : catalog.filter((item) => item.kind === kind);
  // Все виды сразу, чтобы число на вкладке совпадало с карточками (решение
  // владельца от 26.10.2026; прежде виды без проведений сворачивались в «Ещё N
  // без расписания»). Сперва идущие, следом те, что сейчас не в расписании.
  const shown = [
    ...ofKind.filter((item) => item.nextStartsAt !== null),
    ...ofKind.filter((item) => item.nextStartsAt === null),
  ];

  const kinds = (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Вид мероприятий">
      {CATALOG_KINDS.map((item) => (
        <Tab key={item.value} active={kind === item.value} onClick={() => setKind(item.value)} badge={count(item.value)}>
          {item.label}
        </Tab>
      ))}
    </div>
  );

  return (
    <div>
      {shown.length === 0 ? (
        <>
          <div className="mb-4">{kinds}</div>
          <Empty>{CATALOG_EMPTY[kind]}</Empty>
        </>
      ) : (
        <CardRow
          items={shown}
          keyOf={(item) => `${item.kind}-${item.typeId}`}
          label="Мероприятия клуба — листайте вбок"
          toolbar={kinds}
          render={(item) => <CatalogCard item={item} onShowSchedule={onShowSchedule} />}
        />
      )}

    </div>
  );
}


/**
 * Вид мероприятия — прямоугольник 9:16: сверху обложка в цвете клуба с
 * видом и названием, ниже описание, цена, ближайшая дата и расписание.
 */
function CatalogCard({ item, onShowSchedule }: { item: ClubCatalogItem; onShowSchedule: (item: ClubCatalogItem) => void }) {
  return (
    <article className="flex aspect-[9/16] h-full flex-col overflow-hidden rounded-card border border-border bg-surface-raised">
      <div className="flex h-[42%] shrink-0 flex-col justify-between p-4" style={{ background: COVER }}>
        <KindBadge kind={item.kind} />
        <h3 className="font-display text-[1.0625rem] leading-tight text-white [text-wrap:balance]">
          {item.name}
          {ratingNote(item.name, item.ratingSystem, item.ratingLabel) && (
            <span className="mt-1 block font-sans text-[0.8125rem] text-white/70">
              {ratingNote(item.name, item.ratingSystem, item.ratingLabel)}
            </span>
          )}
          {restrictionsLabel(item.restrictions) && (
            <span className="mt-1 block font-sans text-[0.8125rem] text-white/70">{restrictionsLabel(item.restrictions)}</span>
          )}
        </h3>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        {item.description ? (
          <p className="line-clamp-5 text-[0.8125rem] leading-relaxed whitespace-pre-line text-text-muted">{item.description}</p>
        ) : (
          <p className="text-[0.875rem] text-text-subtle">Описания пока нет.</p>
        )}

        <div className="mt-auto pt-4">
          <p className="font-display text-[1.0625rem] text-text">{formatKopecks(item.price)}</p>
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
      </div>
    </article>
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
    return <Empty>Тренеров здесь пока нет.</Empty>;
  }

  return (
    <CardRow
      items={tenant.coaches}
      keyOf={(coach) => coach.id}
      label="Тренеры клуба — листайте вбок"
      render={(coach) => (
        <div className="relative h-full">
          {!(session.status === 'ready' && session.user.id === coach.id) && session.status !== 'loading' && (
            <CoachHeart
              coachId={coach.id}
              size="sm"
              anonymous={session.status === 'anonymous'}
              favourite={session.status === 'anonymous' ? false : favourites ? favourites.has(coach.id) : null}
              onChange={(list) => setFavourites(new Set(list.map((item) => item.id)))}
              className="absolute top-3 right-3 z-10"
            />
          )}
          <CoachCard coach={coach} />
        </div>
      )}
    />
  );
}

type Coach = PublicTenant['coaches'][number];

/**
 * Тренер — прямоугольник 9:16 во весь рост (решение владельца от 17.10.2026):
 * фото на всю карточку, имя, «Ведёт» и цены — снизу поверх затемнения. Без
 * фото — рисованная заглушка на обложке в цвете клуба.
 */
function CoachCard({ coach }: { coach: Coach }) {
  const url = useFileUrl(coach.photoFileId);

  return (
    <Link
      href={`/coaches/${coach.id}`}
      className="group relative block aspect-[9/16] overflow-hidden rounded-card border border-border"
      style={url ? undefined : { background: COVER }}
    >
      {url ? (
        // Обычный <img>, а не next/image: адрес — blob:, оптимизатору нечего с ним делать.
        <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
      ) : (
        // Заглушка — кружком на обложке; прямоугольником во всю карточку —
        // только настоящее фото (решение владельца от 26.10.2026).
        <span aria-hidden="true" className="absolute inset-x-[18%] top-[14%] block aspect-square overflow-hidden rounded-full opacity-90">
          <AvatarPlaceholder gender={coach.gender} />
        </span>
      )}

      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 via-black/60 to-transparent" />

      {/* У всех одинаково (решение владельца от 26.10.2026): имя, разряд,
          стаж и ссылка на профиль — четыре строки, и имена стоят вровень. Что
          тренер ведёт и почём — на его странице. */}
      <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 px-4 pb-4 text-white">
        <span className="font-display text-[1.0625rem] leading-tight group-hover:underline">{coach.name}</span>
        <span className="mt-1 truncate text-[0.8125rem] text-white/75" title={publicRankLabel(coach.rank)}>
          Разряд: <span className="text-white">{publicRankLabel(coach.rank)}</span>
        </span>
        <span className="text-[0.8125rem] text-white/75">
          Стаж: <span className="text-white">{coach.coachingSince === null ? '—' : coachingYearsLabel(coach.coachingSince)}</span>
        </span>
        <span className="mt-2 text-[0.8125rem] text-white/85 underline underline-offset-2">Подробнее в профиле</span>
      </span>
    </Link>
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
    <CardRow
      items={planGroups(plans)}
      keyOf={(group) => group.key}
      label="Абонементы клуба — листайте вбок"
      render={(group) => <PlanGroupCard plans={group.plans} />}
    />
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-card border border-dashed border-border px-5 py-8 text-[0.9375rem] text-text-muted">
      {children}
    </p>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-4" aria-busy="true">
      {[0, 1, 2, 3].map((key) => (
        <div key={key} className="aspect-[9/16] rounded-card border border-border bg-surface-raised max-sm:hidden max-sm:first:block max-sm:first:col-span-3 max-sm:first:w-[72%]" />
      ))}
    </div>
  );
}
