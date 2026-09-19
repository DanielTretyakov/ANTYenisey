'use client';

import { useEffect, useState } from 'react';
import type { AttendanceHistoryItem, DeskDay } from '@yenisey/types';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { inputClassName } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { correctionsFor, markedRows, markLabel, type Correction, type MarkedRow } from '@/lib/attendance';
import { cn } from '@/lib/cn';
import { useClubApi } from '@/lib/useClubApi';
import { PersonLink } from './PersonLink';
import { clockIn, momentIn } from './time';

/**
 * «Отмечено в этот день»: кто пришёл, кто нет и кто поставил отметку.
 *
 * Подпись «кто и когда» стоит в строке, а не прячется в истории: «кто
 * поставил мне неявку» — первый вопрос клиента, и администратор должен
 * ответить на него, не открывая ничего. Исправить отметку можно только с
 * причиной — она останется в истории записи.
 */
export function MarkedBlock({ day, onChanged }: { day: DeskDay; onChanged: () => void }) {
  // Мероприятия вне сетки — тоже: после отметки они ушли из «Требует
  // отметки», и других мест на экране у них нет.
  const rows = markedRows({ bookings: day.bookings, events: [...day.events, ...day.unplaced] });

  return (
    <Card>
      <CardHeader
        title="Отмечено в этот день"
        description="Исправить отметку можно только с причиной: за ней стоят деньги, и через неделю спорить без причины будет не о чем."
      />

      {rows.length === 0 && day.visits.length === 0 ? (
        <CardBody>
          <p className="text-[0.9375rem] text-text-muted">В этот день пока ничего не отмечено.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.key} className="px-6 py-3.5">
              <MarkedItem row={row} day={day} onChanged={onChanged} />
            </li>
          ))}

          {day.visits.map((visit) => (
            <li key={`visit-${visit.id}`} className="flex flex-wrap items-center gap-x-5 gap-y-1 px-6 py-3.5">
              <Time at={visit.visitedAt} note="с порога" timezone={day.timezone} />
              <span className="min-w-[12rem] flex-1">
                <span className="block text-[0.9375rem]">
                  <PersonLink userId={visit.client.userId}>{visit.client.fullName}</PersonLink>
                </span>
                <span className="mt-0.5 block text-[0.8125rem] text-text-muted">
                  {[
                    'визит без брони',
                    visit.coachName ? `тренер ${visit.coachName}` : '',
                    visit.note ? `«${visit.note}»` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="text-[0.8125rem] text-text-subtle">
                {visit.recordedBy ? `внёс ${visit.recordedBy}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MarkedItem({ row, day, onChanged }: { row: MarkedRow; day: DeskDay; onChanged: () => void }) {
  const [open, setOpen] = useState<'correct' | 'history' | null>(null);
  const charged = row.status === 'NO_SHOW' && row.chargePercent !== 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <Time at={row.startsAt} note={row.what} timezone={day.timezone} />

        <span className="min-w-[12rem] flex-1">
          <span className="block text-[0.9375rem]">
            <PersonLink userId={row.person.userId}>{row.person.fullName}</PersonLink>
          </span>
          <span className="mt-0.5 block text-[0.8125rem] text-text-muted">
            <span className={cn(row.status === 'ATTENDED' ? 'text-text-accent' : charged && 'text-warning')}>
              {markLabel(row.status, row.chargePercent, row.bySubscription)}
            </span>
            {row.mark &&
              ` · ${row.mark.auto ? 'поставила система' : `отметил ${row.mark.by ?? '—'}`} ${momentIn(row.mark.at, day.timezone, day.date)}`}
            {row.mark?.reason && <span className="text-text-subtle"> · «{row.mark.reason}»</span>}
          </span>
        </span>

        <span className="flex gap-3 text-[0.8125rem]">
          <Toggle active={open === 'correct'} onClick={() => setOpen(open === 'correct' ? null : 'correct')}>
            исправить
          </Toggle>
          <Toggle active={open === 'history'} onClick={() => setOpen(open === 'history' ? null : 'history')}>
            история
          </Toggle>
        </span>
      </div>

      {open === 'correct' && (
        <CorrectMark
          row={row}
          noShowPercent={day.policy.noShowChargePercent}
          onCancel={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            onChanged();
          }}
        />
      )}

      {open === 'history' && <History row={row} timezone={day.timezone} date={day.date} />}
    </div>
  );
}

/**
 * Исправление отметки: противоположный итог и причина.
 *
 * Варианты — только отличающиеся от нынешнего: «исправить на то же самое»
 * ничего бы не сделало. Вернуть в «не отмечено» нельзя: после занятия это не
 * состояние, а незаконченная работа.
 */
function CorrectMark({
  row,
  noShowPercent,
  onCancel,
  onDone,
}: {
  row: MarkedRow;
  noShowPercent: number;
  onCancel: () => void;
  onDone: () => void;
}) {
  const club = useClubApi();
  const options = correctionsFor(row.status, row.chargePercent, noShowPercent, row.bySubscription);
  const [choice, setChoice] = useState<Correction | null>(options[0] ?? null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (!choice) return;

    setPending(true);
    setError(null);

    try {
      await club.markAttendance(row.kind, row.entryId, { ...choice.request, reason });
      onDone();
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3 grid gap-3 rounded-control border border-border bg-surface-sunken px-4 py-3.5 sm:ml-[5.75rem]">
      <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-[0.875rem]">
        <legend className="sr-only">Исправить на</legend>
        {options.map((option) => (
          <label key={option.key} className="flex items-center gap-2">
            <input
              type="radio"
              name={`correct-${row.key}`}
              checked={choice?.key === option.key}
              onChange={() => setChoice(option)}
              className="h-4 w-4 accent-accent"
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Причина: перепутали с однофамильцем, пришёл к концу…"
        aria-label="Причина исправления"
        maxLength={500}
        className={cn(inputClassName, 'text-[0.875rem]')}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" pending={pending} disabled={!choice || reason.trim() === ''} onClick={() => void save()}>
          Исправить
        </Button>
        <Button size="sm" variant="secondary" disabled={pending} onClick={onCancel}>
          Не надо
        </Button>
        {error && <span className="text-[0.8125rem] text-danger">{error}</span>}
      </div>
    </div>
  );
}

/** История отметок записи — из журнала аудита, по порядку. */
function History({ row, timezone, date }: { row: MarkedRow; timezone: string; date: string }) {
  const club = useClubApi();
  const [items, setItems] = useState<AttendanceHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Грузится при открытии, а не заранее: историю смотрят редко, и двадцать
  // запросов на каждое открытие экрана ради неё не нужны.
  useEffect(() => {
    let cancelled = false;

    club
      .attendanceHistory(row.kind, row.entryId)
      .then((loaded) => {
        if (!cancelled) setItems(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [club, row.kind, row.entryId]);

  return (
    <div className="mt-3 text-[0.8125rem] sm:ml-[5.75rem]">
      {error && <p className="text-danger">{error}</p>}
      {!error && items === null && <p className="text-text-subtle">Загружаем историю…</p>}
      {items?.length === 0 && (
        <p className="text-text-subtle">Истории нет: запись отмечена до появления журнала.</p>
      )}
      {items && items.length > 0 && (
        <ol className="grid gap-1 border-l-2 border-border pl-4">
          {items.map((item, index) => (
            <li key={index} className="text-text-muted">
              <span className="text-text">{momentIn(item.at, timezone, date)}</span>{' '}
              {item.auto ? 'система' : (item.by ?? '—')}:{' '}
              {item.before ? markLabel(item.before.status, item.before.chargePercent, row.bySubscription) : '—'} →{' '}
              {item.after ? markLabel(item.after.status, item.after.chargePercent, row.bySubscription) : '—'}
              {item.reason && <span className="text-text-subtle"> · «{item.reason}»</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Time({ at, note, timezone }: { at: string; note: string; timezone: string }) {
  return (
    <span className="grid min-w-[4.5rem] tabular-nums">
      <span className="font-display text-[1.0625rem] leading-tight">{clockIn(at, timezone)}</span>
      <span className="max-w-[9rem] truncate text-[0.75rem] text-text-subtle">{note}</span>
    </span>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={cn(
        'underline underline-offset-2 transition-colors',
        active ? 'text-text' : 'text-text-subtle hover:text-text',
      )}
    >
      {children}
    </button>
  );
}
