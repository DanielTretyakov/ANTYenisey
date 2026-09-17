'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AchievementLevel, PlayerAchievement, PlayerProfile, PublicUser, SportRankLevel } from '@yenisey/types';
import { ACHIEVEMENT_LEVELS, SPORT_RANK_LEVELS } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { api, ApiError } from '@/lib/api';
import { LEVEL_LABELS, RANK_TITLES } from '@/lib/player';
import { AchievementRow, PlayerAvatar, RankLine } from './PlayerView';
import { DocumentButton } from './DocumentButton';

const MB = 1024 * 1024;

type Update = (profile: PlayerProfile) => void;

function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером';
}

/** Сегодня в виде «2026-09-13» — верхняя граница полей даты. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * «Профиль игрока» в «Кабинете».
 *
 * Расширение сверх ТЗ (решение владельца от 12.09.2026). Заполняет его только
 * сам человек; клуб профиль не правит — он проверяет разряд.
 *
 * Каждый блок сохраняется сам по себе: аватар меняют раз в год, инвентарь —
 * раз в сезон, и общая кнопка «Сохранить всё» заставляла бы отправлять
 * нетронутое.
 */
export function PlayerEditor({ user }: { user: PublicUser }) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .myPlayer()
      .then(setProfile)
      .catch((cause: unknown) => setError(messageOf(cause)));
  }, []);

  return (
    <Card className="mt-6 max-w-2xl">
      <CardHeader
        title="Профиль игрока"
        description={
          profile && !profile.isPublic
            ? 'До 16 лет ваша страница игрока видна только вам и администраторам ваших клубов.'
            : 'Его видят все на вашей странице игрока — без телефона, почты и даты рождения, имя как в списках: «Фамилия И.».'
        }
      />
      <CardBody>
        {error && <Alert>{error}</Alert>}

        {!profile && !error && <p className="text-[0.875rem] text-text-muted">Загружаю…</p>}

        {profile && (
          <div className="grid gap-9">
            <AvatarBlock profile={profile} name={user.fullName} onChange={setProfile} />

            <Block title="Инвентарь">
              <EquipmentForm profile={profile} onChange={setProfile} />
            </Block>

            <Block
              title="Спортивный разряд"
              note="Разряд подтверждает администратор любого вашего клуба — и подтверждение видно везде."
            >
              <RankForm profile={profile} onChange={setProfile} />
            </Block>

            <Block title="Достижения" note="Список ведёте вы сами, клуб его не проверяет.">
              <AchievementsEditor profile={profile} onChange={setProfile} />
            </Block>

            <p className="text-[0.875rem]">
              <Link
                href={`/players/${profile.userId}`}
                className="text-text-accent underline-offset-2 hover:underline"
              >
                Открыть мою страницу игрока →
              </Link>
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-[0.9375rem] font-medium">{title}</h3>
      {note && <p className="mt-0.5 text-[0.8125rem] text-text-muted">{note}</p>}
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

function AvatarBlock({ profile, name, onChange }: { profile: PlayerProfile; name: string; onChange: Update }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: 'upload' | 'remove', action: () => Promise<PlayerProfile>): Promise<void> {
    setPending(kind);
    setError(null);

    try {
      onChange(await action());
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

    // Проверка до отправки — только ради быстрого ответа. Решает сервер: он
    // смотрит на байты, а не на имя и размер из браузера.
    if (file.size > 5 * MB) {
      setError('Файл больше 5 МБ');
      return;
    }

    void run('upload', () => api.setAvatar(file));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-5">
        <PlayerAvatar fileId={profile.avatarFileId} name={name} size="lg" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              pending={pending === 'upload'}
              disabled={pending !== null}
              onClick={() => input.current?.click()}
            >
              {profile.avatarFileId ? 'Заменить фото' : 'Загрузить фото'}
            </Button>
            {profile.avatarFileId && (
              <Button
                size="sm"
                variant="ghost"
                pending={pending === 'remove'}
                disabled={pending !== null}
                onClick={() => void run('remove', () => api.removeAvatar())}
              >
                Убрать
              </Button>
            )}
          </div>
          <p className="mt-2 text-[0.8125rem] text-text-subtle">
            JPEG, PNG или WebP до 5 МБ. Место съёмки и другие данные снимка сервер удаляет.
          </p>
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
      </div>

      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
    </div>
  );
}

function EquipmentForm({ profile, onChange }: { profile: PlayerProfile; onChange: Update }) {
  const saved = profile.equipment;
  const [blade, setBlade] = useState(saved.blade ?? '');
  const [forehand, setForehand] = useState(saved.forehandRubber ?? '');
  const [backhand, setBackhand] = useState(saved.backhandRubber ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const dirty =
    blade.trim() !== (saved.blade ?? '') ||
    forehand.trim() !== (saved.forehandRubber ?? '') ||
    backhand.trim() !== (saved.backhandRubber ?? '');

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const next = await api.updateEquipment({ blade, forehandRubber: forehand, backhandRubber: backhand });
      onChange(next);
      setBlade(next.equipment.blade ?? '');
      setForehand(next.equipment.forehandRubber ?? '');
      setBackhand(next.equipment.backhandRubber ?? '');
      setDone(true);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-x-4 sm:grid-cols-3">
        <Field
          label="Основание"
          value={blade}
          maxLength={100}
          placeholder="Butterfly Viscaria"
          onChange={(event) => {
            setBlade(event.target.value);
            setDone(false);
          }}
        />
        <Field
          label="Накладка справа"
          value={forehand}
          maxLength={100}
          onChange={(event) => {
            setForehand(event.target.value);
            setDone(false);
          }}
        />
        <Field
          label="Накладка слева"
          value={backhand}
          maxLength={100}
          onChange={(event) => {
            setBackhand(event.target.value);
            setDone(false);
          }}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" pending={pending} disabled={!dirty}>
          Сохранить инвентарь
        </Button>
        {done && !dirty && <span className="text-[0.8125rem] text-text-muted">Сохранено</span>}
      </div>
    </form>
  );
}

const RANK_OPTIONS = SPORT_RANK_LEVELS.map((value) => ({ value, label: RANK_TITLES[value] }));

/**
 * Разряд одной формой: сам разряд, приказ и скан. Любая настоящая правка
 * возвращает разряд на проверку — об этом форма говорит до нажатия, а не после.
 */
function RankForm({ profile, onChange }: { profile: PlayerProfile; onChange: Update }) {
  const current = profile.rank;
  const fileInput = useRef<HTMLInputElement>(null);

  const [rank, setRank] = useState<SportRankLevel>(current?.rank ?? 'SPORT_3');
  const [orderNumber, setOrderNumber] = useState(current?.orderNumber ?? '');
  const [orderDate, setOrderDate] = useState(current?.orderDate ?? '');
  const [scan, setScan] = useState<File | null>(null);
  const [removeDocument, setRemoveDocument] = useState(false);
  const [pending, setPending] = useState<'save' | 'remove' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // После ответа сервера форма показывает то, что сохранилось, а не то, что
  // было введено: сервер срезает пробелы и может не поменять ничего.
  useEffect(() => {
    setRank(current?.rank ?? 'SPORT_3');
    setOrderNumber(current?.orderNumber ?? '');
    setOrderDate(current?.orderDate ?? '');
    setScan(null);
    setRemoveDocument(false);
  }, [current?.version, current?.rank, current?.orderNumber, current?.orderDate]);

  const dirty =
    !current ||
    rank !== current.rank ||
    orderNumber.trim() !== (current.orderNumber ?? '') ||
    orderDate !== (current.orderDate ?? '') ||
    scan !== null ||
    removeDocument;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();

    if (scan && scan.size > 10 * MB) {
      setError('Скан больше 10 МБ');
      return;
    }

    setPending('save');
    setError(null);

    try {
      onChange(await api.setRank({ rank, orderNumber: orderNumber.trim(), orderDate, document: scan, removeDocument }));
      if (fileInput.current) fileInput.current.value = '';
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(null);
    }
  }

  async function remove(): Promise<void> {
    setPending('remove');
    setError(null);

    try {
      onChange(await api.removeRank());
      setConfirmRemove(false);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      {current && (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3 rounded-control border border-border bg-surface-sunken px-4 py-3.5">
          <RankLine rank={current} />
          {current.document && <DocumentButton fileId={current.document.id} label="Открыть скан" />}
        </div>
      )}

      <form onSubmit={(event) => void submit(event)}>
        {error && <Alert>{error}</Alert>}

        <Select
          label="Разряд"
          value={rank}
          options={RANK_OPTIONS}
          onChange={(event) => setRank(event.target.value as SportRankLevel)}
        />

        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field
            label="Номер приказа"
            value={orderNumber}
            maxLength={50}
            placeholder="45-нг"
            onChange={(event) => setOrderNumber(event.target.value)}
          />
          <Field
            label="Дата приказа"
            type="date"
            value={orderDate}
            max={today()}
            onChange={(event) => setOrderDate(event.target.value)}
          />
        </div>

        <Field
          label={current?.document ? 'Новый скан приказа' : 'Скан приказа'}
          hint="JPEG, PNG, WebP или PDF до 10 МБ. Его видят только вы и администраторы ваших клубов."
        >
          <input
            ref={fileInput}
            type="file"
            // Подпись полю нужна своя: Field связывает свой <label> только с
            // собственным полем, а этому он отдал место через children.
            aria-label={current?.document ? 'Новый скан приказа' : 'Скан приказа'}
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="block w-full text-[0.875rem] text-text-muted file:mr-3 file:rounded-control file:border file:border-border-strong file:bg-surface-raised file:px-3 file:py-1.5 file:text-[0.8125rem] file:text-text"
            onChange={(event) => {
              setScan(event.target.files?.[0] ?? null);
              setRemoveDocument(false);
            }}
          />
        </Field>

        {current?.document && !scan && (
          <label className="mb-4 flex items-center gap-2.5 text-[0.875rem] text-text-muted">
            <input
              type="checkbox"
              checked={removeDocument}
              onChange={(event) => setRemoveDocument(event.target.checked)}
            />
            Убрать приложенный скан
          </label>
        )}

        <p className="mb-4 text-[0.8125rem] text-text-subtle">
          Нужен номер и дата приказа или его скан — иначе клубу нечем подтвердить разряд.
          {current?.status === 'VERIFIED' && ' Правка снимет подтверждение, и разряд снова уйдёт на проверку.'}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="secondary" pending={pending === 'save'} disabled={!dirty || pending !== null}>
            {current ? 'Сохранить разряд' : 'Заявить разряд'}
          </Button>

          {current && !confirmRemove && (
            <Button type="button" size="sm" variant="ghost" disabled={pending !== null} onClick={() => setConfirmRemove(true)}>
              Убрать разряд
            </Button>
          )}

          {confirmRemove && (
            <>
              <span className="text-[0.8125rem] text-text-muted">Убрать разряд вместе со сканом?</span>
              <Button type="button" size="sm" variant="danger" pending={pending === 'remove'} onClick={() => void remove()}>
                Да, убрать
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                Нет
              </Button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

function AchievementsEditor({ profile, onChange }: { profile: PlayerProfile; onChange: Update }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string): Promise<void> {
    setRemoving(id);
    setError(null);

    try {
      onChange(await api.removeAchievement(id));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div>
      {error && <Alert>{error}</Alert>}

      {profile.achievements.length === 0 && editing !== 'new' && (
        <p className="mb-3 text-[0.875rem] text-text-muted">Пока ни одного.</p>
      )}

      {profile.achievements.length > 0 && (
        <ul className="mb-3 divide-y divide-border">
          {profile.achievements.map((achievement) => (
            <li key={achievement.id} className="py-3 first:pt-0">
              {editing === achievement.id ? (
                <AchievementForm
                  initial={achievement}
                  onCancel={() => setEditing(null)}
                  onSave={async (payload) => {
                    onChange(await api.updateAchievement(achievement.id, payload));
                    setEditing(null);
                  }}
                />
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <AchievementRow achievement={achievement} />
                  </div>
                  <div className="flex shrink-0 gap-1 pl-[5.5rem] sm:pl-0">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(achievement.id)}>
                      Изменить
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      pending={removing === achievement.id}
                      onClick={() => void remove(achievement.id)}
                    >
                      Удалить
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing === 'new' ? (
        <AchievementForm
          onCancel={() => setEditing(null)}
          onSave={async (payload) => {
            onChange(await api.addAchievement(payload));
            setEditing(null);
          }}
        />
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
          Добавить достижение
        </Button>
      )}
    </div>
  );
}

const LEVEL_OPTIONS = ACHIEVEMENT_LEVELS.map((value) => ({
  value,
  label: LEVEL_LABELS[value][0]!.toUpperCase() + LEVEL_LABELS[value].slice(1),
}));

function AchievementForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: PlayerAchievement;
  onSave: (payload: {
    title: string;
    date: string;
    level: AchievementLevel;
    place: number | null;
    note: string | null;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [level, setLevel] = useState<AchievementLevel>(initial?.level ?? 'CITY');
  const [place, setPlace] = useState(initial?.place ? String(initial.place) : '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await onSave({
        title,
        date,
        level,
        place: place.trim() === '' ? null : Number(place),
        note: note.trim() === '' ? null : note,
      });
    } catch (cause) {
      setError(messageOf(cause));
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="rounded-control border border-border bg-surface-sunken px-4 pt-4 pb-3"
    >
      {error && <Alert>{error}</Alert>}

      <Field
        label="Соревнование"
        value={title}
        required
        maxLength={200}
        placeholder="Первенство Красноярского края"
        onChange={(event) => setTitle(event.target.value)}
      />

      <div className="grid gap-x-4 sm:grid-cols-3">
        <Field
          label="Дата"
          type="date"
          value={date}
          required
          max={today()}
          onChange={(event) => setDate(event.target.value)}
        />
        <Select
          label="Уровень"
          value={level}
          options={LEVEL_OPTIONS}
          onChange={(event) => setLevel(event.target.value as AchievementLevel)}
        />
        <Field
          label="Место"
          type="number"
          min={1}
          inputMode="numeric"
          value={place}
          hint="Пусто — участие"
          onChange={(event) => setPlace(event.target.value)}
        />
      </div>

      <Field
        label="Примечание"
        value={note}
        maxLength={500}
        placeholder="Мужской одиночный разряд"
        onChange={(event) => setNote(event.target.value)}
      />

      <div className="flex gap-2">
        <Button type="submit" size="sm" pending={pending}>
          {initial ? 'Сохранить' : 'Добавить'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
