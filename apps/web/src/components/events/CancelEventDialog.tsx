'use client';

import { useState } from 'react';
import { CANCEL_REASON_MAX, CANCEL_REASON_MIN, type EventCancelResult, type EventKind } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { inputClassName } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { useClubApi } from '@/lib/useClubApi';

/**
 * Клуб отменяет занятие или турнир (решения владельца от 10.10.2026).
 *
 * Окно отвечает на два вопроса ДО нажатия: что будет с записавшимися (полный
 * возврат и сообщение с причиной — причину поэтому и спрашиваем) и что будет
 * со столами в сетке. Столы — выбором: тренер заболел — освободить под аренду,
 * зал закрыт — оставить «Стол занят». Отмечённые записи отмена не трогает.
 */
export function CancelEventDialog({
  kind,
  id,
  title,
  bookedCount,
  placed,
  onClose,
  onCancelled,
}: {
  kind: EventKind;
  id: string;
  /** «Детская тренировка · пн, 12 октября, 17:00» — что именно отменяем. */
  title: string;
  /** Сколько действующих записей — им уйдёт сообщение и возврат. */
  bookedCount: number;
  /** Стоит ли проведение в сетке: без окон вопроса о столах нет. */
  placed: boolean;
  onClose: () => void;
  onCancelled: (result: EventCancelResult) => void;
}) {
  const club = useClubApi();
  const [reason, setReason] = useState('');
  const [freeTables, setFreeTables] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const noun = kind === 'TRAINING' ? 'занятие' : 'турнир';
  const ready = reason.trim().length >= CANCEL_REASON_MIN;

  async function submit(): Promise<void> {
    setPending(true);
    setError(null);

    try {
      onCancelled(await club.cancelEvent(kind, id, { reason: reason.trim(), freeTables }));
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      title={`Отменить ${noun}`}
      onClose={onClose}
      description={
        <>
          <span className="font-medium text-text">{title}</span>
          <br />
          {bookedCount > 0
            ? `Записано: ${bookedCount}. Каждому — полный возврат (визит абонемента вернётся) и сообщение с причиной.`
            : 'Действующих записей нет — отмена уберёт его из расписания клуба.'}{' '}
          Уже отмеченные «пришёл» и «не пришёл» не меняются. Вернуть отменённое нельзя.
        </>
      }
    >
      <div className="grid gap-5 px-6 py-5">
        {error && <Alert>{error}</Alert>}

        <label className="grid gap-1.5 text-[0.875rem]">
          <span className="font-medium text-text">Причина — её получат записавшиеся</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Тренер заболел, занятие переносится на четверг"
            maxLength={CANCEL_REASON_MAX}
            rows={3}
            className={inputClassName}
            autoFocus
          />
        </label>

        {placed && (
          <label className="flex items-start gap-2.5 text-[0.875rem]">
            <input
              type="checkbox"
              checked={freeTables}
              onChange={(event) => setFreeTables(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-text">Освободить столы под аренду</span>
              <span className="block text-text-subtle">
                Снимите галочку, если зал не работает: столы останутся закрытыми как «Стол занят».
              </span>
            </span>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="danger" onClick={() => void submit()} pending={pending} disabled={!ready}>
            Отменить {noun}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Не отменять
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
