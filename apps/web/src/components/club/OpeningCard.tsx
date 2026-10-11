'use client';

import { useEffect, useState } from 'react';
import type { ClubOpening } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { useClubApi } from '@/lib/useClubApi';

/**
 * Открытие клуба — у руководителя черновика (решения владельца от
 * 11.10.2026). Пока клуб не открыт, его нет в поиске и страницу видят только
 * свои; настройки применяются сразу, а не в полночь. Открыть можно, когда
 * готов хотя бы один зал с адресом и столами, — список «что ещё нужно»
 * считает сервер. С открытия идут 7 пробных дней подписки.
 *
 * Открытому клубу карточка не нужна — её нет вовсе.
 */
export function OpeningCard({ onOpened }: { onOpened?: () => void }) {
  const club = useClubApi();
  const [state, setState] = useState<ClubOpening | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    club
      .opening()
      .then(setState)
      .catch(() => setState(null));
  }, [club]);

  if (!state || state.publishedAt) {
    return null;
  }

  async function open(): Promise<void> {
    setPending(true);
    setError(null);

    try {
      setState(await club.publishClub());
      onOpened?.();
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="mb-6 border-warning-border">
      <CardHeader
        title="Клуб ещё не открыт"
        description="Его нет в поиске, страницу видят только сотрудники клуба. Настройки применяются сразу, а не в полночь. Откройте клуб, когда готов хотя бы один зал — с адресом и столами; с открытия идут 7 пробных дней подписки."
      />
      <CardBody>
        {error && <Alert>{error}</Alert>}

        {state.problems.length > 0 ? (
          <>
            <p className="mb-2 text-[0.875rem] font-medium">Чтобы открыть, осталось:</p>
            <ul className="mb-4 grid gap-1 text-[0.875rem] text-text-muted">
              {state.problems.map((problem) => (
                <li key={problem}>— {problem}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mb-4 text-[0.875rem] text-text-muted">Всё готово — можно открывать.</p>
        )}

        <Button onClick={() => void open()} pending={pending} disabled={state.problems.length > 0}>
          Открыть клуб
        </Button>
      </CardBody>
    </Card>
  );
}
