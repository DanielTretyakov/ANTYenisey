'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BookingEntry, ClubCatalogItem, PublicPlan, PublicTenant } from '@yenisey/types';
import { RiverBackdrop } from '@/components/brand/RiverBackdrop';
import { ClubAbout } from '@/components/club/ClubAbout';
import { ClubMark } from '@/components/club/ClubMark';
import { ClubTabs } from '@/components/club/ClubTabs';
import { ALL_HALLS, HallFilter, selectedHallIds, type HallSelection } from '@/components/club/HallFilter';
import { RowSkeleton } from '@/components/club/EventRow';
import { UPCOMING_ANCHOR, UpcomingEvents, type KindFilter } from '@/components/club/UpcomingEvents';
import { WhenSpan } from '@/components/club/When';
import { PersonSwitch } from '@/components/family/PersonSwitch';
import { ClubNav } from '@/components/layout/ClubNav';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';
import { clubAccent } from '@/lib/clubTheme';
import { cn } from '@/lib/cn';
import { eventViewerOf, type EventViewer } from '@/lib/eventViewer';
import { loginHref } from '@/lib/next';
import { entryPriceLabel } from '@/lib/subscriptions';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { usePersonSwitch } from '@/lib/usePersonSwitch';
import { useFileUrl } from '@/lib/useFileUrl';
import { useSession } from '@/lib/useSession';

/**
 * Страница клуба.
 *
 * Сверху вниз (решения владельца от 24 и 25.09.2026): баннер с названием и
 * сердечком «мой клуб», «О клубе» — описание, ценности, контакты, — кнопка
 * аренды, вкладки «Залы · Мероприятия клуба · Тренерский состав ·
 * Абонементы», «Мои мероприятия» и «Предстоящие» — неделей или календарём
 * месяца, с фильтром по виду мероприятия.
 *
 * Порядок «Мои» → «Предстоящие» задан ТЗ и не косметический. На страницу клуба заходят чаще всего чтобы посмотреть, куда
 * уже записан и когда идти, а не чтобы выбрать новое.
 *
 * Оформление берётся у клуба: `clubAccent` подменяет акцентные переменные на
 * обёртке страницы, и все компоненты внутри перекрашиваются сами — они
 * называют роль («цвет действия»), а не краску. Клуб без своего цвета
 * остаётся в изумруде платформы.
 */
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
  const hallIds = useMemo(() => {
    if (!tenant) return null;
    const known = halls.hallId === null || tenant.halls.some((hall) => hall.id === halls.hallId);
    return selectedHallIds(tenant.halls, known ? halls : ALL_HALLS);
  }, [tenant, halls]);

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
  // вместе со списком: после записи «ближайшее» у вида могло сдвинуться.
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

  // Кто смотрит — одним правилом с окном мероприятия (`eventViewerOf`).
  const viewer = eventViewerOf(session, slug, forPerson, family.selfIsChild);

  return (
    <div className="flex min-h-dvh flex-col bg-surface" style={clubAccent(tenant?.accentColor)}>
      <SiteHeader clubNav={<ClubNav slug={slug} />} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 sm:px-8">
        <ClubHero
          tenant={tenant}
          slug={slug}
          anonymous={session.status === 'anonymous'}
          favourite={favourite}
          onFavourite={setFavourite}
        />

        {error && <Alert>{error}</Alert>}

        <ClubAbout tenant={tenant} />

        <BookingCta slug={slug} viewer={viewer} />

        <PersonSwitch
          people={family.children}
          selected={family.selected}
          onChoose={family.choose}
          className="mb-10"
        />

        {tenant && <HallFilter halls={tenant.halls} value={halls} onChange={chooseHalls} />}

        <ClubTabs
          slug={slug}
          tenant={tenant}
          catalog={catalog}
          plans={plans}
          viewer={viewer}
          hallIds={hallIds}
          onShowSchedule={showSchedule}
        />

        <MyEvents
          entries={mine}
          anonymous={session.status === 'anonymous'}
          whose={family.selected ? firstName(family.selected.fullName) : null}
          forPerson={forPerson}
          readOnly={family.selfIsChild}
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
        />
      </main>
    </div>
  );
}

/**
 * Баннер клуба: снимок, который клуб загрузил сам, или фирменная плоскость с
 * рекой — в цвете клуба. Название, города и сердечко «мой клуб» — на нём.
 *
 * Высота задана до ответа сервера — иначе содержимое страницы подпрыгивало
 * бы, когда приедут название и снимок.
 */
function ClubHero({
  tenant,
  slug,
  anonymous,
  favourite,
  onFavourite,
}: {
  tenant: PublicTenant | null;
  slug: string;
  anonymous: boolean;
  favourite: boolean | null;
  onFavourite: (value: boolean) => void;
}) {
  const banner = useFileUrl(tenant?.bannerFileId ?? null);
  const places = tenant ? [tenant.city, ...tenant.otherCities].filter(Boolean).join(', ') : '';

  return (
    <header className="relative mt-6 mb-8 overflow-hidden rounded-card text-white sm:mt-8">
      <div
        className="relative flex min-h-56 items-end px-6 pt-16 pb-6 sm:min-h-72 sm:px-10 sm:pb-8"
        // Без баннера — плоскость в цвете клуба, притемнённая: белый текст на
        // произвольном фирменном цвете иначе читался бы не всегда.
        style={{ background: 'color-mix(in oklab, var(--accent) 55%, var(--ink-950))' }}
      >
        {banner ? (
          <>
            <img src={banner} alt="" className="absolute inset-0 h-full w-full object-cover" />
            {/* Затемнение снизу — под названием: снимок зала бывает светлым. */}
            <span
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(to top, color-mix(in oklab, var(--ink-950) 80%, transparent), transparent 70%)',
              }}
            />
          </>
        ) : (
          <RiverBackdrop orientation="landscape" />
        )}

        <div className="relative z-10 flex w-full flex-wrap items-end gap-x-5 gap-y-4">
          {tenant ? (
            <ClubMark club={tenant} size="lg" />
          ) : (
            <span className="h-16 w-16 shrink-0 rounded-control bg-white/20" aria-hidden="true" />
          )}

          <div className="min-w-0 grow">
            {tenant ? (
              <>
                <h1 className="text-[1.75rem] leading-tight text-white [overflow-wrap:anywhere] sm:text-[2.25rem]">
                  {tenant.name}
                </h1>
                {places && <p className="mt-1.5 text-[0.9375rem] text-white/80">{places}</p>}
              </>
            ) : (
              <>
                <span className="block h-7 w-64 rounded-full bg-white/20" />
                <span className="mt-3 block h-3 w-32 rounded-full bg-white/15" />
              </>
            )}
          </div>

          <HeartButton slug={slug} anonymous={anonymous} favourite={favourite} onChange={onFavourite} />
        </div>
      </div>
    </header>
  );
}

/**
 * «Забронировать стол» — сразу под баннером и описанием (решение владельца
 * от 24.09.2026), а не под залами: у клуба с десятком залов кнопка уезжала
 * за второй экран.
 *
 * Сотруднику кнопка не показывается — бронь ссылается на карточку клиента,
 * которой у него нет. Ребёнку — тоже: до 14 за него бронирует родитель.
 */
function BookingCta({ slug, viewer }: { slug: string; viewer: EventViewer }) {
  if (viewer === 'staff') {
    return null;
  }

  if (viewer === 'child') {
    return (
      <p className="mb-10 text-[0.875rem] text-text-muted">
        Пока тебе нет 14, стол бронирует родитель — со своей страницы.
      </p>
    );
  }

  // Анониму — тоже сразу на сетку: она открыта без входа, и вход понадобится
  // только на последнем шаге, с возвратом туда же.
  return (
    <div className="mb-10">
      <Link href={`/clubs/${slug}/booking`}>
        <Button size="lg">Забронировать стол</Button>
      </Link>
    </div>
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

  const className = cn(
    'grid h-12 w-12 shrink-0 place-items-center rounded-full border border-white/40 bg-black/25 text-white',
    'backdrop-blur-sm transition-transform hover:scale-105 disabled:opacity-60',
  );

  return (
    <div className="flex flex-col items-end gap-2">
      {anonymous ? (
        <Link href={loginHref()} aria-label="Войти, чтобы сделать клуб своим" title="Войти, чтобы сделать клуб своим" className={className}>
          {heart}
        </Link>
      ) : (
        <button
          type="button"
          aria-pressed={active}
          aria-label={label}
          title={label}
          disabled={pending || favourite === null}
          onClick={() => void toggle()}
          className={className}
        >
          {heart}
        </button>
      )}

      {error && (
        <p className="max-w-xs rounded-control bg-black/60 px-3 py-2 text-right text-[0.8125rem] text-white" role="alert">
          {error}
        </p>
      )}
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
    <section className="mb-16">
      <SectionTitle>{whose ? `Мероприятия: ${whose}` : 'Мои мероприятия'}</SectionTitle>

      {entries === null ? (
        <RowSkeleton />
      ) : (
        <ul className="border-t border-border">
          {upcoming.map((entry) => (
            <li
              key={entry.entryId}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border py-4"
            >
              <WhenSpan startsAt={entry.startsAt} endsAt={entry.endsAt} />

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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-5 text-[1.375rem]">{children}</h2>;
}
