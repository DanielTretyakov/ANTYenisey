'use client';

import { useState, type FormEvent } from 'react';
import type { ClosureException, ClubTable } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, inputClassName } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatInstant, zonedToInstant } from '@/lib/timezones';

/** Значение выпадающего списка, означающее «все столы разом». */
const ALL_TABLES = '*';

/**
 * Разовые окна: турнир, ремонт, аренда зала целиком.
 *
 * Отдельно от недельного расписания, потому что отвечают на другой вопрос.
 * Расписание — «как клуб живёт обычно», окно — «что случилось двенадцатого
 * марта». Смешав их, пришлось бы править расписание туда-обратно вокруг
 * каждого турнира.
 */
export function ExceptionsCard({
  tables,
  initial,
  timezone,
}: {
  tables: ClubTable[];
  initial: ClosureException[];
  timezone: string;
}) {
  const [exceptions, setExceptions] = useState<ClosureException[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [tableId, setTableId] = useState<string>(ALL_TABLES);
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');

  const labels = new Map(tables.map((table) => [table.id, table.label]));

  async function handleAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const startsAt = zonedToInstant(date, from, timezone);
    const endsAt = zonedToInstant(date, to, timezone);

    if (!startsAt || !endsAt) {
      setError('Заполните дату и время');
      return;
    }

    if (endsAt.getTime() <= startsAt.getTime()) {
      setError('Конец окна должен быть позже начала');
      return;
    }

    const targets = tableId === ALL_TABLES ? tables.map((table) => table.id) : [tableId];
    setPending(true);

    try {
      // Один стол — одна запись: так же, как в недельном расписании. «Закрыть
      // весь зал» разворачивается здесь, а не хранится особым признаком, —
      // иначе добавление стола задним числом молча меняло бы смысл старых окон.
      const created = await Promise.all(
        targets.map((id) =>
          api.createClosureException({
            tableId: id,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            reason: reason.trim() || null,
          }),
        ),
      );

      setExceptions((previous) => [...previous, ...created].sort(byStart));
      setDate('');
      setFrom('');
      setTo('');
      setReason('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен, попробуйте позже');
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    setError(null);
    setPending(true);

    try {
      await api.deleteClosureException(id);
      setExceptions((previous) => previous.filter((item) => item.id !== id));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен, попробуйте позже');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Разовые окна"
        description="Турнир, ремонт, аренда зала целиком — то, что случается один раз и не должно попадать в постоянное расписание."
      />
      <CardBody>
        {error && <Alert>{error}</Alert>}

        {exceptions.length === 0 ? (
          <p className="mb-5 text-[0.9375rem] text-text-muted">Разовых окон нет.</p>
        ) : (
          <ul className="mb-5 divide-y divide-border border-y border-border">
            {exceptions.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="text-[0.9375rem] text-text">
                  {labels.get(item.tableId) ?? 'Удалённый стол'}
                </span>
                <span className="text-[0.875rem] text-text-muted">
                  {formatInstant(item.startsAt, timezone)} — {formatInstant(item.endsAt, timezone)}
                </span>
                {item.reason && (
                  <span className="text-[0.875rem] text-text-subtle">{item.reason}</span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  disabled={pending}
                  onClick={() => void handleDelete(item.id)}
                >
                  Убрать
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAdd}>
          <div className="grid gap-x-4 sm:grid-cols-4">
            <Select
              label="Стол"
              options={[
                { value: ALL_TABLES, label: 'Все столы' },
                ...tables.map((table) => ({ value: table.id, label: table.label })),
              ]}
              value={tableId}
              onChange={(event) => setTableId(event.target.value)}
            />
            <Field
              label="Дата"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <Field
              label="С"
              type="time"
              step={1800}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <Field
              label="До"
              type="time"
              step={1800}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>

          <div className="flex items-stretch gap-3">
            <input
              aria-label="Причина"
              placeholder="Причина: турнир, ремонт…"
              maxLength={200}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={cn(inputClassName, 'flex-1')}
            />
            <Button type="submit" variant="secondary" pending={pending} disabled={tables.length === 0}>
              Закрыть время
            </Button>
          </div>

          <p className="mt-2 text-[0.8125rem] text-text-subtle">
            Время указывается по часовому поясу клуба, а не вашего компьютера.
          </p>
        </form>
      </CardBody>
    </Card>
  );
}

const byStart = (a: ClosureException, b: ClosureException): number =>
  a.startsAt.localeCompare(b.startsAt);
