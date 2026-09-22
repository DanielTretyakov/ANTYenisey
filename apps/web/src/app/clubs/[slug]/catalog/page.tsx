'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type {
  Role,
  SubscriptionPlan,
  Tournament,
  TournamentType,
  TrainingSession,
  TrainingType,
} from '@yenisey/types';
import { SubscriptionPlansCard } from './SubscriptionPlansCard';
import { AdminShell } from '@/components/layout/AdminShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { inputClassName } from '@/components/ui/Field';
import { MoneyField } from '@/components/ui/MoneyField';
import { Tab } from '@/components/ui/Tab';
import { roleInClub } from '@/lib/membership';
import { ApiError } from '@/lib/api';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { cn } from '@/lib/cn';
import { formatKopecks, inputToKopecks, kopecksToInput } from '@/lib/money';
import { useSession } from '@/lib/useSession';

const MANAGERS: Role[] = ['ADMIN', 'OWNER'];

/**
 * Занятия и турниры: справочники, из которых собирается расписание.
 *
 * Отдельным разделом от настроек клуба: настройки — это цены и устройство
 * зала, а здесь то, на что клиент будет записываться. Тип тренировки
 * классифицирует занятие («Общая групповая», «Первая подача») и несёт цену;
 * турнир — конкретное проведение, которое администратор потом ставит в сетку.
 */
export default function CatalogPage() {
  const session = useSession();
  const router = useRouter();

  const [trainingTypes, setTrainingTypes] = useState<TrainingType[]>([]);
  const [tournamentTypes, setTournamentTypes] = useState<TournamentType[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // «Типы» первыми: без них нельзя ни поставить занятие, ни завести тариф.
  const [tab, setTab] = useState<CatalogTab>('types');

  // Роль берётся из привязки к КЛУБУ ИЗ АДРЕСА, а не из профиля: аккаунт один
  // на платформу, и в разных клубах она разная. Раньше клуб здесь не
  // указывался вовсе, и роль бралась из запасного TENANT_SLUG окружения —
  // администратор одного клуба видел админский интерфейс в чужом, а в своём
  // получал отказ. Настоящий доступ это не открывало (сервер проверяет
  // TenantMembership на каждый запрос), но показывало не то.
  const slug = useClubSlug();
  const role = session.status === 'ready' ? roleInClub(session.user, slug) : null;
  const allowed = role !== null && MANAGERS.includes(role);

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login');
    }
  }, [session.status, router]);

  const club = useClubApi();

  useEffect(() => {
    if (!allowed) return;

    let cancelled = false;

    Promise.all([
      club.trainingTypes(),
      club.tournamentTypes(),
      club.tournaments(),
      club.trainingSessions(),
      club.subscriptionPlans(),
    ])
      .then(([training, types, events, training_sessions, subscriptionPlans]) => {
        if (cancelled) return;
        setTrainingTypes(training);
        setTournamentTypes(types);
        setTournaments(events);
        setSessions(training_sessions);
        setPlans(subscriptionPlans);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [allowed]);

  return (
    <AdminShell>
      <h1 className="mb-2 text-[1.75rem]">Занятия и турниры</h1>
      <p className="mb-6 max-w-2xl text-[0.9375rem] text-text-muted">
        {TAB_HINTS[tab]}
      </p>

      {session.status === 'ready' && !allowed && (
        <Alert>Раздел доступен только администратору и руководству клуба.</Alert>
      )}

      {error && <Alert>{error}</Alert>}

      {allowed && !loading && (
        <>
          {/* Вкладки, а не пять карточек подряд: на одной странице лежали
              справочники, которые правят раз в сезон, и списки проведений на
              десятки строк, которые растут каждую неделю. Прокрутить её до
              турниров было отдельным упражнением. */}
          <div className="mb-6 flex flex-wrap items-center gap-1.5">
            {TABS.map((item) => (
              <Tab key={item.value} active={tab === item.value} onClick={() => setTab(item.value)}>
                {item.label}
              </Tab>
            ))}
          </div>

          <div className="grid gap-6">
            {tab === 'types' && (
              <>
                <TrainingTypesCard types={trainingTypes} onChange={setTrainingTypes} onError={setError} />
                <TournamentTypesCard
                  types={tournamentTypes}
                  onChange={setTournamentTypes}
                  onError={setError}
                />
              </>
            )}

            {tab === 'plans' && (
              <SubscriptionPlansCard
                plans={plans}
                trainingTypes={trainingTypes}
                tournamentTypes={tournamentTypes}
                onChange={setPlans}
              />
            )}

            {tab === 'events' && (
              <>
                <TrainingSessionsCard sessions={sessions} onChange={setSessions} onError={setError} />
                <TournamentsCard tournaments={tournaments} onChange={setTournaments} onError={setError} />
              </>
            )}
          </div>
        </>
      )}
    </AdminShell>
  );
}

/** Вкладки раздела: справочники, тарифы и то, что уже поставлено в расписание. */
type CatalogTab = 'types' | 'plans' | 'events';

const TABS: { value: CatalogTab; label: string }[] = [
  { value: 'types', label: 'Типы' },
  { value: 'plans', label: 'Абонементы' },
  { value: 'events', label: 'Занятия и турниры' },
];

/**
 * Подпись под заголовком — своя у каждой вкладки.
 *
 * Общее объяснение на пять списков сразу получалось про всё и ни про что:
 * человек, пришедший за числом мест, читал про цену типа занятия.
 */
const TAB_HINTS: Record<CatalogTab, string> = {
  types: 'То, на что клиент будет записываться. Тип занятия несёт цену и название — «просто тренировка» в расписании не говорит клиенту ничего. Новая цена действует на будущие записи: у записанных сумма зафиксирована на момент записи.',
  plans: 'Тарифы абонементов: сколько визитов, на какой срок и что они покрывают. Продаются у стойки, из карточки человека.',
  events: 'Занятия и турниры заводятся в расписании зала, из закрашенного времени, и сюда попадают уже готовыми — здесь их видно списком и здесь же правится число мест.',
};

/** Типы тренировок: «Общая групповая», «Первая подача». */
function TrainingTypesCard({
  types,
  onChange,
  onError,
}: {
  types: TrainingType[];
  onChange: (types: TrainingType[]) => void;
  onError: (message: string | null) => void;
}) {
  const club = useClubApi();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [pending, setPending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function run(action: () => Promise<TrainingType[]>): Promise<void> {
    onError(null);
    setPending(true);

    try {
      onChange(await action());
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  async function handleAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const kopecks = inputToKopecks(price);

    if (kopecks === null) {
      onError('Цена указывается числом, например 700 или 700,50');
      return;
    }

    await run(async () => {
      const created = await club.createTrainingType({ name, price: kopecks });
      setName('');
      setPrice('');
      return [...types, created].sort(byActiveThenName);
    });
  }

  return (
    <Card>
      <CardHeader
        title="Типы тренировок"
        description="Классификация занятий и цена каждого. Тип выбирается при постановке тренировки в расписание. Новая цена действует на будущие записи: у записанных сумма зафиксирована на момент записи и правкой типа не меняется."
      />
      <CardBody>
        {types.length === 0 ? (
          <p className="mb-4 text-[0.9375rem] text-text-muted">
            Типов пока нет. Пока их нет, поставить тренировку в расписание нельзя.
          </p>
        ) : (
          <ul className="mb-5 divide-y divide-border border-y border-border">
            {types.map((type) => (
              <li key={type.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                {editingId === type.id ? (
                  <TypeEditor
                    initial={type}
                    pending={pending}
                    onError={onError}
                    onCancel={() => setEditingId(null)}
                    onSave={(values) =>
                      void run(async () => {
                        const updated = await club.updateTrainingType(type.id, {
                          name: values.name,
                          price: values.price,
                          isActive: type.isActive,
                        });
                        setEditingId(null);
                        return types
                          .map((item) => (item.id === type.id ? updated : item))
                          .sort(byActiveThenName);
                      })
                    }
                  />
                ) : (
                  <>
                <span className={cn('flex-1 text-[0.9375rem]', type.isActive ? 'text-text' : 'text-text-subtle line-through')}>
                  {type.name}
                </span>
                <span className="text-[0.875rem] text-text-muted">{formatKopecks(type.price)}</span>
                {type.usageCount > 0 && (
                  <span className="text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">
                    в расписании: {type.usageCount}
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    onError(null);
                    setEditingId(type.id);
                  }}
                >
                  Изменить
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    void run(async () => {
                      const updated = await club.updateTrainingType(type.id, {
                        name: type.name,
                        price: type.price,
                        isActive: !type.isActive,
                      });
                      return types.map((item) => (item.id === type.id ? updated : item)).sort(byActiveThenName);
                    })
                  }
                >
                  {type.isActive ? 'Снять с продажи' : 'Вернуть'}
                </Button>
                <Button
                  type="button"
                  variant="danger-ghost"
                  size="sm"
                  // На тип, стоящий в расписании, ссылается внешний ключ:
                  // удалить его нельзя, можно только снять с продажи.
                  disabled={pending || type.usageCount > 0}
                  title={type.usageCount > 0 ? 'Тип стоит в расписании — его можно только снять с продажи' : undefined}
                  onClick={() =>
                    void run(async () => {
                      await club.deleteTrainingType(type.id);
                      return types.filter((item) => item.id !== type.id);
                    })
                  }
                >
                  Удалить
                </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAdd} className="flex flex-wrap items-stretch gap-3">
          <input
            aria-label="Название типа тренировки"
            placeholder="Общая групповая"
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={cn(inputClassName, 'min-w-56 flex-1')}
          />
          <MoneyField className="w-36" value={price} onChange={setPrice} />
          <Button type="submit" variant="secondary" pending={pending} disabled={name.trim() === ''}>
            Добавить
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

/** Типы турниров: «Клуб 100», «Первая подача». */
function TournamentTypesCard({
  types,
  onChange,
  onError,
}: {
  types: TournamentType[];
  onChange: (types: TournamentType[]) => void;
  onError: (message: string | null) => void;
}) {
  const club = useClubApi();
  const [name, setName] = useState('');
  const [rating, setRating] = useState('');
  const [price, setPrice] = useState('');
  const [pending, setPending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function handleAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const kopecks = inputToKopecks(price);

    if (kopecks === null) {
      onError('Цена указывается числом, например 700');
      return;
    }

    onError(null);
    setPending(true);

    try {
      const created = await club.createTournamentType({
        name,
        ratingLabel: rating.trim() || null,
        price: kopecks,
      });
      onChange([...types, created].sort(byActiveThenName));
      setName('');
      setRating('');
      setPrice('');
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Типы турниров"
        description="Из них администратор собирает конкретные турниры. Число-ограничение по рейтингу в названии — справочное: система его не проверяет и допуск не блокирует. Новая цена действует на будущие регистрации: у записанных сумма зафиксирована на момент записи."
      />
      <CardBody>
        {types.length === 0 ? (
          <p className="mb-4 text-[0.9375rem] text-text-muted">Типов турниров пока нет.</p>
        ) : (
          <ul className="mb-5 divide-y divide-border border-y border-border">
            {types.map((type) => (
              <li key={type.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                {editingId === type.id ? (
                  <TypeEditor
                    initial={type}
                    withRating
                    pending={pending}
                    onError={onError}
                    onCancel={() => setEditingId(null)}
                    onSave={(values) => {
                      onError(null);
                      setPending(true);

                      club
                        .updateTournamentType(type.id, {
                          name: values.name,
                          ratingLabel: values.ratingLabel,
                          price: values.price,
                          isActive: type.isActive,
                        })
                        .then((updated) => {
                          onChange(
                            types
                              .map((item) => (item.id === type.id ? updated : item))
                              .sort(byActiveThenName),
                          );
                          setEditingId(null);
                        })
                        .catch((cause: unknown) =>
                          onError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'),
                        )
                        .finally(() => setPending(false));
                    }}
                  />
                ) : (
                  <>
                    <span
                      className={cn(
                        'flex-1 text-[0.9375rem]',
                        type.isActive ? 'text-text' : 'text-text-subtle line-through',
                      )}
                    >
                      {type.name}
                      {type.ratingLabel && (
                        <span className="ml-2 text-[0.8125rem] text-text-subtle">
                          рейтинг {type.ratingLabel}
                        </span>
                      )}
                    </span>
                    <span className="text-[0.875rem] text-text-muted">
                      {formatKopecks(type.price)}
                    </span>
                    {type.tournamentCount > 0 && (
                      <span className="text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">
                        турниров: {type.tournamentCount}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        onError(null);
                        setEditingId(type.id);
                      }}
                    >
                      Изменить
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAdd} className="flex flex-wrap items-stretch gap-3">
          <input
            aria-label="Название типа турнира"
            placeholder="Клуб 100"
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={cn(inputClassName, 'min-w-48 flex-1')}
          />
          <input
            aria-label="Ограничение по рейтингу"
            placeholder="рейтинг, напр. 100"
            maxLength={32}
            value={rating}
            onChange={(event) => setRating(event.target.value)}
            className={cn(inputClassName, 'w-44')}
          />
          <MoneyField className="w-36" value={price} onChange={setPrice} />
          <Button type="submit" variant="secondary" pending={pending} disabled={name.trim() === ''}>
            Добавить
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

/** Конкретные турниры: тип плюс дата и время проведения. */
function TournamentsCard({
  tournaments,
  onChange,
  onError,
}: {
  tournaments: Tournament[];
  onChange: (tournaments: Tournament[]) => void;
  onError: (message: string | null) => void;
}) {
  const club = useClubApi();
  const [pending, setPending] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Турниры"
        description="Заводятся прямо в расписании зала: выбираете тип, закрашиваете время — турнир появляется здесь уже с датой и числом занятых окон."
      />
      <CardBody>
        {tournaments.length === 0 ? (
          <p className="mb-4 text-[0.9375rem] text-text-muted">Турниров пока нет.</p>
        ) : (
          <ul className="mb-5 divide-y divide-border border-y border-border">
            {tournaments.map((tournament) => (
              <li key={tournament.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="flex-1 text-[0.9375rem] text-text">{tournament.typeName}</span>
                <span className="text-[0.875rem] text-text-muted">
                  {new Intl.DateTimeFormat('ru-RU', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(tournament.startsAt))}
                </span>
                <span className="text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">
                  {tournament.placedCount > 0 ? `в сетке: ${tournament.placedCount}` : 'не в сетке'}
                </span>
                <Button
                  type="button"
                  variant="danger-ghost"
                  size="sm"
                  // Турнир, стоящий в сетке, удалить нельзя: вместе с ним
                  // молча ушли бы куски расписания.
                  disabled={pending || tournament.placedCount > 0}
                  title={
                    tournament.placedCount > 0
                      ? 'Турнир стоит в расписании — сначала уберите его из сетки'
                      : undefined
                  }
                  onClick={() => {
                    onError(null);
                    setPending(true);
                    club
                      .deleteTournament(tournament.id)
                      .then(() => onChange(tournaments.filter((item) => item.id !== tournament.id)))
                      .catch((cause: unknown) =>
                        onError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'),
                      )
                      .finally(() => setPending(false));
                  }}
                >
                  Удалить
                </Button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[0.8125rem] text-text-subtle">
          Турнир заводится в расписании зала: выберите кисть «Турнир», его тип и закрасьте
          время, которое он занимает. Дата и время начала берутся из сетки — вводить их
          дважды незачем.
        </p>
      </CardBody>
    </Card>
  );
}

/**
 * Занятия: конкретные проведения с тренером, временем и лимитом мест.
 *
 * Заводятся, как и турниры, в расписании зала — там у окна уже есть и время, и
 * стол, и тренер. Здесь их видно списком, и здесь же правится число мест:
 * ошибиться в нём легко, а перекрашивать ради этого расписание не за чем.
 */
function TrainingSessionsCard({
  sessions,
  onChange,
  onError,
}: {
  sessions: TrainingSession[];
  onChange: (sessions: TrainingSession[]) => void;
  onError: (message: string | null) => void;
}) {
  const club = useClubApi();
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<TrainingSession[]>): Promise<void> {
    onError(null);
    setPending(true);

    try {
      onChange(await action());
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Занятия"
        description="Заводятся в расписании зала: выбираете тип занятия, тренера и число мест, закрашиваете время — занятие появляется здесь, и на него можно записаться."
      />
      <CardBody>
        {sessions.length === 0 ? (
          <p className="mb-4 text-[0.9375rem] text-text-muted">Занятий пока нет.</p>
        ) : (
          <ul className="mb-5 divide-y divide-border border-y border-border">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="flex-1 text-[0.9375rem] text-text">
                  {session.typeName}
                  <span className="ml-2 text-[0.8125rem] text-text-muted">{session.coachName}</span>
                </span>

                <span className="text-[0.875rem] text-text-muted">
                  {new Intl.DateTimeFormat('ru-RU', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(session.startsAt))}
                </span>

                <label className="flex items-center gap-1.5 text-[0.8125rem] text-text-subtle">
                  мест
                  <input
                    type="number"
                    min={session.bookedCount || 1}
                    max={200}
                    defaultValue={session.capacity}
                    disabled={pending}
                    className={cn(inputClassName, 'w-16 py-1 text-[0.8125rem]')}
                    // По уходу с поля, а не по каждому нажатию: иначе набор
                    // «12» отправил бы сначала «1» — и отказ, если записан
                    // хотя бы один человек.
                    onBlur={(event) => {
                      const capacity = Number(event.target.value);

                      if (capacity === session.capacity) return;

                      void run(async () => {
                        const updated = await club.updateTrainingSession(session.id, {
                          trainingTypeId: session.trainingTypeId,
                          coachId: session.coachId,
                          startsAt: session.startsAt,
                          endsAt: session.endsAt,
                          capacity,
                        });

                        return sessions.map((item) => (item.id === updated.id ? updated : item));
                      });
                    }}
                  />
                </label>

                <span className="text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">
                  записались: {session.bookedCount}
                </span>

                <Button
                  type="button"
                  variant="danger-ghost"
                  size="sm"
                  // Те же два запрета, что у турнира: занятие в сетке унесло бы
                  // с собой куски расписания, а занятие с записями — чужие
                  // планы на вечер.
                  disabled={pending || session.placedCount > 0 || session.bookedCount > 0}
                  title={
                    session.placedCount > 0
                      ? 'Занятие стоит в расписании — сначала уберите его из сетки'
                      : session.bookedCount > 0
                        ? 'На занятие уже записались'
                        : undefined
                  }
                  onClick={() => {
                    void run(async () => {
                      await club.deleteTrainingSession(session.id);
                      return sessions.filter((item) => item.id !== session.id);
                    });
                  }}
                >
                  Удалить
                </Button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[0.8125rem] text-text-subtle">
          Занятие заводится в расписании зала: выберите кисть «Тренировка», тип, тренера и число
          мест, затем закрасьте время. Время начала и окончания берутся из сетки — вводить их
          дважды незачем.
        </p>
      </CardBody>
    </Card>
  );
}

const byActiveThenName = <T extends { isActive: boolean; name: string }>(a: T, b: T): number =>
  a.isActive === b.isActive ? a.name.localeCompare(b.name, 'ru') : Number(b.isActive) - Number(a.isActive);

/**
 * Правка типа прямо в строке списка.
 *
 * Не отдельная страница и не модальное окно: у типа всего три поля, и уводить
 * ради них с экрана — больше движений, чем самой правки. Строка на время
 * превращается в форму, остальные остаются на месте, и видно, что меняешь
 * именно эту.
 *
 * Одна форма на оба справочника: у типа турнира к названию и цене добавляется
 * справочный рейтинг, и заводить ради одного поля вторую копию формы значило
 * бы развести их на первой же правке.
 */
function TypeEditor({
  initial,
  withRating = false,
  pending,
  onSave,
  onCancel,
  onError,
}: {
  initial: { name: string; ratingLabel?: string | null; price: number };
  withRating?: boolean;
  pending: boolean;
  onSave: (values: { name: string; ratingLabel: string | null; price: number }) => void;
  onCancel: () => void;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [rating, setRating] = useState(initial.ratingLabel ?? '');
  const [price, setPrice] = useState(kopecksToInput(initial.price));

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const kopecks = inputToKopecks(price);

    if (kopecks === null) {
      onError('Цена указывается числом, например 700 или 700,50');
      return;
    }

    onError(null);
    onSave({ name: name.trim(), ratingLabel: rating.trim() || null, price: kopecks });
  }

  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-stretch gap-2 py-1">
      <input
        aria-label="Название"
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
        className={cn(inputClassName, 'min-w-48 flex-1 py-1.5 text-[0.9375rem]')}
        autoFocus
      />

      {withRating && (
        <input
          aria-label="Ограничение по рейтингу"
          placeholder="рейтинг"
          maxLength={32}
          value={rating}
          onChange={(event) => setRating(event.target.value)}
          className={cn(inputClassName, 'w-32 py-1.5 text-[0.9375rem]')}
        />
      )}

      <MoneyField className="w-32" value={price} onChange={setPrice} />

      <Button type="submit" size="sm" pending={pending} disabled={name.trim() === ''}>
        Сохранить
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
        Отмена
      </Button>
    </form>
  );
}
