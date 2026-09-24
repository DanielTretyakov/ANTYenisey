'use client';

import { useEffect, useRef, useState } from 'react';
import type { ClubCoachListItem, ClubSettings } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
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
  onSettings,
}: {
  settings: ClubSettings;
  onSettings: (settings: ClubSettings) => void;
}) {
  return (
    <Card>
      <CardHeader
        title="Страница клуба"
        description="Баннер над названием и тренеры, которых видит посетитель. Карточку тренер ведёт сам — здесь выбирается только, кого и в каком порядке показать."
      />
      <CardBody className="grid gap-8">
        <BannerBlock settings={settings} onSettings={onSettings} />
        <CoachListBlock />
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
 * Тренерский состав: галочка «показывать» и порядок стрелками.
 *
 * Сохраняется целиком одной кнопкой: состав — это список, и сохранять каждую
 * перестановку отдельно значило бы на мгновение показывать посетителю два
 * тренера на одном месте.
 */
function CoachListBlock() {
  const club = useClubApi();
  const [coaches, setCoaches] = useState<ClubCoachListItem[] | null>(null);
  const [shown, setShown] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(list: ClubCoachListItem[]): void {
    setCoaches(list);
    setShown(list.filter((coach) => coach.order !== null).map((coach) => coach.id));
  }

  useEffect(() => {
    club
      .coachList()
      .then(load)
      .catch((cause: unknown) => setError(messageOf(cause)));
  }, [club]);

  const hidden = (coaches ?? []).filter((coach) => !shown.includes(coach.id));
  const nameOf = (id: string): string => coaches?.find((coach) => coach.id === id)?.fullName ?? id;

  function move(index: number, delta: -1 | 1): void {
    setShown((list) => {
      const next = [...list];
      const target = index + delta;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setSaved(false);
  }

  async function save(): Promise<void> {
    setPending(true);
    setError(null);

    try {
      load(await club.setCoachList(shown));
      setSaved(true);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h3 className="text-[0.9375rem] font-medium">Тренерский состав</h3>
      <p className="mt-0.5 text-[0.8125rem] text-text-muted">
        Показываются только отмеченные — в этом порядке. Список берётся из людей с ролью тренера в
        «Составе клуба».
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
            {shown.map((id, index) => (
              <li
                key={id}
                className="flex items-center gap-2 rounded-control border border-border bg-surface-raised px-3 py-2"
              >
                <span className="w-6 text-[0.8125rem] text-text-subtle tabular-nums">{index + 1}.</span>
                <span className="min-w-0 grow truncate text-[0.9375rem]">{nameOf(id)}</span>
                <IconButton label="Выше" disabled={index === 0} onClick={() => move(index, -1)}>
                  ↑
                </IconButton>
                <IconButton label="Ниже" disabled={index === shown.length - 1} onClick={() => move(index, 1)}>
                  ↓
                </IconButton>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShown((list) => list.filter((item) => item !== id));
                    setSaved(false);
                  }}
                >
                  Скрыть
                </Button>
              </li>
            ))}
          </ol>

          {hidden.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[0.8125rem] text-text-subtle">Не показаны:</span>
              {hidden.map((coach) => (
                <Button
                  key={coach.id}
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setShown((list) => [...list, coach.id]);
                    setSaved(false);
                  }}
                >
                  + {coach.fullName}
                </Button>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <Button size="sm" pending={pending} onClick={() => void save()}>
              Сохранить состав
            </Button>
            {saved && <span className="text-[0.8125rem] text-text-muted">Сохранено</span>}
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
