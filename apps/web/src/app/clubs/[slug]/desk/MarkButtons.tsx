'use client';

import { useState } from 'react';
import type { AttendanceKind, MarkAttendanceRequest } from '@yenisey/types';
import { Button } from '@/components/ui/Button';
import { inputClassName } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useClubApi } from '@/lib/useClubApi';

/**
 * «Пришёл» и «Не пришёл» у одной записи.
 *
 * «Пришёл» — одним нажатием: это частый и безопасный случай, администратор
 * отмечает людей по мере прихода. «Не пришёл» — вторым шагом: неявка
 * списывает деньги, и случайное нажатие в списке из двадцати человек обошлось
 * бы дороже лишнего вопроса. Второй шаг заодно предлагает простить неявку —
 * с причиной, она останется в истории записи.
 */
export function MarkButtons({
  kind,
  entryId,
  noShowPercent,
  bySubscription = false,
  onDone,
}: {
  kind: AttendanceKind;
  entryId: string;
  noShowPercent: number;
  /** Запись по абонементу: неявка сжигает визит, а не списывает процент. */
  bySubscription?: boolean;
  onDone: () => void;
}) {
  const club = useClubApi();
  const [step, setStep] = useState<'idle' | 'no-show' | 'waive'>('idle');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mark(request: MarkAttendanceRequest): Promise<void> {
    setPending(true);
    setError(null);

    try {
      await club.markAttendance(kind, entryId, request);
      setStep('idle');
      setReason('');
      onDone();
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');
    } finally {
      setPending(false);
    }
  }

  const back = (
    <button
      type="button"
      onClick={() => {
        setStep('idle');
        setError(null);
      }}
      className="text-[0.8125rem] text-text-subtle underline underline-offset-2 hover:text-text"
    >
      не надо
    </button>
  );

  return (
    <span className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
      {step === 'idle' && (
        <>
          <Button size="sm" pending={pending} onClick={() => void mark({ status: 'ATTENDED' })}>
            Пришёл
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => setStep('no-show')}>
            Не пришёл
          </Button>
        </>
      )}

      {step === 'no-show' && (
        <>
          <span className="text-text-muted">
            {bySubscription ? 'Визит абонемента сгорит.' : `Списать ${noShowPercent}% по политике клуба?`}
          </span>
          <Button
            size="sm"
            variant="danger"
            pending={pending}
            onClick={() => void mark({ status: 'NO_SHOW' })}
          >
            Да, неявка
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => setStep('waive')}>
            {bySubscription ? 'Вернуть визит…' : 'Без списания…'}
          </Button>
          {back}
        </>
      )}

      {step === 'waive' && (
        <>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Почему прощаем: стол сломался, клуб перенёс…"
            aria-label="Причина прощения неявки"
            maxLength={500}
            autoFocus
            className={cn(inputClassName, 'h-8 w-72 max-w-full py-1 text-[0.8125rem]')}
          />
          <Button
            size="sm"
            variant="secondary"
            pending={pending}
            // Причина обязательна: без неё прощённая неявка через неделю
            // выглядит как ошибка кассы, а не как решение клуба.
            disabled={reason.trim() === ''}
            onClick={() => void mark({ status: 'NO_SHOW', waiveCharge: true, reason })}
          >
            Простить неявку
          </Button>
          {back}
        </>
      )}

      {error && <span className="basis-full text-danger">{error}</span>}
    </span>
  );
}
