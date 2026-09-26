'use client';

import { useState } from 'react';
import type { SettingsChange } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { useClubApi } from '@/lib/useClubApi';

/**
 * Запланированные изменения настроек (решение владельца от 26.09.2026).
 *
 * Правки клуба, залов и столов вступают в силу в ближайшие 00:00 по времени
 * зала, и до тех пор их видно здесь — с автором и кнопкой отмены. Ниже —
 * история последней недели: что вступило, что отменили и что не применилось
 * (у стола появилась бронь) — с причиной.
 */
export function PendingChanges({
  changes,
  onChange,
}: {
  changes: SettingsChange[];
  onChange: (changes: SettingsChange[]) => void;
}) {
  const club = useClubApi();
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const pending = changes.filter((change) => change.status === 'PENDING');
  const history = changes.filter((change) => change.status !== 'PENDING');

  if (changes.length === 0) {
    return null;
  }

  async function cancel(id: string): Promise<void> {
    setCancelling(id);
    setError(null);

    try {
      onChange(await club.cancelSettingsChange(id));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setCancelling(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Запланированные изменения"
        description="Настройки клуба, залов и столов вступают в силу в ближайшие 00:00 по времени зала — не посреди рабочего дня. Сотрудники клуба получают сообщение о каждой правке."
      />
      <CardBody>
        {error && <Alert>{error}</Alert>}

        {pending.length === 0 ? (
          <p className="text-[0.9375rem] text-text-muted">Ничего не ждёт полуночи.</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {pending.map((change) => (
              <ChangeRow key={change.id} change={change}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  pending={cancelling === change.id}
                  onClick={() => void cancel(change.id)}
                >
                  Отменить
                </Button>
              </ChangeRow>
            ))}
          </ul>
        )}

        {history.length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              className="text-[0.875rem] text-text-accent underline underline-offset-2"
              aria-expanded={showHistory}
              onClick={() => setShowHistory((value) => !value)}
            >
              {showHistory ? 'Скрыть историю' : `История за неделю (${history.length})`}
            </button>

            {showHistory && (
              <ul className="mt-3 divide-y divide-border border-y border-border">
                {history.map((change) => (
                  <ChangeRow key={change.id} change={change} />
                ))}
              </ul>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ChangeRow({ change, children }: { change: SettingsChange; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <ul className="space-y-0.5 text-[0.9375rem]">
          {change.summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-1 text-[0.8125rem] text-text-subtle">
          {change.authorName} · {statusText(change)}
        </p>
        {change.failure && <p className="mt-1 text-[0.8125rem] text-danger">Не применилось: {change.failure}</p>}
      </div>
      {children}
    </li>
  );
}

function statusText(change: SettingsChange): string {
  switch (change.status) {
    case 'PENDING':
      return `вступит в силу ${change.effectiveLabel}`;
    case 'APPLIED':
      return `в силе с ${change.effectiveLabel}`;
    case 'CANCELLED':
      return `отменено${change.cancelledByName ? `: ${change.cancelledByName}` : ''}`;
    case 'FAILED':
      return 'не применилось';
  }
}
