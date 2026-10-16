'use client';

import { useMemo, useState } from 'react';
import type { ClubPerson, EventKind } from '@yenisey/types';
import { ClientPicker } from '@/components/club/ClientPicker';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ApiError, clubApi } from '@/lib/api';

/**
 * Клуб записывает человека на занятие или турнир — звонок «запишите внука на
 * субботу» (решения владельца от 10.10.2026).
 *
 * Форма, а не окно: она стоит и в окне мероприятия (окно в окне — плохая
 * идея), и в окне на смене. Ищет человека среди людей клуба; новичка сначала
 * привязывают в «Составе клуба» — пароля чужой учётки клуб не знает.
 * Лимит мест, абонемент и запреты сотрудникам — те же, что у самозаписи;
 * на начавшееся запись идёт сразу «пришёл».
 */
export function EnrollClientForm({
  slug,
  kind,
  eventId,
  started,
  onEnrolled,
}: {
  /** Клуб — явно: окно мероприятия открывают и на стартовой, где его нет в адресе. */
  slug: string;
  kind: EventKind;
  eventId: string;
  /** Уже началось: запись станет «пришёл» — предупредить до нажатия. */
  started: boolean;
  onEnrolled: () => void;
}) {
  const club = useMemo(() => clubApi(slug), [slug]);
  const [client, setClient] = useState<ClubPerson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(): Promise<void> {
    if (!client) return;

    setPending(true);
    setError(null);
    setDone(null);

    try {
      await club.enrollClient({ kind, eventId, clientId: client.id });
      setDone(`${client.fullName} — ${started ? 'записан и отмечен «пришёл»' : 'записан'}.`);
      setClient(null);
      onEnrolled();
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Нет связи. Проверьте интернет и попробуйте ещё раз');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3">
      {error && <Alert>{error}</Alert>}
      {done && <p className="text-[0.875rem] text-text-accent">{done}</p>}

      <ClientPicker value={client} onChange={setClient} label="Кого записать" slug={slug} />

      <p className="text-[0.8125rem] text-text-subtle">
        {started
          ? 'Уже началось — запись сразу станет «пришёл». '
          : 'Человек получит сообщение «Вас записал клуб». '}
        Абонемент спишется сам, если подходит. Нет в списке — сначала привяжите человека в «Составе клуба».
      </p>

      <div>
        <Button onClick={() => void submit()} pending={pending} disabled={!client}>
          Записать
        </Button>
      </div>
    </div>
  );
}
