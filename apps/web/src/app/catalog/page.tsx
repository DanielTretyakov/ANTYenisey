'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { Role, Tournament, TournamentType, TrainingType } from '@yenisey/types';
import { AppShell } from '@/components/layout/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { inputClassName } from '@/components/ui/Field';
import { MoneyField } from '@/components/ui/MoneyField';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatKopecks, inputToKopecks } from '@/lib/money';
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const allowed = session.status === 'ready' && MANAGERS.includes(session.user.role);

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login');
    }
  }, [session.status, router]);

  useEffect(() => {
    if (!allowed) return;

    let cancelled = false;

    Promise.all([api.trainingTypes(), api.tournamentTypes(), api.tournaments()])
      .then(([training, types, events]) => {
        if (cancelled) return;
        setTrainingTypes(training);
        setTournamentTypes(types);
        setTournaments(events);
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
    <AppShell>
      <h1 className="mb-2 text-[1.75rem]">Занятия и турниры</h1>
      <p className="mb-7 max-w-2xl text-[0.9375rem] text-text-muted">
        То, на что клиент будет записываться. Тип занятия несёт цену и название — «просто
        тренировка» в расписании не говорит клиенту ничего. Турнир после создания
        ставится в сетку расписания как занятое время.
      </p>

      {session.status === 'ready' && !allowed && (
        <Alert>Раздел доступен только администратору и руководству клуба.</Alert>
      )}

      {error && <Alert>{error}</Alert>}

      {allowed && !loading && (
        <div className="grid gap-6">
          <TrainingTypesCard types={trainingTypes} onChange={setTrainingTypes} onError={setError} />
          <TournamentTypesCard
            types={tournamentTypes}
            onChange={setTournamentTypes}
            onError={setError}
          />
          <TournamentsCard tournaments={tournaments} onChange={setTournaments} onError={setError} />
        </div>
      )}
    </AppShell>
  );
}

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
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [pending, setPending] = useState(false);

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
      const created = await api.createTrainingType({ name, price: kopecks });
      setName('');
      setPrice('');
      return [...types, created].sort(byActiveThenName);
    });
  }

  return (
    <Card>
      <CardHeader
        title="Типы тренировок"
        description="Классификация занятий и цена каждого. Тип выбирается при постановке тренировки в расписание."
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
                  onClick={() =>
                    void run(async () => {
                      const updated = await api.updateTrainingType(type.id, {
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
                  variant="danger"
                  size="sm"
                  // На тип, стоящий в расписании, ссылается внешний ключ:
                  // удалить его нельзя, можно только снять с продажи.
                  disabled={pending || type.usageCount > 0}
                  title={type.usageCount > 0 ? 'Тип стоит в расписании — его можно только снять с продажи' : undefined}
                  onClick={() =>
                    void run(async () => {
                      await api.deleteTrainingType(type.id);
                      return types.filter((item) => item.id !== type.id);
                    })
                  }
                >
                  Удалить
                </Button>
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
  const [name, setName] = useState('');
  const [rating, setRating] = useState('');
  const [price, setPrice] = useState('');
  const [pending, setPending] = useState(false);

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
      const created = await api.createTournamentType({
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
        description="Из них администратор собирает конкретные турниры. Число-ограничение по рейтингу в названии — справочное: система его не проверяет и допуск не блокирует."
      />
      <CardBody>
        {types.length === 0 ? (
          <p className="mb-4 text-[0.9375rem] text-text-muted">Типов турниров пока нет.</p>
        ) : (
          <ul className="mb-5 divide-y divide-border border-y border-border">
            {types.map((type) => (
              <li key={type.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className={cn('flex-1 text-[0.9375rem]', type.isActive ? 'text-text' : 'text-text-subtle line-through')}>
                  {type.name}
                  {type.ratingLabel && (
                    <span className="ml-2 text-[0.8125rem] text-text-subtle">
                      рейтинг {type.ratingLabel}
                    </span>
                  )}
                </span>
                <span className="text-[0.875rem] text-text-muted">{formatKopecks(type.price)}</span>
                {type.tournamentCount > 0 && (
                  <span className="text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">
                    турниров: {type.tournamentCount}
                  </span>
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
                  variant="danger"
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
                    api
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

const byActiveThenName = <T extends { isActive: boolean; name: string }>(a: T, b: T): number =>
  a.isActive === b.isActive ? a.name.localeCompare(b.name, 'ru') : Number(b.isActive) - Number(a.isActive);
