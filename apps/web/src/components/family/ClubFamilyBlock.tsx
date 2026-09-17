'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { ClubPerson, ClubPersonFamily, FamilyMember } from '@yenisey/types';
import { ClientPicker } from '@/components/club/ClientPicker';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { CreateChildForm } from './FamilyCards';

function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером';
}

/**
 * Семья в карточке человека — для администратора.
 *
 * Расширение сверх ТЗ по решениям владельца от 12.09 и 17.09.2026. У стойки
 * администратор заводит ребёнка родителю, который не хочет разбираться с
 * сайтом, предлагает закрепить ребёнка за родителем (подтверждает всё равно
 * ребёнок) и снимает закрепление с причиной — когда родитель потерял учётку.
 *
 * Человеку 16–17 лет без детей блок не показывается: ни ребёнком, ни
 * родителем он быть не может.
 */
export function ClubFamilyBlock({
  personId,
  personPhone,
  family,
  onChanged,
}: {
  personId: string;
  personPhone: string;
  family: ClubPersonFamily;
  /** Семья поменялась — перечитать карточку. */
  onChanged: () => void;
}) {
  const club = useClubApi();
  const [mode, setMode] = useState<'child' | 'guardian' | 'revoke' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!family.isChild && !family.canBeGuardian && family.children.length === 0) {
    return null;
  }

  function finish(message: string | null): void {
    setMode(null);
    setError(null);
    setNotice(message);
    onChanged();
  }

  return (
    <Card>
      <CardHeader
        title="Семья"
        description="Пока ребёнку нет 16, записывает и отменяет за него родитель. Закрепить чужую учётку подтверждает сам ребёнок — у себя в кабинете."
      />
      <CardBody className="grid gap-5">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="info">{notice}</Alert>}

        {family.isChild && (
          <section>
            <h3 className="mb-2 text-[0.9375rem] font-medium">Родитель</h3>

            {family.guardian ? (
              <Member member={family.guardian} />
            ) : (
              <p className="text-[0.875rem] text-text-muted">
                Не закреплён. Записать этого человека до 16 лет может только администратор у стойки.
              </p>
            )}

            {mode === null && (
              <div className="mt-3 flex flex-wrap gap-2">
                {family.guardian ? (
                  <Button size="sm" variant="ghost" onClick={() => setMode('revoke')}>
                    Снять закрепление…
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setMode('guardian')}>
                    Предложить родителя…
                  </Button>
                )}
              </div>
            )}

            {mode === 'guardian' && (
              <GuardianForm
                onSubmit={(guardian) => club.requestGuardian(personId, guardian.id)}
                onDone={() => finish('Заявка отправлена. Ребёнок подтвердит её у себя в кабинете.')}
                onError={setError}
                onCancel={() => setMode(null)}
              />
            )}

            {mode === 'revoke' && (
              <RevokeForm
                onSubmit={(reason) => club.revokeGuardian(personId, reason)}
                onDone={() => finish('Закрепление снято.')}
                onError={setError}
                onCancel={() => setMode(null)}
              />
            )}
          </section>
        )}

        {(family.canBeGuardian || family.children.length > 0) && (
          <section>
            <h3 className="mb-2 text-[0.9375rem] font-medium">Дети</h3>

            {family.children.length === 0 ? (
              <p className="text-[0.875rem] text-text-muted">Детей не ведёт.</p>
            ) : (
              <ul className="grid gap-2">
                {family.children.map((child) => (
                  <li key={child.id}>
                    <Member member={child} />
                  </li>
                ))}
              </ul>
            )}

            {family.canBeGuardian && mode === null && (
              <div className="mt-3">
                <Button size="sm" variant="secondary" onClick={() => setMode('child')}>
                  Завести ребёнка…
                </Button>
              </div>
            )}

            {mode === 'child' && (
              <div className="mt-3">
                <CreateChildForm
                  title="Учётка ребёнка — почту и пароль задаёт родитель"
                  parentPhone={personPhone}
                  submit={(payload) => club.createChildFor(personId, payload)}
                  onDone={(child) => finish(`Учётка заведена: ${child.fullName}. Ребёнок сразу в клубе и закреплён.`)}
                  onCancel={() => setMode(null)}
                />
              </div>
            )}
          </section>
        )}
      </CardBody>
    </Card>
  );
}

function Member({ member }: { member: FamilyMember }) {
  const slug = useClubSlug();

  return (
    <p className="text-[0.9375rem]">
      {member.memberOfClub ? (
        <Link href={`/clubs/${slug}/people/${member.id}`} className="text-text-accent underline-offset-2 hover:underline">
          {member.name}
        </Link>
      ) : (
        <span>{member.name}</span>
      )}
      <span className="ml-2 text-[0.8125rem] text-text-muted">
        {member.memberOfClub ? '' : 'не в этом клубе · '}
        {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeZone: 'UTC' }).format(
          new Date(`${member.birthDate}T00:00:00Z`),
        )}
      </span>
    </p>
  );
}

function GuardianForm({
  onSubmit,
  onDone,
  onError,
  onCancel,
}: {
  onSubmit: (guardian: ClubPerson) => Promise<void>;
  onDone: () => void;
  onError: (message: string) => void;
  onCancel: () => void;
}) {
  const [guardian, setGuardian] = useState<ClubPerson | null>(null);
  const [pending, setPending] = useState(false);

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!guardian) return;
    setPending(true);

    try {
      await onSubmit(guardian);
      onDone();
    } catch (cause) {
      onError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void send(event)} className="mt-3 rounded-control border border-border bg-surface-sunken px-4 pt-4 pb-3">
      <ClientPicker label="Родитель из клиентов клуба" value={guardian} onChange={setGuardian} />
      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" pending={pending} disabled={!guardian}>
          Отправить заявку
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

function RevokeForm({
  onSubmit,
  onDone,
  onError,
  onCancel,
}: {
  onSubmit: (reason: string) => Promise<void>;
  onDone: () => void;
  onError: (message: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);

    try {
      await onSubmit(reason.trim());
      onDone();
    } catch (cause) {
      onError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void send(event)} className="mt-3 rounded-control border border-border bg-surface-sunken px-4 pt-4 pb-3">
      <Field
        label="Почему закрепление снимает клуб, а не родитель"
        value={reason}
        required
        maxLength={500}
        autoFocus
        onChange={(event) => setReason(event.target.value)}
        hint="Попадёт в журнал аудита клуба."
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="danger" pending={pending} disabled={reason.trim() === ''}>
          Снять закрепление
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
