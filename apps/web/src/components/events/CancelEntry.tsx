'use client';

import { useRef, useState } from 'react';
import type { BookingEntry, BookingKind } from '@yenisey/types';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';

type Terms = Pick<BookingEntry, 'price' | 'paidBy' | 'cancelOutcome' | 'cancelChargePercentNow'>;

/**
 * Что будет, если отменить сейчас, — словами и в рублях.
 *
 * Процент приходит с сервера (`cancelChargePercentNow`, тот же расчёт, что
 * применит сама отмена): браузер его не пересчитывает, только переводит в
 * рубли от зафиксированной цены записи.
 */
export function cancelConsequence(terms: Terms | null): string {
  if (terms === null) {
    return 'Сколько засчитает клуб, зависит от того, сколько осталось до начала. Итог будет виден в «Моём календаре».';
  }

  if (terms.paidBy) {
    return terms.cancelOutcome === 'BURN'
      ? `Визит абонемента «${terms.paidBy.planName}» сгорит.`
      : `Визит абонемента «${terms.paidBy.planName}» вернётся.`;
  }

  const percent = terms.cancelChargePercentNow ?? 0;

  return percent === 0
    ? 'Сейчас отмена бесплатна.'
    : `При отмене сейчас клуб засчитает ${percent}% — ${formatKopecks(Math.round((terms.price * percent) / 100))}.`;
}

/**
 * Отмена записи в два шага (по прогону «первых пользователей» 28.10.2026):
 * первое нажатие спрашивает и называет последствия, отменяет — второе. Раньше
 * запись снималась одним нажатием, без слов о деньгах, хотя справка обещала
 * «перед подтверждением сайт покажет, сколько клуб засчитает», а после записи
 * самой заметной кнопкой в окне была именно «Отменить запись».
 *
 * `terms` известны в «Моём календаре»; в окне мероприятия и строке списка их
 * нет — тогда условия берутся из своих записей (`api.myBookings`) в момент
 * вопроса, чтобы процент был на «сейчас».
 */
export function CancelEntry({
  kind,
  id,
  forPerson,
  terms,
  label = 'Отменить запись',
  size = 'md',
  variant = 'secondary',
  onConfirm,
}: {
  kind: BookingKind;
  /** Идентификатор мероприятия или брони — как в адресе отмены. */
  id: string;
  forPerson: string | null;
  terms?: Terms;
  label?: string;
  size?: 'sm' | 'md';
  variant?: 'secondary' | 'danger' | 'ghost';
  onConfirm: () => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [known, setKnown] = useState<Terms | null | undefined>(terms);
  const [pending, setPending] = useState(false);
  // Второе нажатие «Да, отменить», пока первое в пути, запроса не шлёт.
  const busy = useRef(false);

  function ask(): void {
    setAsking(true);

    if (terms) {
      setKnown(terms);
      return;
    }

    setKnown(undefined);
    api
      .myBookings(forPerson)
      .then((entries) =>
        setKnown(entries.find((entry) => entry.kind === kind && entry.id === id && entry.status === 'BOOKED') ?? null),
      )
      .catch(() => setKnown(null));
  }

  async function confirm(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);

    try {
      await onConfirm();
      setAsking(false);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  if (!asking) {
    return (
      <Button variant={variant} size={size} onClick={ask}>
        {label}
      </Button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Подтверждение отмены"
      className={cn('grid w-full gap-2 rounded-control border border-danger-border bg-danger-soft/40 p-3', size === 'sm' && 'sm:w-auto')}
    >
      <p className="text-[0.875rem] text-text">
        Отменить запись?{' '}
        <span className="text-text-muted">{known === undefined ? 'Считаем условия…' : cancelConsequence(known)}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" size="sm" pending={pending} disabled={known === undefined} onClick={() => void confirm()}>
          Да, отменить
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setAsking(false)}>
          Оставить
        </Button>
      </div>
    </div>
  );
}
