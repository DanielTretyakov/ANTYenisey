'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BookingEntry, ClubCatalogItem, PublicPlan, PublicTenant } from '@yenisey/types';
import { ClubAbout } from '@/components/club/ClubAbout';
import { ClubGlance } from '@/components/club/ClubGlance';
import { ClubHero } from '@/components/club/ClubHero';
import { ClubNewsColumn, NEWS_ANCHOR } from '@/components/club/ClubNewsColumn';
import { ClubRatingColumn, RATING_ANCHOR } from '@/components/club/ClubRatingColumn';
import { ABOUT_ANCHOR, ClubSectionNav } from '@/components/club/ClubSectionNav';
import { ClubTabs, TABS_ANCHOR } from '@/components/club/ClubTabs';
import { HallCards } from '@/components/club/HallCards';
import {
  ALL_HALLS,
  HALL_PICKER_ANCHOR,
  HallPicker,
  normalizeSelection,
  selectedHallIds,
  type HallSelection,
} from '@/components/club/HallFilter';
import { RowSkeleton } from '@/components/club/EventRow';
import { SectionHeading } from '@/components/club/SectionHeading';
import { UPCOMING_ANCHOR, UpcomingEvents, type KindFilter } from '@/components/club/UpcomingEvents';
import { WhenSpan } from '@/components/club/When';
import { PersonSwitch } from '@/components/family/PersonSwitch';
import { PLANS_ANCHOR } from '@/components/subscriptions/PlanList';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Alert } from '@/components/ui/Alert';
import { api, ApiError } from '@/lib/api';
import { clubAccent } from '@/lib/clubTheme';
import { eventViewerOf } from '@/lib/eventViewer';
import { entryPriceLabel } from '@/lib/subscriptions';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { usePersonSwitch } from '@/lib/usePersonSwitch';
import { useSession } from '@/lib/useSession';

/**
 * Страница клуба.
 *
 * Вид — «витрина-журнал» (решение владельца от 30.09.2026, вариант Д):
 * обложка с фактами и главными действиями (`ClubHero`), липкое меню разделов,
 * мозаика из новостей, рейтинга и «коротко». Меняется только вид: блоки,
 * якоря и действия — прежние.
 *
 * Сверху вниз (решения владельца от 24, 25 и 27.09.2026): обложка с названием
 * и сердечком «мой клуб», «О клубе» — описание, ценности, контакты, — кнопка
 * аренды и «Мои мероприятия». Дальше общее для всех залов — новости и рейтинг
 * в две колонки. Под ними — выбор зала, крупно: от него зависит всё ниже, —
 * вкладки зала «Зал · Мероприятия · Тренеры · Абонементы» и «Предстоящие» в
 * этом зале — неделей или календарём месяца, с фильтром по виду мероприятия.
 *
 * «Мои мероприятия» — выше «Предстоящих», как требует ТЗ, и выше всего
 * общего: на страницу клуба заходят чаще всего чтобы посмотреть, куда уже
 * записан и когда идти, а не чтобы выбрать новое.
 *
 * Оформление берётся у клуба: `clubAccent` подменяет акцентные переменные на
 * обёртке страницы, и все компоненты внутри перекрашиваются сами — они
 * называют роль («цвет действия»), а не краску. Клуб без своего цвета
 * остаётся в изумруде платформы.
 */
/** Пункты липкого меню — якоря блоков, порядок — как на странице. */
const SECTIONS = [
  { id: ABOUT_ANCHOR, label: 'О клубе' },
  { id: NEWS_ANCHOR, label: 'Новости' },
  { id: RATING_ANCHOR, label: 'Рейтинг' },
  { id: HALL_PICKER_ANCHOR, label: 'Залы' },
  { id: 'meropriyatiya', label: 'Мероприятия', scrollTo: TABS_ANCHOR },
  { id: 'trenery', label: 'Тренеры', scrollTo: TABS_ANCHOR },
  { id: PLANS_ANCHOR, label: 'Абонементы', scrollTo: TABS_ANCHOR },
  { id: UPCOMING_ANCHOR, label: 'Расписание' },
];

const TAB_IDS = ['meropriyatiya', 'trenery', PLANS_ANCHOR];

export default function ClubPage() {
  const slug = useClubSlug();
  const club = useClubApi();
  const session = useSession();
  const family = usePersonSwitch();
  const forPerson = family.forPerson;

  const [tenant, setTenant] = useState<PublicTenant | null>(null);
  // Счётчик перечитываний «Предстоящих»: список грузит сам блок (у него своя
  // неделя), страница только говорит «после записи прочитай заново».
  const [eventsVersion, setEventsVersion] = useState(0);
  const [mine, setMine] = useState<BookingEntry[] | null>(null);
  const [favourite, setFavourite] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ClubCatalogItem[] | null>(null);
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [filter, setFilter] = useState<KindFilter | null>(null);
  const [halls, setHalls] = useState<HallSelection>(ALL_HALLS);

  // Выбор зала помнит браузер — у каждого клуба свой: человек из Абакана не
  // должен каждый раз заново отсеивать Красноярск. Хранилище может быть
  // недоступно (приватный режим) — тогда просто «все».
  const hallsKey = `yenisey.halls.${slug}`;

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(hallsKey) ?? 'null') as HallSelection | null;
      if (saved && typeof saved === 'object') setHalls({ city: saved.city ?? null, hallId: saved.hallId ?? null });
    } catch {
      // нет хранилища — остаёмся на «всех»
    }
  }, [hallsKey]);

  const chooseHalls = useCallback(
    (selection: HallSelection) => {
      setHalls(selection);
      try {
        window.localStorage.setItem(hallsKey, JSON.stringify(selection));
      } catch {
        // не запомнили — не беда
      }
    },
    [hallsKey],
  );

  // Выбранные залы; сохранённый зал, которого у клуба больше нет, — «все».
  const effectiveHalls = useMemo(
    () => (tenant ? normalizeSelection(tenant.halls, halls) : ALL_HALLS),
    [tenant, halls],
  );
  const hallIds = useMemo(
    () => (tenant ? selectedHallIds(tenant.halls, effectiveHalls) : null),
    [tenant, effectiveHalls],
  );
  // Названия выбранных залов — для строки «Залы: …» над расписанием.
  const hallNames = useMemo(
    () => (tenant && hallIds ? tenant.halls.filter((hall) => hallIds.includes(hall.id)).map((hall) => hall.name) : null),
    [tenant, hallIds],
  );

  // Новости и рейтинг — блоки, а не вкладки: переход по `#novosti` (из
  // сообщения клиентам и со стартовой) прокручивает к ним, когда обложка и
  // описание уже приехали, — иначе они столкнули бы блок вниз.
  // И по ссылке внутри страницы — тоже: смена якоря без перезагрузки.
  const loaded = tenant !== null;

  useEffect(() => {
    if (!loaded) return;

    const scroll = (): void => {
      const hash = window.location.hash.slice(1);

      // `#zaly` — прежняя вкладка залов: зал теперь у выбора зала.
      const target = hash === 'zaly' ? HALL_PICKER_ANCHOR : hash;

      if (target === NEWS_ANCHOR || target === RATING_ANCHOR || target === HALL_PICKER_ANCHOR) {
        requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: 'start' }));
      }
    };

    scroll();
    window.addEventListener('hashchange', scroll);

    return () => window.removeEventListener('hashchange', scroll);
  }, [loaded]);

  useEffect(() => {
    api
      .tenant(slug)
      .then(setTenant)
      .catch((cause: unknown) =>
        setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'),
      );
  }, [slug]);

  // Виды мероприятий нужны двоим — вкладке «Мероприятия клуба» и чипам
  // фильтра в «Предстоящих», — поэтому грузятся здесь, один раз. Перечитываются
  // вместе со списком: после записи «ближайшее» у вида могло сдвинуться. И при
  // смене зала: «Ближайшее» у вида — в выбранных залах, как список под ним.
  const catalogHalls = hallIds?.join(',') ?? '';

  useEffect(() => {
    club
      .catalog(catalogHalls || undefined)
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, [club, eventsVersion, catalogHalls]);

  useEffect(() => {
    club
      .publicPlans()
      .then(setPlans)
      .catch(() => setPlans([]));
  }, [club]);

  // «Показать расписание» у вида: фильтр — и к «Предстоящим».
  const showSchedule = useCallback((item: ClubCatalogItem) => {
    setFilter({ kind: item.kind, typeId: item.typeId });
    requestAnimationFrame(() =>
      document.getElementById(UPCOMING_ANCHOR)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }, []);

  // После записи или отмены — и в строке, и в окне — обновляются оба списка:
  // «Мои мероприятия» и отметка «записан» в предстоящих.
  const refreshEvents = useCallback(() => {
    setEventsVersion((value) => value + 1);
    club.myEvents(forPerson).then(setMine).catch(() => undefined);
  }, [club, forPerson]);

  // Мои мероприятия и отметка «мой клуб» — только для вошедших. Аноним видит
  // открытый список: клуб выбирают до того, как заводят учётку.
  useEffect(() => {
    if (session.status !== 'ready') {
      setMine(null);
      setFavourite(null);
      return;
    }

    club
      .myEvents(forPerson)
      .then(setMine)
      .catch(() => setMine([]));

    api
      .myClubs()
      .then((clubs) => setFavourite(clubs.some((item) => item.slug === slug)))
      .catch(() => setFavourite(null));
  }, [session.status, club, slug, forPerson]);

  // Переход к блоку по якорю. Вкладка — сменой якоря: её открывает `ClubTabs`.
  const jump = useCallback((anchor: string) => {
    const tab = TAB_IDS.includes(anchor);

    if (tab) window.location.hash = anchor;
    document.getElementById(tab ? TABS_ANCHOR : anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Кто смотрит — одним правилом с окном мероприятия (`eventViewerOf`).
  const viewer = eventViewerOf(session, slug, forPerson, family.selfIsChild);

  return (
    <div className="flex min-h-dvh flex-col bg-surface" style={clubAccent(tenant?.accentColor)}>
      <SiteHeader clubSlug={slug} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 sm:px-8">
        {/* Подписка клуба на КНТ приостановлена за неоплату (решение от
            02.10.2026): страница открыта, но записаться и забронировать нельзя. */}
        {tenant?.suspended && (
          <div className="mt-6">
            <Alert tone="warning">
              Клуб временно не принимает записи и брони. Записи, сделанные раньше, отменены без оплаты.
            </Alert>
          </div>
        )}
        <ClubHero
          tenant={tenant}
          slug={slug}
          viewer={viewer}
          anonymous={session.status === 'anonymous'}
          favourite={favourite}
          onFavourite={setFavourite}
          onSchedule={() => jump(UPCOMING_ANCHOR)}
        />

        <ClubSectionNav slug={slug} items={SECTIONS} />

        {error && <Alert>{error}</Alert>}

        <div id={ABOUT_ANCHOR} className="scroll-mt-48">
          <ClubAbout tenant={tenant} />
        </div>

        <PersonSwitch
          people={family.children}
          selected={family.selected}
          onChoose={family.choose}
          className="mb-10"
        />

        <MyEvents
          entries={mine}
          anonymous={session.status === 'anonymous'}
          whose={family.selected ? firstName(family.selected.fullName) : null}
          forPerson={forPerson}
          readOnly={family.selfIsChild}
        />

        {/* Общее для всех залов — до выбора зала (решение от 27.09.2026),
            мозаикой (решение от 30.09.2026, вариант Д): новости и рейтинг
            крупно, под ними — «коротко» о залах, записи и тренерах. */}
        <div className="mb-4 grid gap-10 lg:grid-cols-2 lg:gap-4">
          <ClubNewsColumn />
          <ClubRatingColumn />
        </div>

        <ClubGlance tenant={tenant} mine={mine} anonymous={session.status === 'anonymous'} onJump={jump} />

        {tenant && (
          <HallPicker halls={tenant.halls} value={effectiveHalls} onChange={chooseHalls}>
            <HallCards
              slug={slug}
              tenant={{ ...tenant, halls: hallIds ? tenant.halls.filter((hall) => hallIds.includes(hall.id)) : tenant.halls }}
              viewer={viewer}
            />
          </HallPicker>
        )}

        <ClubTabs
          tenant={tenant}
          catalog={catalog}
          plans={plans}
          hallIds={hallIds}
          onShowSchedule={showSchedule}
        />

        <UpcomingEvents
          slug={slug}
          version={eventsVersion}
          viewer={viewer}
          forPerson={forPerson}
          selfIsChild={family.selfIsChild}
          onChanged={refreshEvents}
          catalog={catalog}
          filter={filter}
          onFilter={setFilter}
          hallIds={hallIds}
          hallNames={hallNames}
        />
      </main>

      <SiteFooter />
    </div>
  );
}

/** «Родителев Коля Олегович» → «Коля». */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[1] ?? fullName;
}

/**
 * Мои мероприятия в этом клубе: записи на турниры и свои брони столов. С
 * выбранным ребёнком — его.
 */
function MyEvents({
  entries,
  anonymous,
  whose,
  forPerson,
  readOnly,
}: {
  entries: BookingEntry[] | null;
  anonymous: boolean;
  /** Имя выбранного ребёнка — тогда список его. */
  whose: string | null;
  /** Выбранный ребёнок — «Мои записи» открываются за него. */
  forPerson: string | null;
  /** Смотрит сам ребёнок младше 14: отменять он не может. */
  readOnly: boolean;
}) {
  if (anonymous) {
    return null;
  }

  const upcoming = (entries ?? []).filter(
    (entry) => entry.status === 'BOOKED' && new Date(entry.startsAt).getTime() > Date.now(),
  );

  if (entries !== null && upcoming.length === 0) {
    return null;
  }

  return (
    <section id="moi" className="mb-14 scroll-mt-48">
      <SectionHeading
        title={whose ? `Мероприятия: ${whose}` : 'Мои мероприятия'}
        description={
          readOnly
            ? 'Куда ты записан в этом клубе. Записывает и отменяет родитель.'
            : 'Куда вы записаны в этом клубе — ближайшее сверху. Отменить запись можно в «Моих записях».'
        }
      />

      {entries === null ? (
        <RowSkeleton />
      ) : (
        <ul className="border-t border-border">
          {upcoming.map((entry) => (
            <li
              key={entry.entryId}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border py-4"
            >
              <WhenSpan startsAt={entry.startsAt} endsAt={entry.endsAt} timezone={entry.timezone} />

              <span className="min-w-0 grow">
                <span className="block text-[0.9375rem] text-text">{entry.title}</span>
                {entry.subtitle && (
                  <span className="block text-[0.8125rem] text-text-muted">{entry.subtitle}</span>
                )}
              </span>

              <span className="text-[0.875rem] whitespace-nowrap text-text-muted">
                {entryPriceLabel(entry)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[0.8125rem] text-text-subtle">
        {readOnly ? 'Прошедшие — в разделе' : 'Отменить запись и увидеть прошедшие можно в разделе'}{' '}
        <Link
          href={forPerson ? `/my-bookings?for=${forPerson}` : '/my-bookings'}
          className="text-text-accent underline-offset-2 hover:underline"
        >
          «Мои записи»
        </Link>
        .
      </p>
    </section>
  );
}
