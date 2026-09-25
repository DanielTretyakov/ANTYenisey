'use client';

import { useEffect, useRef, useState } from 'react';
import type { ClubCoachListItem, ClubSettings, Hall } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Tab } from '@/components/ui/Tab';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useClubApi } from '@/lib/useClubApi';
import { useFileUrl } from '@/lib/useFileUrl';

const MB = 1024 * 1024;

function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'Сервис недоступен';
}

/**
 * Страница клуба глазами посетителя: баннер и тренерский состав (решение
 * владельца от 24.09.2026). Отдельной карточкой, а не полями общей формы:
 * баннер — файл, а состав — список со своим порядком, и сохраняются они сами
 * по себе, не дожидаясь кнопки «Сохранить» у настроек.
 */
export function ClubPageCard({
  settings,
  halls,
  onSettings,
}: {
  settings: ClubSettings;
  halls: Hall[];
  onSettings: (settings: ClubSettings) => void;
}) {
  return (
    <Card>
      <CardHeader
        title="Страница клуба"
        description="Баннер над названием и тренеры, которых видит посетитель. Карточку тренер ведёт сам — здесь только порядок и кого скрыть."
      />
      <CardBody className="grid gap-8">
        <BannerBlock settings={settings} onSettings={onSettings} />
        <CoachListBlock halls={halls} />
      </CardBody>
    </Card>
  );
}

function BannerBlock({
  settings,
  onSettings,
}: {
  settings: ClubSettings;
  onSettings: (settings: ClubSettings) => void;
}) {
  const club = useClubApi();
  const input = useRef<HTMLInputElement>(null);
  const url = useFileUrl(settings.bannerFileId);
  const [pending, setPending] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: 'upload' | 'remove', action: () => Promise<ClubSettings>): Promise<void> {
    setPending(kind);
    setError(null);

    try {
      onSettings(await action());
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(null);
    }
  }

  function picked(file: File | undefined): void {
    // Сбросить поле сразу: иначе тот же файл второй раз не выбрать.
    if (input.current) input.current.value = '';
    if (!file) return;

    // Проверка до отправки — только ради быстрого ответа; решает сервер.
    if (file.size > 8 * MB) {
      setError('Файл больше 8 МБ');
      return;
    }

    void run('upload', () => club.setClubBanner(file));
  }

  return (
    <section>
      <h3 className="text-[0.9375rem] font-medium">Баннер</h3>
      <p className="mt-0.5 text-[0.8125rem] text-text-muted">
        Широкий снимок зала — сервер обрежет его до полосы 1600×500 и уберёт место съёмки. Без
        баннера страница клуба рисует плоскость в фирменном цвете.
      </p>

      <div
        className="mt-3.5 aspect-[16/5] w-full max-w-2xl overflow-hidden rounded-control border border-border bg-surface-sunken"
        aria-hidden={!url}
      >
        {url ? (
          <img src={url} alt="Баннер клуба" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full place-items-center text-[0.8125rem] text-text-subtle">Баннера нет</span>
        )}
      </div>

      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          pending={pending === 'upload'}
          disabled={pending !== null}
          onClick={() => input.current?.click()}
        >
          {settings.bannerFileId ? 'Заменить баннер' : 'Загрузить баннер'}
        </Button>
        {settings.bannerFileId && (
          <Button
            size="sm"
            variant="ghost"
            pending={pending === 'remove'}
            disabled={pending !== null}
            onClick={() => void run('remove', () => club.removeClubBanner())}
          >
            Убрать
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => picked(event.target.files?.[0])}
        />
      </div>
    </section>
  );
}

/**
 * Тренерский состав (решение владельца от 25.09.2026): на странице клуба все
 * тренеры, администратор задаёт порядок стрелками и скрывает ненужных
 * галочкой. Новый тренер появляется на странице сам — в конце, по ФИО.
 *
 * Сохраняется целиком одной кнопкой: состав — это список, и сохранять каждую
 * перестановку отдельно значило бы на мгновение показывать посетителю два
 * тренера на одном месте.
 */
function CoachListBlock({ halls }: { halls: Hall[] }) {
  const club = useClubApi();
  const [coaches, setCoaches] = useState<ClubCoachListItem[] | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // Где тренирует каждый (решение владельца от 25.09.2026); пусто — везде.
  const [hallsOf, setHallsOf] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(list: ClubCoachListItem[]): void {
    setCoaches(list);
    // Сервер отдаёт уже в порядке страницы: упорядоченные, потом по ФИО.
    setOrder(list.map((coach) => coach.id));
    setHidden(new Set(list.filter((coach) => coach.hidden).map((coach) => coach.id)));
    setHallsOf(Object.fromEntries(list.map((coach) => [coach.id, coach.hallIds])));
  }

  function toggleHall(coachId: string, hallId: string): void {
    setHallsOf((current) => {
      const list = current[coachId] ?? [];
      return {
        ...current,
        [coachId]: list.includes(hallId) ? list.filter((id) => id !== hallId) : [...list, hallId],
      };
    });
    setSaved(false);
  }

  useEffect(() => {
    club
      .coachList()
      .then(load)
      .catch((cause: unknown) => setError(messageOf(cause)));
  }, [club]);

  const nameOf = (id: string): string => coaches?.find((coach) => coach.id === id)?.fullName ?? id;

  function move(index: number, delta: -1 | 1): void {
    setOrder((list) => {
      const next = [...list];
      const target = index + delta;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setSaved(false);
  }

  function toggle(id: string): void {
    setHidden((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSaved(false);
  }

  async function save(): Promise<void> {
    setPending(true);
    setError(null);

    try {
      load(
        await club.setCoachList(
          order,
          [...hidden],
          order.map((coachId) => ({ coachId, hallIds: hallsOf[coachId] ?? [] })),
        ),
      );
      setSaved(true);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  const shown = order.length - hidden.size;

  return (
    <section>
      <h3 className="text-[0.9375rem] font-medium">Тренерский состав</h3>
      <p className="mt-0.5 text-[0.8125rem] text-text-muted">
        На странице клуба — все тренеры в этом порядке; снимите галочку, чтобы скрыть. Список берётся из людей с
        ролью тренера в «Составе клуба».
        {halls.length > 1 &&
          ' Отметьте залы, где тренер работает: без отметок — во всех. По ним фильтрует страница клуба и палитра расписания.'}
      </p>

      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}

      {coaches === null && !error && <p className="mt-3 text-[0.875rem] text-text-muted">Загружаю…</p>}

      {coaches?.length === 0 && (
        <p className="mt-3 text-[0.875rem] text-text-muted">
          Тренеров в клубе пока нет — назначьте роль в «Составе клуба».
        </p>
      )}

      {coaches && coaches.length > 0 && (
        <>
          <ol className="mt-3.5 grid max-w-xl gap-1.5">
            {order.map((id, index) => {
              const isHidden = hidden.has(id);

              return (
                <li
                  key={id}
                  className={cn(
                    'flex flex-wrap items-center gap-2 rounded-control border border-border bg-surface-raised px-3 py-1.5',
                    isHidden && 'bg-surface-sunken text-text-subtle',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    onChange={() => toggle(id)}
                    aria-label={`${nameOf(id)}: показывать на странице клуба`}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="w-6 text-[0.8125rem] text-text-subtle tabular-nums">{index + 1}.</span>
                  <span className={cn('min-w-0 grow truncate text-[0.9375rem]', isHidden && 'line-through')}>
                    {nameOf(id)}
                  </span>
                  <IconButton label="Выше" disabled={index === 0} onClick={() => move(index, -1)}>
                    ↑
                  </IconButton>
                  <IconButton label="Ниже" disabled={index === order.length - 1} onClick={() => move(index, 1)}>
                    ↓
                  </IconButton>

                  {halls.length > 1 && (
                    <div className="flex basis-full flex-wrap items-center gap-1.5 pb-1 pl-12" role="group" aria-label={`Залы: ${nameOf(id)}`}>
                      {halls.map((hall) => (
                        <Tab key={hall.id} active={(hallsOf[id] ?? []).includes(hall.id)} onClick={() => toggleHall(id, hall.id)}>
                          {hall.name}
                        </Tab>
                      ))}
                      {(hallsOf[id] ?? []).length === 0 && (
                        <span className="text-[0.8125rem] text-text-subtle">во всех залах</span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button size="sm" pending={pending} onClick={() => void save()}>
              Сохранить состав
            </Button>
            <span className="text-[0.8125rem] text-text-muted">
              {saved ? 'Сохранено · ' : ''}на странице {shown} из {order.length}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid h-8 w-8 place-items-center rounded-control text-text-muted',
        'hover:bg-surface-sunken hover:text-text disabled:opacity-30 disabled:hover:bg-transparent',
      )}
    >
      {children}
    </button>
  );
}
