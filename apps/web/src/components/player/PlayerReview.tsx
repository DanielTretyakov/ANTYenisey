'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { PlayerProfile, PlayerRank } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { longDate } from '@/lib/player';
import { useClubApi } from '@/lib/useClubApi';
import { DocumentButton } from './DocumentButton';
import { AchievementList, EquipmentList, PlayerAvatar, RankLine } from './PlayerView';

/**
 * Профиль игрока в карточке человека — для администратора.
 *
 * Профиль здесь только читается: заполняет его сам человек. Администратор
 * решает одно — подтвердить разряд или отклонить, и его решение увидят все
 * клубы игрока с подписью этого клуба.
 */
export function PlayerReview({
  player,
  personId,
  personName,
  self,
  onChange,
  onStale,
}: {
  player: PlayerProfile;
  personId: string;
  personName: string;
  /** Карточка самого администратора: свой разряд он не подтверждает. */
  self: boolean;
  onChange: (player: PlayerProfile) => void;
  /** Разряд изменился, пока карточка была открыта, — её надо перечитать. */
  onStale: () => void;
}) {
  const empty =
    !player.rank &&
    !player.avatarFileId &&
    player.achievements.length === 0 &&
    !player.equipment.blade &&
    !player.equipment.forehandRubber &&
    !player.equipment.backhandRubber;

  return (
    <Card>
      <CardHeader
        title="Профиль игрока"
        description="Заполняет сам человек. Клуб проверяет разряд — решение видно во всех клубах игрока."
      />
      <CardBody className="grid gap-7">
        <div className="flex flex-wrap items-center gap-4">
          <PlayerAvatar fileId={player.avatarFileId} name={personName} size="md" />
          <div className="text-[0.875rem]">
            <Link href={`/players/${personId}`} className="text-text-accent underline-offset-2 hover:underline">
              Страница игрока →
            </Link>
            {!player.isPublic && (
              <p className="mt-1 text-text-muted">Младше 16 лет — посторонним страница не видна.</p>
            )}
          </div>
        </div>

        {empty && <p className="text-[0.875rem] text-text-muted">Профиль пока не заполнен.</p>}

        {player.rank && (
          <section>
            <h3 className="mb-2.5 text-[0.9375rem] font-medium">Спортивный разряд</h3>
            <RankBlock
              rank={player.rank}
              personId={personId}
              self={self}
              onChange={onChange}
              onStale={onStale}
            />
          </section>
        )}

        {!empty && (
          <>
            <section>
              <h3 className="mb-2.5 text-[0.9375rem] font-medium">Инвентарь</h3>
              <EquipmentList equipment={player.equipment} />
            </section>

            <section>
              <h3 className="mb-2.5 text-[0.9375rem] font-medium">Достижения</h3>
              <AchievementList achievements={player.achievements} />
            </section>
          </>
        )}
      </CardBody>
    </Card>
  );
}

type Decision = 'VERIFIED' | 'REJECTED';

/**
 * Разряд и решение по нему.
 *
 * Причина обязательна у отказа и у пересмотра уже принятого решения — сервер
 * требует того же. Форма спрашивает её заранее, а не после ответа 400.
 */
function RankBlock({
  rank,
  personId,
  self,
  onChange,
  onStale,
}: {
  rank: PlayerRank;
  personId: string;
  self: boolean;
  onChange: (player: PlayerProfile) => void;
  onStale: () => void;
}) {
  const club = useClubApi();
  const [asking, setAsking] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  const overturn = rank.status !== 'PENDING';

  async function decide(decision: Decision): Promise<void> {
    setPending(decision);
    setError(null);

    try {
      onChange(
        await club.reviewRank(personId, {
          decision,
          version: rank.version,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      );
      setAsking(null);
      setReason('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');

      if (cause instanceof ApiError && cause.status === 409) {
        onStale();
      }
    } finally {
      setPending(null);
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (asking) void decide(asking);
  }

  // Подтверждение ожидающего разряда причины не требует — одним нажатием.
  const needsReason = (decision: Decision) => decision === 'REJECTED' || overturn;

  return (
    <div className="rounded-control border border-border bg-surface-sunken px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <RankLine rank={rank} />
        {rank.document && <DocumentButton fileId={rank.document.id} label="Открыть скан приказа" />}
      </div>

      <p className="mt-2 text-[0.8125rem] text-text-muted">
        {rank.orderNumber && rank.orderDate
          ? `Приказ № ${rank.orderNumber} от ${longDate(rank.orderDate)}`
          : 'Реквизиты приказа не указаны — только скан.'}
        {rank.reviewedBy?.by ? ` · решение принял ${rank.reviewedBy.by}` : ''}
      </p>

      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}

      {self ? (
        <p className="mt-3 text-[0.8125rem] text-text-subtle">
          Свой разряд подтверждает администратор другого клуба или коллега.
        </p>
      ) : asking ? (
        <form onSubmit={submit} className="mt-3.5">
          <Field
            label={asking === 'REJECTED' ? 'Причина отказа — человек увидит её у себя' : 'Почему решение пересматривается'}
            value={reason}
            required
            maxLength={500}
            autoFocus
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              variant={asking === 'REJECTED' ? 'danger' : 'primary'}
              pending={pending === asking}
              disabled={reason.trim() === ''}
            >
              {asking === 'REJECTED' ? 'Отклонить разряд' : 'Подтвердить разряд'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setAsking(null);
                setReason('');
              }}
            >
              Отмена
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {rank.status !== 'VERIFIED' && (
            <Button
              size="sm"
              pending={pending === 'VERIFIED'}
              onClick={() => (needsReason('VERIFIED') ? setAsking('VERIFIED') : void decide('VERIFIED'))}
            >
              {overturn ? 'Подтвердить…' : 'Подтвердить'}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setAsking('REJECTED')}>
            {rank.status === 'REJECTED' ? 'Изменить причину отказа…' : 'Отклонить…'}
          </Button>
        </div>
      )}
    </div>
  );
}
