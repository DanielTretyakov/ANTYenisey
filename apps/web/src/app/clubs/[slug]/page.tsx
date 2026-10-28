'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClubCatalogItem, PublicPlan, PublicTenant } from '@yenisey/types';
import NotFound from '@/app/not-found';
import { ClubAbout } from '@/components/club/ClubAbout';
import { ClubHero } from '@/components/club/ClubHero';
import { ClubNewsColumn, NEWS_ANCHOR } from '@/components/club/ClubNewsColumn';
import { ClubRatingColumn, RATING_ANCHOR } from '@/components/club/ClubRatingColumn';
import { ABOUT_ANCHOR, useSectionNav } from '@/components/club/ClubSectionNav';
import { ClubTabs, TABS_ANCHOR } from '@/components/club/ClubTabs';
import { HallCards } from '@/components/club/HallCards';
import { UPCOMING_ANCHOR, UpcomingEvents, type KindFilter } from '@/components/club/UpcomingEvents';
import { PersonSwitch } from '@/components/family/PersonSwitch';
import { PLANS_ANCHOR } from '@/components/subscriptions/PlanList';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Alert } from '@/components/ui/Alert';
import { api, ApiError } from '@/lib/api';
import { clubAccent } from '@/lib/clubTheme';
import { eventViewerOf } from '@/lib/eventViewer';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { usePersonSwitch } from '@/lib/usePersonSwitch';
import { useSession } from '@/lib/useSession';

/**
 * Страница клуба.
 *
 * Вид — «витрина-журнал» (решение владельца от 30.09.2026, вариант Д):
 * обложка с фактами и главными действиями (`ClubHero`), липкое меню разделов.
 *
 * Порядок — сперва действие, потом витрина (решение владельца от
 * 11.10.2026): человек, открывший клуб, хочет понять, когда прийти, куда и
 * почём. Раньше «Предстоящие» стояли последними — на телефоне на десятом
 * экране, под описанием, ценностями, новостями, рейтингом и карточками залов.
 * Сверху вниз: обложка; «Предстоящие»
 * неделей или месяцем, с фильтром по виду и по залам; вкладки
 * «Мероприятия · Тренеры · Абонементы»; карточки залов узкими прямоугольниками,
 * больше четырёх — каруселью; новости и рейтинг двумя колонками; «О клубе».
 * Плитки «коротко» сняты: они повторяли карточки залов, «Мои мероприятия» и
 * вкладку тренеров. Отдельный выбор зала над расписанием снят 17.10.2026 —
 * залы выбираются фильтром в самих «Предстоящих» и больше ничего не сужают.
 *
 * «Мои мероприятия» со страницы клуба сняты (решение владельца от
 * 26.10.2026): куда записан — в «Моём календаре», по всем клубам сразу.
 *
 * Оформление берётся у клуба: `clubAccent` подменяет акцентные переменные на
 * обёртке страницы, и все компоненты внутри перекрашиваются сами — они
 * называют роль («цвет действия»), а не краску. Клуб без своего цвета
 * остаётся в изумруде платформы.
 */
/** Карточки залов — свой блок ниже вкладок; `#zaly` ведёт сюда. */
const HALLS_ANCHOR = 'zaly';

/** Пункты липкого меню — якоря блоков, порядок — как на странице. */
const SECTIONS = [
  { id: UPCOMING_ANCHOR, label: 'Расписание' },
  { id: 'meropriyatiya', label: 'Мероприятия', scrollTo: TABS_ANCHOR },
  { id: 'trenery', label: 'Тренеры', scrollTo: TABS_ANCHOR },
  { id: PLANS_ANCHOR, label: 'Абонементы', scrollTo: TABS_ANCHOR },
  { id: HALLS_ANCHOR, label: 'Залы' },
  { id: NEWS_ANCHOR, label: 'Новости' },
  { id: RATING_ANCHOR, label: 'Рейтинг' },
  { id: ABOUT_ANCHOR, label: 'О клубе' },
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
  const [favourite, setFavourite] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Клуба нет — или он черновик, а смотрит посторонний (11.10.2026): сервер
  // отвечает одинаково 404, и страница — общая «Такой страницы нет», а не
  // обложка-заглушка с ошибкой под ней.
  const [missing, setMissing] = useState(false);
  const [catalog, setCatalog] = useState<ClubCatalogItem[] | null>(null);
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [filter, setFilter] = useState<KindFilter | null>(null);
  const [hallFilter, setHallFilter] = useState<string[] | null>(null);

  // Фильтр залов «Предстоящих» (решение владельца от 17.10.2026; до того —
  // отдельный выбор зала над расписанием, от которого зависело всё ниже).
  // Помнит браузер — у каждого клуба свой: человек из Абакана не должен
  // каждый раз заново отсеивать Красноярск. Хранилище может быть недоступно
  // (приватный режим) — тогда просто «все».
  const hallsKey = `yenisey.hallFilter.${slug}`;

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(hallsKey) ?? 'null') as unknown;
      if (Array.isArray(saved) && saved.every((id) => typeof id === 'string')) setHallFilter(saved);
    } catch {
      // нет хранилища — остаёмся на «всех»
    }
  }, [hallsKey]);

  const chooseHalls = useCallback(
    (selection: string[] | null) => {
      setHallFilter(selection);
      try {
        window.localStorage.setItem(hallsKey, JSON.stringify(selection));
      } catch {
        // не запомнили — не беда
      }
    },
    [hallsKey],
  );

  // Выбранные залы, которые у клуба есть; сохранённых больше нет или выбраны
  // все — фильтра нет.
  const hallIds = useMemo(() => {
    if (!tenant || !hallFilter) return null;
    const known = hallFilter.filter((id) => tenant.halls.some((hall) => hall.id === id));
    return known.length === 0 || known.length === tenant.halls.length ? null : known;
  }, [tenant, hallFilter]);

  // Новости и рейтинг — блоки, а не вкладки: переход по `#novosti` (из
  // сообщения клиентам и со стартовой) прокручивает к ним, когда обложка и
  // описание уже приехали, — иначе они столкнули бы блок вниз.
  // И по ссылке внутри страницы — тоже: смена якоря без перезагрузки.
  const loaded = tenant !== null;

  useEffect(() => {
    if (!loaded) return;

    const scroll = (): void => {
      const hash = window.location.hash.slice(1);

      const target = hash;

      // Блоки, а не вкладки: к ним — прокруткой, когда страница приехала.
      if ([NEWS_ANCHOR, RATING_ANCHOR, HALLS_ANCHOR, ABOUT_ANCHOR, UPCOMING_ANCHOR].includes(target)) {
        requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: 'start' }));
      }
    };

    scroll();
    window.addEventListener('hashchange', scroll);

    return () => window.removeEventListener('hashchange', scroll);
  }, [loaded]);

  // Вкладка — по названию клуба: у всех страниц была одна подпись «КНТ — клубы
  // настольного тенниса», и вкладки было не различить.
  // Next ставит заголовок из метаданных потоком, уже после эффекта, поэтому
  // свой держим несколько секунд после загрузки — и только на адресе клуба:
  // при переходе новая страница ставит свой раньше, чем эта размонтируется.
  useEffect(() => {
    if (!tenant) return;
    const wanted = `${tenant.name} · КНТ`;
    const path = window.location.pathname;
    const apply = (): void => {
      if (window.location.pathname === path && document.title !== wanted) document.title = wanted;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    const stop = setTimeout(() => observer.disconnect(), 3000);
    return () => {
      clearTimeout(stop);
      observer.disconnect();
    };
  }, [tenant]);

  useEffect(() => {
    api
      .tenant(slug)
      .then(setTenant)
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 404) {
          setMissing(true);
          return;
        }

        setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
      });
  }, [slug]);

  // Виды мероприятий нужны двоим — вкладке «Мероприятия клуба» и чипам
  // фильтра в «Предстоящих», — поэтому грузятся здесь, один раз и по всему
  // клубу: фильтр залов стоит в «Предстоящих» и вкладок не сужает, а чипы он
  // отсеивает сам по залам вида. Перечитываются вместе со списком: после
  // записи «ближайшее» у вида могло сдвинуться.
  useEffect(() => {
    club
      .catalog()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, [club, eventsVersion]);

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

  // После записи или отмены — и в строке, и в окне — отметка «записан» в
  // предстоящих. «Мои мероприятия» со страницы клуба сняты 26.10.2026: они
  // живут в «Моём календаре» по всем клубам.
  const refreshEvents = useCallback(() => {
    setEventsVersion((value) => value + 1);
  }, []);

  // Отметка «мой клуб» — только для вошедших. Аноним видит открытый список:
  // клуб выбирают до того, как заводят учётку.
  useEffect(() => {
    if (session.status !== 'ready') {
      setFavourite(null);
      return;
    }

    api
      .myClubs()
      .then((clubs) => setFavourite(clubs.some((item) => item.slug === slug)))
      .catch(() => setFavourite(null));
  }, [session.status, slug]);

  // Переход к блоку по якорю. Вкладка — сменой якоря: её открывает `ClubTabs`.
  const jump = useCallback((anchor: string) => {
    const tab = TAB_IDS.includes(anchor);

    if (tab) window.location.hash = anchor;
    document.getElementById(tab ? TABS_ANCHOR : anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Разделы страницы — в строке клуба: лентой на компьютере, списком на телефоне.
  const sectionNav = useSectionNav(slug, SECTIONS);

  // Кто смотрит — одним правилом с окном мероприятия (`eventViewerOf`).
  const viewer = eventViewerOf(session, slug, forPerson, family.selfIsChild);

  if (missing) {
    return <NotFound />;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface" style={clubAccent(tenant?.accentColor)}>
      <SiteHeader clubSlug={slug} clubPage={sectionNav} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 sm:px-8">
        {/* Подписка клуба на КНТ приостановлена за неоплату (решение от
            02.10.2026): страница открыта, но записаться и забронировать нельзя. */}
        {/* Черновик (11.10.2026): сюда доходят только свои — посторонним 404. */}
        {tenant?.draft && (
          <div className="mt-6">
            <Alert tone="warning">
              Клуб ещё не открыт: его нет в поиске, страницу видят только сотрудники клуба. Руководитель открывает его в
              «Настройках», когда готов хотя бы один зал с адресом и столами.
            </Alert>
          </div>
        )}
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

        {/* Отступ под обложкой — прежде его давала плашка разделов, снятая
            11.10.2026 (разделы теперь в строке клуба). */}
        <div className="mb-10" aria-hidden="true" />


        {error && <Alert>{error}</Alert>}

        <PersonSwitch
          people={family.children}
          selected={family.selected}
          onChoose={family.choose}
          className="mb-10"
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
          halls={tenant?.halls ?? []}
          hallIds={hallIds}
          onHalls={chooseHalls}
        />

        <ClubTabs
          tenant={tenant}
          catalog={catalog}
          plans={plans}
          onShowSchedule={showSchedule}
        />

        {tenant && (
          <section id={HALLS_ANCHOR} className="section-rule mb-14 scroll-mt-48 [--rule-gap:3.5rem]">
            <HallCards
              slug={slug}
              tenant={tenant}
              viewer={viewer}
              title={tenant.halls.length === 1 ? 'Зал клуба' : 'Залы'}
              description="Где играют, когда открыто и почём стол — бронь прямо из карточки."
            />
          </section>
        )}

        {/* Общее для всех залов — новости и рейтинг двумя колонками одной
            высоты (решения от 30.09 и 01.10.2026), ниже действия. */}
        <div className="section-rule mb-14 grid gap-10 [--rule-gap:3.5rem] lg:grid-cols-2 lg:gap-4">
          <ClubNewsColumn />
          <ClubRatingColumn />
        </div>

        <div id={ABOUT_ANCHOR} className="section-rule scroll-mt-48 [--rule-gap:3.5rem]">
          <ClubAbout tenant={tenant} />
        </div>

        {/* Линия и после «О клубе» (17.10.2026) — посередине 80px до подвала:
            сама отступа не добавляет, `-mb-10` возвращает свои 40px. */}
        <div aria-hidden="true" className="section-rule mt-10 -mb-10 [--rule-gap:0px]" />
      </main>

      <SiteFooter />
    </div>
  );
}
