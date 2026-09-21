'use client';

import { useRef, useState, type FormEvent } from 'react';
import type { CoachCard, CoachSocialLink, UpdateCoachCardRequest } from '@yenisey/types';
import { MAX_COACH_SOCIAL_LINKS } from '@yenisey/types';
import { PlayerAvatar } from '@/components/player/PlayerView';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field, inputClassName } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

const MB = 1024 * 1024;

function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером';
}

/**
 * Чем править карточку.
 *
 * Маршруты платформенные — карточка одна на все клубы, — но форма о них не
 * знает: так её нетрудно будет открыть и с другого экрана.
 */
export interface CoachActions {
  update: (patch: UpdateCoachCardRequest) => Promise<CoachCard>;
  setPhoto: (file: File) => Promise<CoachCard>;
  removePhoto: () => Promise<CoachCard>;
}

/** Форма карточки тренера: фотография, два текста и ссылки. Цен здесь нет — они клубные. */
export function CoachEditor({
  profile,
  name,
  actions,
  onChange,
}: {
  profile: CoachCard;
  /** Чьё имя показать вместо фотографии, пока её нет. */
  name: string;
  actions: CoachActions;
  onChange: (profile: CoachCard) => void;
}) {
  return (
    <div className="grid gap-8">
      <PhotoBlock profile={profile} name={name} actions={actions} onChange={onChange} />
      <TextForm profile={profile} actions={actions} onChange={onChange} />
      <LinksForm profile={profile} actions={actions} onChange={onChange} />
    </div>
  );
}

function PhotoBlock({
  profile,
  name,
  actions,
  onChange,
}: {
  profile: CoachCard;
  name: string;
  actions: CoachActions;
  onChange: (profile: CoachCard) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: 'upload' | 'remove', action: () => Promise<CoachCard>): Promise<void> {
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

    void run('upload', () => actions.setPhoto(file));
  }

  return (
    <section>
      <div className="flex flex-wrap items-center gap-5">
        <PlayerAvatar fileId={profile.photoFileId} name={name} size="lg" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              pending={pending === 'upload'}
              disabled={pending !== null}
              onClick={() => input.current?.click()}
            >
              {profile.photoFileId ? 'Заменить фото' : 'Загрузить фото'}
            </Button>
            {profile.photoFileId && (
              <Button
                size="sm"
                variant="ghost"
                pending={pending === 'remove'}
                disabled={pending !== null}
                onClick={() => void run('remove', actions.removePhoto)}
              >
                Убрать
              </Button>
            )}
          </div>
          <p className="mt-2 text-[0.8125rem] text-text-subtle">
            JPEG, PNG или WebP до 5 МБ. Фотография видна всем: карточка тренера открыта без входа.
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
    </section>
  );
}

const TEXTS = [
  {
    key: 'achievements',
    label: 'Достижения',
    hint: 'По одному в строку — переносы сохранятся.',
    rows: 5,
    max: 2000,
  },
  { key: 'inventory', label: 'Инвентарь', hint: 'Основание, накладки, мячи — свободным текстом.', rows: 3, max: 1000 },
] as const;

function TextForm({
  profile,
  actions,
  onChange,
}: {
  profile: CoachCard;
  actions: CoachActions;
  onChange: (profile: CoachCard) => void;
}) {
  const [draft, setDraft] = useState(() => ({
    achievements: profile.achievements ?? '',
    inventory: profile.inventory ?? '',
  }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const changed = TEXTS.some((text) => draft[text.key] !== (profile[text.key] ?? ''));

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);

    try {
      onChange(await actions.update(draft));
      setSaved(true);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      {TEXTS.map((text) => (
        <Field key={text.key} label={text.label} hint={text.hint} id={`coach-${text.key}`}>
          <textarea
            id={`coach-${text.key}`}
            aria-describedby={`coach-${text.key}-hint`}
            className={cn(inputClassName, 'resize-y')}
            rows={text.rows}
            maxLength={text.max}
            value={draft[text.key]}
            onChange={(event) => {
              setSaved(false);
              setDraft((current) => ({ ...current, [text.key]: event.target.value }));
            }}
          />
        </Field>
      ))}

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" pending={pending} disabled={!changed}>
          Сохранить
        </Button>
        {saved && !changed && <span className="text-[0.8125rem] text-text-muted">Сохранено.</span>}
      </div>
    </form>
  );
}

/**
 * Ссылки на соцсети.
 *
 * Правятся списком целиком, а не по одной: их единицы, и «сохранить всё» —
 * одно понятное действие вместо трёх кнопок у каждой строки.
 */
function LinksForm({
  profile,
  actions,
  onChange,
}: {
  profile: CoachCard;
  actions: CoachActions;
  onChange: (profile: CoachCard) => void;
}) {
  const [links, setLinks] = useState<CoachSocialLink[]>(profile.socialLinks);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const changed = JSON.stringify(links) !== JSON.stringify(profile.socialLinks);

  function edit(index: number, patch: Partial<CoachSocialLink>): void {
    setSaved(false);
    setLinks((current) => current.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);

    try {
      const next = await actions.update({ socialLinks: links });
      onChange(next);
      setLinks(next.socialLinks);
      setSaved(true);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <h3 className="text-[0.9375rem] font-medium">Контакты в соцсетях</h3>
      <p className="mt-0.5 mb-3.5 text-[0.8125rem] text-text-muted">
        Подпись и адрес. Адрес — целиком, с «https://».
      </p>

      <ul className="grid gap-3">
        {links.map((link, index) => (
          // Ключ по месту в списке: строки не переставляются, а подпись с
          // адресом меняются на каждое нажатие клавиши — по ним поле теряло бы
          // фокус.
          <li key={index} className="flex flex-wrap items-start gap-2">
            <input
              className={cn(inputClassName, 'w-full sm:w-40')}
              placeholder="ВКонтакте"
              aria-label={`Подпись ссылки ${index + 1}`}
              maxLength={50}
              value={link.label}
              onChange={(event) => edit(index, { label: event.target.value })}
            />
            <input
              className={cn(inputClassName, 'w-full sm:w-auto sm:flex-1')}
              placeholder="https://vk.com/…"
              aria-label={`Адрес ссылки ${index + 1}`}
              inputMode="url"
              maxLength={300}
              value={link.url}
              onChange={(event) => edit(index, { url: event.target.value })}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSaved(false);
                setLinks((current) => current.filter((_, i) => i !== index));
              }}
            >
              Убрать
            </Button>
          </li>
        ))}
      </ul>

      {links.length === 0 && <p className="text-[0.875rem] text-text-muted">Ссылок нет.</p>}

      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={links.length >= MAX_COACH_SOCIAL_LINKS}
          onClick={() => {
            setSaved(false);
            setLinks((current) => [...current, { label: '', url: '' }]);
          }}
        >
          Добавить ссылку
        </Button>
        <Button type="submit" size="sm" pending={pending} disabled={!changed}>
          Сохранить ссылки
        </Button>
        {saved && !changed && <span className="text-[0.8125rem] text-text-muted">Сохранено.</span>}
      </div>
    </form>
  );
}
