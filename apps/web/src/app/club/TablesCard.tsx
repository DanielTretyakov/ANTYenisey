'use client';

import { useState, type FormEvent } from 'react';
import type { ClubTable } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { inputClassName } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

/**
 * Столы клуба.
 *
 * «Настройка количества столов» из ТЗ — это список, а не поле со счётчиком:
 * у каждого стола есть название, которое клиент увидит при выборе, и брони,
 * которые за ним закреплены. Счётчик рядом с реальными столами неизбежно
 * разошёлся бы с ними.
 */
export function TablesCard({ initial }: { initial: ClubTable[] }) {
  const [tables, setTables] = useState<ClubTable[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [pending, setPending] = useState(false);
  /** Стол, который сейчас переименовывают. Одновременно — только один. */
  const [editing, setEditing] = useState<string | null>(null);

  async function run(action: () => Promise<void>): Promise<void> {
    setError(null);
    setPending(true);

    try {
      await action();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен, попробуйте позже');
    } finally {
      setPending(false);
    }
  }

  async function handleAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    await run(async () => {
      const created = await api.createTable(label);
      // Порядок тот же, что на сервере, — по названию: иначе новый стол
      // встанет в конец, а после перезагрузки прыгнет на своё место.
      setTables((previous) => [...previous, created].sort(byLabel));
      setLabel('');
    });
  }

  async function handleRename(table: ClubTable, next: string): Promise<void> {
    setEditing(null);

    if (next === table.label) {
      return;
    }

    await run(async () => {
      const updated = await api.renameTable(table.id, next);
      setTables((previous) =>
        previous.map((item) => (item.id === table.id ? updated : item)).sort(byLabel),
      );
    });
  }

  async function handleDelete(table: ClubTable): Promise<void> {
    await run(async () => {
      await api.deleteTable(table.id);
      setTables((previous) => previous.filter((item) => item.id !== table.id));
    });
  }

  return (
    <Card>
      <CardHeader
        title="Столы"
        description="Что клиент увидит при выборе стола. Названия видны ему как есть."
      />
      <CardBody>
        {error && <Alert>{error}</Alert>}

        {tables.length === 0 ? (
          <p className="mb-4 text-[0.9375rem] text-text-muted">
            Столов пока нет. Пока их нет, забронировать нечего.
          </p>
        ) : (
          <ul className="mb-5 divide-y divide-border border-y border-border">
            {tables.map((table) => (
              <li key={table.id} className="flex items-center gap-3 py-2.5">
                {editing === table.id ? (
                  <RenameInput
                    initial={table.label}
                    onDone={(next) => void handleRename(table, next)}
                  />
                ) : (
                  <>
                    <span className="flex-1 text-[0.9375rem] text-text">{table.label}</span>

                    {table.hasBookings && (
                      <span className="text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">
                        есть брони
                      </span>
                    )}

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => setEditing(table.id)}
                    >
                      Переименовать
                    </Button>

                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      // Стол с бронями удалить нельзя: за бронями стоят платежи.
                      // Кнопка гасится сразу, а не отвечает отказом после нажатия.
                      disabled={pending || table.hasBookings}
                      title={
                        table.hasBookings
                          ? 'У стола есть брони — за ними стоят платежи, удалить его нельзя'
                          : undefined
                      }
                      onClick={() => void handleDelete(table)}
                    >
                      Удалить
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAdd} className="flex items-stretch gap-3">
          <input
            aria-label="Название нового стола"
            placeholder="Стол 1"
            maxLength={64}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className={cn(inputClassName, 'flex-1')}
          />
          <Button type="submit" variant="secondary" pending={pending} disabled={label.trim() === ''}>
            Добавить
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

/**
 * Поле переименования.
 *
 * Сохраняет по Enter и по потере фокуса, отменяет по Escape — так ведёт себя
 * переименование файла, и другого поведения здесь никто не ждёт.
 */
function RenameInput({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (label: string) => void;
}) {
  const [value, setValue] = useState(initial);

  return (
    <input
      autoFocus
      aria-label="Новое название стола"
      maxLength={64}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onDone(value.trim() === '' ? initial : value.trim())}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          setValue(initial);
          onDone(initial);
        }
      }}
      className={cn(inputClassName, 'flex-1')}
    />
  );
}

const byLabel = (a: ClubTable, b: ClubTable): number => a.label.localeCompare(b.label, 'ru');
