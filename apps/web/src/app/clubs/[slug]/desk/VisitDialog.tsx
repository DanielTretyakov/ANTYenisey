'use client';

import { useEffect, useState } from 'react';
import type { ClubCoach, ClubPerson, DeskDay } from '@yenisey/types';
import { ClientPicker } from '@/components/club/ClientPicker';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { inputClassName } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { formatMinute } from '@/lib/bookingGrid';
import { zonedToInstant } from '@/lib/timezones';
import { useClubApi } from '@/lib/useClubApi';

/**
 * «Внести визит» — человек пришёл без брони или играл, а записать забыли.
 *
 * Один инструмент на оба случая, как в ТЗ: визит с порога и сверка истории
 * отличаются только временем. Денег визит не двигает — это строка в истории
 * клиента, а не услуга с ценой; платную аренду заводит «Посадить клиента».
 */
export function VisitDialog({
  day,
  onClose,
  onCreated,
}: {
  day: DeskDay;
  onClose: () => void;
  onCreated: () => void;
}) {
  const club = useClubApi();

  const [client, setClient] = useState<ClubPerson | null>(null);
  const [date, setDate] = useState(day.date);
  // Сегодня — «сейчас»: чаще всего вносят того, кто только что вошёл.
  const [time, setTime] = useState(formatMinute(day.nowMinute ?? 18 * 60));
  const [coachId, setCoachId] = useState('');
  const [note, setNote] = useState('');
  const [coaches, setCoaches] = useState<ClubCoach[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    club
      .coaches()
      .then(setCoaches)
      .catch(() => setCoaches([]));
  }, [club]);

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  async function submit(): Promise<void> {
    if (!client) return;

    // Время — по поясу зала: визит в Абакане не должен съехать на час из-за
    // того, что браузер администратора живёт в Красноярске.
    const visitedAt = zonedToInstant(date, time, day.timezone);

    if (!visitedAt) {
      setError('Не удалось разобрать дату и время визита');
      return;
    }

    setPending(true);
    setError(null);

    try {
      await club.recordVisit({
        clientId: client.id,
        visitedAt: visitedAt.toISOString(),
        coachId: coachId || undefined,
        note: note.trim() || undefined,
      });
      onCreated();
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto px-4 py-10"
      style={{ background: 'color-mix(in oklab, var(--ink-950) 45%, transparent)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="visit-title"
        className="mx-auto w-full max-w-lg rounded-card border border-border bg-surface-raised shadow-lg"
      >
        <div className="border-b border-border px-6 py-5">
          <h2 id="visit-title" className="text-[1.0625rem]">
            Внести визит
          </h2>
          <p className="mt-1 text-[0.875rem] text-text-muted">
            Человек пришёл без брони или играл, а записать забыли. Визит ляжет в историю клиента;
            денег он не двигает — платную аренду заводит «Посадить клиента».
          </p>
        </div>

        <div className="grid gap-5 px-6 py-5">
          {error && <Alert>{error}</Alert>}

          <ClientPicker value={client} onChange={setClient} label="Кто пришёл" />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-[0.875rem]">
              <span className="font-medium text-text">День</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className={inputClassName}
              />
            </label>

            <label className="grid gap-1.5 text-[0.875rem]">
              <span className="font-medium text-text">Время</span>
              <input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                className={inputClassName}
              />
            </label>

            <label className="grid gap-1.5 text-[0.875rem] sm:col-span-2">
              <span className="font-medium text-text">Тренер</span>
              <select
                value={coachId}
                onChange={(event) => setCoachId(event.target.value)}
                className={inputClassName}
              >
                <option value="">без тренера</option>
                {coaches.map((coach) => (
                  <option key={coach.id} value={coach.id}>
                    {coach.fullName}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5 text-[0.875rem] sm:col-span-2">
              <span className="font-medium text-text">Комментарий</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Пришёл с другом, оплатил наличными…"
                maxLength={500}
                className={inputClassName}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button onClick={() => void submit()} pending={pending} disabled={!client}>
              Внести
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              Отмена
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
