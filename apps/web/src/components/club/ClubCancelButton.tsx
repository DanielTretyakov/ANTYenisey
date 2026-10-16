'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';

/**
 * Отмена записи клубом — в два шага: по политике клуба или без списания.
 *
 * Два шага, а не один: отмена списывает с человека деньги по политике клуба,
 * и случайное нажатие в ленте из двадцати строк обошлось бы дороже лишнего
 * вопроса. Второй вариант прощает списание — «тренер перенёс группу» в
 * политику отмены не заложено. Одна кнопка на бронь стола и на запись на
 * занятие или турнир: второй вид разошёлся бы с первым в деньгах.
 */
export function ClubCancelButton({ cancel, onDone }: { cancel: (waiveCharge: boolean) => Promise<unknown>; onDone: () => void }) {
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(waiveCharge: boolean): Promise<void> {
    setPending(true);
    setError(null);

    try {
      await cancel(waiveCharge);
      setAsking(false);
      onDone();
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Нет связи. Проверьте интернет и попробуйте ещё раз');
    } finally {
      setPending(false);
    }
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="text-[0.8125rem] text-text-subtle underline underline-offset-2 hover:text-danger"
      >
        Отменить
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
      {error ? <span className="text-danger">{error}</span> : <span className="text-text-muted">Списать по политике клуба?</span>}
      <Button size="sm" variant="danger" pending={pending} onClick={() => void run(false)}>
        Да, отменить
      </Button>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => void run(true)}>
        Без списания
      </Button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        className="text-text-subtle underline underline-offset-2 hover:text-text"
      >
        не надо
      </button>
    </span>
  );
}
