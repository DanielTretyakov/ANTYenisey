'use client';

import { useState, type FormEvent } from 'react';
import type { CoachPrices, UpdateCoachPricesRequest } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field, inputClassName } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { inputToKopecks, kopecksToInput } from '@/lib/money';

/**
 * Цены тренера в ОДНОМ клубе.
 *
 * В карточке их нет намеренно: карточка одна на все клубы, а цена у каждого
 * клуба своя (решение владельца от 20.09.2026). Пустое поле — «не указано», а
 * не ноль: ноль означал бы «бесплатно».
 */
export function CoachPricesForm({
  prices,
  save,
  onChange,
}: {
  prices: CoachPrices;
  save: (payload: UpdateCoachPricesRequest) => Promise<CoachPrices>;
  onChange?: (prices: CoachPrices) => void;
}) {
  // Сохранённое держится рядом с черновиком: «Сохранить» гаснет по совпадению
  // с ним, а зовущий обновлять `prices` не обязан.
  const [stored, setStored] = useState(() => toForm(prices));
  const [draft, setDraft] = useState(stored);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const changed =
    draft.groupPrice !== stored.groupPrice ||
    draft.individualPrice !== stored.individualPrice ||
    draft.priceNote !== stored.priceNote;

  function set(key: keyof FormState, value: string): void {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();

    const groupPrice = money(draft.groupPrice);
    const individualPrice = money(draft.individualPrice);

    if (groupPrice === 'bad' || individualPrice === 'bad') {
      setError('Цена указывается числом, например 600 или 600,50');
      return;
    }

    setPending(true);
    setError(null);
    setSaved(false);

    try {
      const next = await save({ groupPrice, individualPrice, priceNote: draft.priceNote.trim() || null });

      // Форма перезаполняется ответом сервера: «600,5» станет «600,50», и
      // видно, что именно сохранилось.
      setDraft(toForm(next));
      setStored(toForm(next));
      setSaved(true);
      onChange?.(next);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <div className="grid gap-x-5 sm:grid-cols-2">
        <Field label="Групповое занятие" hint="Пусто — цена не показывается." id="coach-group-price">
          <input
            id="coach-group-price"
            className={inputClassName}
            inputMode="decimal"
            placeholder="600"
            value={draft.groupPrice}
            onChange={(event) => set('groupPrice', event.target.value)}
          />
        </Field>
        <Field label="Индивидуальное занятие" hint="В рублях, за одно занятие." id="coach-individual-price">
          <input
            id="coach-individual-price"
            className={inputClassName}
            inputMode="decimal"
            placeholder="1500"
            value={draft.individualPrice}
            onChange={(event) => set('individualPrice', event.target.value)}
          />
        </Field>
      </div>

      <Field label="Примечание" hint="«Первое занятие бесплатно», «абонемент — дешевле»." id="coach-price-note">
        <textarea
          id="coach-price-note"
          className={cn(inputClassName, 'resize-y')}
          rows={2}
          maxLength={300}
          value={draft.priceNote}
          onChange={(event) => set('priceNote', event.target.value)}
        />
      </Field>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" pending={pending} disabled={!changed}>
          Сохранить цены
        </Button>
        {saved && !changed && <span className="text-[0.8125rem] text-text-muted">Сохранено.</span>}
      </div>
    </form>
  );
}

interface FormState {
  groupPrice: string;
  individualPrice: string;
  priceNote: string;
}

function toForm(prices: CoachPrices): FormState {
  return {
    groupPrice: prices.groupPrice === null ? '' : kopecksToInput(prices.groupPrice),
    individualPrice: prices.individualPrice === null ? '' : kopecksToInput(prices.individualPrice),
    priceNote: prices.priceNote ?? '',
  };
}

/** Пусто — «не указано»; не число — отказ, а не молчаливый ноль. */
function money(value: string): number | null | 'bad' {
  if (value.trim() === '') {
    return null;
  }

  return inputToKopecks(value) ?? 'bad';
}
