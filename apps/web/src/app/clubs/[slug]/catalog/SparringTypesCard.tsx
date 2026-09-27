'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { SparringType, SparringTypeRequest } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { MoneyField } from '@/components/ui/MoneyField';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatKopecks, inputToKopecks, kopecksToInput } from '@/lib/money';
import { useClubApi } from '@/lib/useClubApi';

/** Что правится в форме: строки полей, пока человек печатает. */
interface Draft {
  name: string;
  price: string;
  minAge: string;
  maxAge: string;
  description: string;
}

const EMPTY: Draft = { name: '', price: '', minAge: '', maxAge: '', description: '' };

function draftOf(type: SparringType): Draft {
  return {
    name: type.name,
    price: kopecksToInput(type.hourPrice),
    minAge: type.minAge === null ? '' : String(type.minAge),
    maxAge: type.maxAge === null ? '' : String(type.maxAge),
    description: type.description ?? '',
  };
}

/** «до 13 лет», «от 18 лет», «7–13 лет», пусто — без ограничений. */
export function ageLabel(type: Pick<SparringType, 'minAge' | 'maxAge'>): string | null {
  if (type.minAge !== null && type.maxAge !== null) return `${type.minAge}–${type.maxAge} лет`;
  if (type.minAge !== null) return `от ${type.minAge} лет`;
  if (type.maxAge !== null) return `до ${type.maxAge} лет`;

  return null;
}

/**
 * Типы спаррингов (решение владельца от 26.09.2026): «Взрослый», «Детский»,
 * «Льготный». Тренер выбирает тип, записывая ученика на спарринг, и ученик
 * платит цену типа — стол в неё входит. Возраст проверяет сервер на день
 * спарринга; документов о льготе система не хранит — тип выбирает тренер.
 *
 * Правка действует сразу, как у видов занятий: цена у брони снимается копией,
 * и уже заведённые спарринги она не трогает.
 */
export function SparringTypesCard() {
  const club = useClubApi();
  const [types, setTypes] = useState<SparringType[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    club
      .sparringTypes()
      .then(setTypes)
      .catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'));
  }, [club]);

  function requestOf(from: Draft, isActive: boolean): SparringTypeRequest | string {
    const hourPrice = inputToKopecks(from.price);
    const age = (value: string): number | null | undefined =>
      value.trim() === '' ? null : Number.isInteger(Number(value)) ? Number(value) : undefined;
    const minAge = age(from.minAge);
    const maxAge = age(from.maxAge);

    if (hourPrice === null) return 'Цена часа указывается числом, например 1500';
    if (minAge === undefined || maxAge === undefined) return 'Возраст — целым числом лет';

    return {
      name: from.name.trim(),
      hourPrice,
      minAge,
      maxAge,
      description: from.description.trim() || null,
      isActive,
    };
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setPending(true);
    setError(null);

    try {
      await action();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  function replace(saved: SparringType): void {
    setTypes((current) => {
      const list = current ?? [];

      return list.some((type) => type.id === saved.id)
        ? list.map((type) => (type.id === saved.id ? saved : type))
        : [...list, saved];
    });
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const current = editing && editing !== 'new' ? types?.find((type) => type.id === editing) : null;
    const request = requestOf(draft, current?.isActive ?? true);

    if (typeof request === 'string') {
      setError(request);
      return;
    }

    await run(async () => {
      replace(current ? await club.updateSparringType(current.id, request) : await club.createSparringType(request));
      setEditing(null);
    });
  }

  async function toggleActive(type: SparringType): Promise<void> {
    const request = requestOf(draftOf(type), !type.isActive);

    if (typeof request === 'string') return;

    await run(async () => replace(await club.updateSparringType(type.id, request)));
  }

  return (
    <Card>
      <CardHeader
        title="Типы спаррингов"
        description="Тренер выбирает тип, записывая ученика на спарринг, и ученик платит цену типа — стол в неё входит. Цена — за час, спарринг другой длины стоит пропорционально. Абонементом спарринг не оплачивается."
      />
      <CardBody>
        {error && <Alert>{error}</Alert>}

        {types === null ? (
          <p className="text-[0.9375rem] text-text-muted">Загружаю…</p>
        ) : types.length === 0 ? (
          <p className="mb-4 text-[0.9375rem] text-text-muted">
            Типов пока нет — тренеры бронируют стол под спарринг без ученика.
          </p>
        ) : (
          <ul className="mb-4 divide-y divide-border border-y border-border">
            {types.map((type) => (
              <li key={type.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                <span className={cn('min-w-[12rem] flex-1', !type.isActive && 'text-text-subtle line-through')}>
                  <span className="block text-[0.9375rem]">
                    {type.name} · {formatKopecks(type.hourPrice)} за час
                  </span>
                  <span className="block text-[0.8125rem] text-text-muted">
                    {[ageLabel(type) ?? 'любой возраст', type.description].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    setEditing(type.id);
                    setDraft(draftOf(type));
                  }}
                >
                  Изменить
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => void toggleActive(type)}>
                  {type.isActive ? 'Снять' : 'Вернуть'}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {editing === null ? (
          <Button
            variant="secondary"
            onClick={() => {
              setError(null);
              setEditing('new');
              setDraft(EMPTY);
            }}
          >
            Новый тип
          </Button>
        ) : (
          <form onSubmit={(event) => void save(event)} className="rounded-control border border-border p-4">
            <h3 className="mb-4 text-[0.9375rem] font-medium">
              {editing === 'new' ? 'Новый тип спарринга' : 'Правка типа'}
            </h3>

            <Field
              label="Название"
              hint="Например: «Взрослый», «Детский», «Льготный — пенсионеры»."
              value={draft.name}
              maxLength={100}
              required
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />

            <MoneyField
              label="Цена часа"
              value={draft.price}
              onChange={(price) => setDraft({ ...draft, price })}
              className="max-w-48"
            />

            <div className="grid gap-x-6 sm:grid-cols-2">
              <Field
                label="Возраст ученика от, лет"
                hint="Пусто — без нижней границы."
                type="number"
                min={0}
                max={120}
                value={draft.minAge}
                onChange={(event) => setDraft({ ...draft, minAge: event.target.value })}
              />
              <Field
                label="до, лет включительно"
                hint="Считается на день спарринга."
                type="number"
                min={0}
                max={120}
                value={draft.maxAge}
                onChange={(event) => setDraft({ ...draft, maxAge: event.target.value })}
              />
            </div>

            <Field
              label="Для кого"
              hint="Видно тренеру при выборе: кому положен тип, что проверить у стойки."
              value={draft.description}
              maxLength={1000}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />

            <div className="flex flex-wrap gap-2">
              <Button type="submit" pending={pending} disabled={draft.name.trim() === ''}>
                Сохранить
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Отмена
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
