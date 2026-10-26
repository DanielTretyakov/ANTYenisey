'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { coachingYearsLabel, publicRankLabel, type FeedEvent, type PublicCoach, type PublicPlayer } from '@yenisey/types';
import { CoachHeart } from '@/components/coach/CoachHeart';
import { CoachCardBody, coachCardEmpty, CoachPricesView } from '@/components/coach/CoachView';
import { EventDialog } from '@/components/events/EventDialog';
import { FeedEventCard } from '@/components/events/FeedEventCard';
import { NewsBody } from '@/components/news/NewsParts';
import { PlayerPublicSkeleton, PlayerPublicView } from '@/components/player/PlayerPublicView';
import { PlayerAvatar } from '@/components/player/PlayerView';
import { Alert } from '@/components/ui/Alert';
import { CardRow } from '@/components/ui/CardRow';
import { Tab } from '@/components/ui/Tab';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/useSession';

export type PersonSection = 'player' | 'coach';

/** Адрес раздела: у каждого свой, страница одна. */
const SECTION_PATH: Record<PersonSection, string> = { player: '/players', coach: '/coaches' };

type Loaded<T> = { status: 'loading' } | { status: 'found'; value: T } | { status: 'missing' } | { status: 'offline' };

/**
 * Страница человека — одна на игрока и тренера (решение владельца от
 * 26.10.2026): разделы «Игрок» и «Тренер», как принято на спортивных сайтах.
 * `/players/:id` открывает «Игрока», `/coaches/:id` — «Тренера»; переключение
 * меняет адрес без перезагрузки, чтобы ссылкой можно было поделиться.
 *
 * Раздел, которого у человека нет, не показывается: не тренер — без
 * «Тренера»; игрок младше 14 посторонним закрыт (404) — без «Игрока», хотя
 * тренером младше 14 не бывают. Обе страницы открыты без входа.
 */
export function PersonPage({ id, initial }: { id: string; initial: PersonSection }) {
  const [player, setPlayer] = useState<Loaded<PublicPlayer>>({ status: 'loading' });
  const [coach, setCoach] = useState<Loaded<PublicCoach>>({ status: 'loading' });
  const [section, setSection] = useState<PersonSection>(initial);

  useEffect(() => {
    const settle =
      <T,>(set: (value: Loaded<T>) => void) =>
      (cause: unknown) =>
        set(cause instanceof ApiError && cause.status === 404 ? { status: 'missing' } : { status: 'offline' });

    api
      .player(id)
      .then((value) => setPlayer({ status: 'found', value }))
      .catch(settle<PublicPlayer>(setPlayer));
    api
      .coach(id)
      .then((value) => setCoach({ status: 'found', value }))
      .catch(settle<PublicCoach>(setCoach));
  }, [id]);

  const loading = player.status === 'loading' || coach.status === 'loading';
  const has: Record<PersonSection, boolean> = { player: player.status === 'found', coach: coach.status === 'found' };
  // Просили раздел, которого нет, — открываем тот, что есть.
  const shown: PersonSection = has[section] ? section : section === 'coach' ? 'player' : 'coach';

  function choose(next: PersonSection): void {
    setSection(next);
    window.history.replaceState(null, '', `${SECTION_PATH[next]}/${id}`);
  }

  if (loading) {
    return <PlayerPublicSkeleton />;
  }

  if (!has.player && !has.coach) {
    return (
      <Alert tone="warning">
        {player.status === 'offline' || coach.status === 'offline'
          ? 'Нет связи. Проверьте интернет и попробуйте ещё раз'
          : 'Страница не найдена или закрыта.'}
      </Alert>
    );
  }

  return (
    <div className="grid gap-6">
      {has.player && has.coach && (
        <div className="flex gap-1.5" role="tablist" aria-label="Раздел страницы">
          <Tab inTablist active={shown === 'player'} onClick={() => choose('player')}>
            Игрок
          </Tab>
          <Tab inTablist active={shown === 'coach'} onClick={() => choose('coach')}>
            Тренер
          </Tab>
        </div>
      )}

      {shown === 'player' && player.status === 'found' && <PlayerPublicView player={player.value} />}
      {shown === 'coach' && coach.status === 'found' && <CoachSection coach={coach.value} />}
    </div>
  );
}

/**
 * Раздел «Тренер»: кто он, «Обо мне», ближайшие занятия каруселью с выбором
 * клуба и вида, стоимость по клубам, достижения, инвентарь и контакты.
 *
 * Карточка одна на все клубы, а цены у каждого клуба свои — поэтому клубы
 * перечислены отдельным блоком, каждый со своей стоимостью занятий.
 */
function CoachSection({ coach }: { coach: PublicCoach }) {
  const session = useSession();
  const [favourite, setFavourite] = useState<boolean | null>(null);
  const [upcoming, setUpcoming] = useState<FeedEvent[] | null>(null);
  const [open, setOpen] = useState<FeedEvent | null>(null);

  const loadUpcoming = (): void => {
    api
      .coachUpcoming(coach.id)
      .then(setUpcoming)
      .catch(() => setUpcoming([]));
  };

  useEffect(loadUpcoming, [coach.id]);

  // Отмечен ли — только у вошедшего; гостя сердечко ведёт на вход.
  useEffect(() => {
    if (session.status !== 'ready') return;

    api
      .myCoaches()
      .then((list) => setFavourite(list.some((item) => item.id === coach.id)))
      .catch(() => setFavourite(false));
  }, [session.status, coach.id]);

  const facts = [
    `Стаж: ${coach.coachingSince === null ? '—' : coachingYearsLabel(coach.coachingSince)}`,
    `Разряд: ${publicRankLabel(coach.rank)}`,
  ];

  return (
    <div className="grid gap-8">
      <header className="flex flex-wrap items-center gap-6">
        <PlayerAvatar fileId={coach.photoFileId} name={coach.name} gender={coach.gender} size="lg" />
        <div className="min-w-0">
          <p className="text-[0.75rem] tracking-[0.1em] text-text-subtle uppercase">Тренер</p>
          <h1 className="mt-1 text-[2rem] leading-tight break-words">{coach.name}</h1>
          <p className="mt-1.5 text-[0.9375rem] text-text-muted">
            {'Тренер в клубах: '}
            {coach.clubs.map((club, index) => (
              <span key={club.slug}>
                {index > 0 && ', '}
                <Link href={`/clubs/${club.slug}`} className="text-text-accent underline-offset-2 hover:underline">
                  {club.name}
                </Link>
              </span>
            ))}
          </p>
          <p className="mt-1 text-[0.9375rem] text-text">{facts.join(' · ')}</p>
        </div>
        {/* Себя тренер в избранное не отмечает — база тоже не даст. */}
        {!(session.status === 'ready' && session.user.id === coach.id) && (
          <CoachHeart
            coachId={coach.id}
            anonymous={session.status === 'anonymous'}
            favourite={session.status === 'anonymous' ? false : favourite}
            onChange={(list) => setFavourite(list.some((item) => item.id === coach.id))}
            className="ml-auto self-start"
          />
        )}
      </header>

      {coach.about && (
        <section>
          <h3 className="mb-2 text-[0.9375rem] font-medium">Обо мне</h3>
          <NewsBody body={coach.about} className="text-[0.9375rem]" />
        </section>
      )}

      <UpcomingSessions events={upcoming} onOpen={setOpen} />

      {/* Цены — по клубу: в соседнем у того же тренера они другие, и общая
          строка «1500 ₽» ввела бы в заблуждение. */}
      <section>
        <h3 className="mb-3 text-[0.9375rem] font-medium">Стоимость занятий</h3>
        <ul className="grid gap-4 sm:grid-cols-2">
          {coach.clubs.map((club) => (
            <li key={club.slug} className="rounded-card border border-border bg-surface-raised px-5 py-4">
              <Link
                href={`/clubs/${club.slug}`}
                className="text-[0.9375rem] font-medium text-text-accent underline-offset-2 hover:underline"
              >
                {club.name}
              </Link>
              <div className="mt-1.5">
                <CoachPricesView prices={club} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* «Карточка пока не заполнена» — только когда о тренере нет ничего:
          рядом с «Обо мне» эта строка читалась бы как ошибка. */}
      {(!coachCardEmpty(coach) || !coach.about) && <CoachCardBody card={coach} />}

      {open && (
        <EventDialog
          slug={open.club.slug}
          kind={open.kind}
          id={open.id}
          onClose={() => setOpen(null)}
          onChanged={loadUpcoming}
        />
      )}
    </div>
  );
}

/**
 * Ближайшие занятия тренера — каруселью со стрелками, а не стопкой (решение
 * владельца от 26.10.2026), с выбором клуба (если их несколько) и вида
 * занятия. Выбор — по тем, что есть в ближайших, а не по всем видам клуба:
 * пустой вариант в фильтре был бы обещанием без занятий за ним.
 */
function UpcomingSessions({ events, onOpen }: { events: FeedEvent[] | null; onOpen: (event: FeedEvent) => void }) {
  const [club, setClub] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);

  if (events === null) {
    return (
      <section>
        <h3 className="mb-3 text-[0.9375rem] font-medium">Ближайшие занятия</h3>
        <div className="h-32 rounded-card border border-border bg-surface-raised" aria-busy="true" />
      </section>
    );
  }

  const clubs = unique(events.map((event) => ({ key: event.club.slug, label: event.club.name })));
  const inClub = events.filter((event) => club === null || event.club.slug === club);
  const types = unique(inClub.map((event) => ({ key: typeKey(event), label: event.title })));
  const chosenType = types.some((item) => item.key === type) ? type : null;
  const shown = inClub.filter((event) => chosenType === null || typeKey(event) === chosenType);

  const filters = (
    <div className="grid gap-2">
      {clubs.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Клуб">
          <Tab active={club === null} onClick={() => setClub(null)}>
            Все клубы
          </Tab>
          {clubs.map((item) => (
            <Tab key={item.key} active={club === item.key} onClick={() => setClub(item.key)}>
              {item.label}
            </Tab>
          ))}
        </div>
      )}
      {types.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Вид занятия">
          <Tab active={chosenType === null} onClick={() => setType(null)}>
            Все занятия
          </Tab>
          {types.map((item) => (
            <Tab key={item.key} active={chosenType === item.key} onClick={() => setType(item.key)}>
              {item.label}
            </Tab>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <section>
      <h3 className="mb-3 text-[0.9375rem] font-medium">Ближайшие занятия</h3>
      {events.length === 0 ? (
        <p className="text-[0.9375rem] text-text-muted">Ближайших занятий в расписании клубов пока нет.</p>
      ) : (
        <CardRow
          items={shown}
          keyOf={(event) => `${event.club.slug}-${event.id}`}
          label="Ближайшие занятия тренера — листайте вбок"
          toolbar={clubs.length > 1 || types.length > 1 ? filters : undefined}
          render={(event) => <FeedEventCard event={event} onOpen={onOpen} />}
        />
      )}
    </section>
  );
}

/** Вид занятия — в своём клубе: у двух клубов могут быть одноимённые виды. */
const typeKey = (event: FeedEvent): string => `${event.club.slug}:${event.typeId}`;

function unique(items: { key: string; label: string }[]): { key: string; label: string }[] {
  const seen = new Map<string, string>();

  for (const item of items) {
    if (!seen.has(item.key)) seen.set(item.key, item.label);
  }

  return [...seen].map(([key, label]) => ({ key, label }));
}
