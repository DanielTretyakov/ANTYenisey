import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, BookingStatus, ClosurePurpose, type Prisma } from '@yenisey/database';
import type { EventCancelRequest, EventCancelResult, EventKind } from '@yenisey/types';
import { ClientNotifier } from '../notifications/client-notifier.service';
import { StaffNotifier } from '../notifications/staff-notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { cancelProblem } from './cancel-rules';
import { cancelEntryByClubInTx, type ClubCancelledEntry } from './club-cancel';

/**
 * Клуб отменяет занятие или турнир (решения владельца от 10.10.2026): тренер
 * заболел, зал закрыт.
 *
 * Одна транзакция — отменено целиком или никак:
 * - строка проведения под `FOR UPDATE` — тот же первый замок, что берёт запись
 *   на занятие (и `FOR SHARE` — запись на турнир): запись, начатая в ту же
 *   секунду, дождётся и увидит отмену. Порядок «проведение → запись →
 *   абонемент» тот же, что у всех путей;
 * - действующие записи — `cancelEntryByClubInTx`: процент 0, визит вернулся,
 *   аудит, сообщение с причиной. Отмеченные («пришёл», «не пришёл») не
 *   трогаются: отменить можно и посреди занятия;
 * - тренеру — одно сообщение вместо «отмена в группе» по каждому;
 * - окна сетки — убрать (столы свободны под аренду) или оставить «Стол занят»:
 *   решает отменяющий. Без окон отменённое не подцепится к новым окнам той же
 *   пары в расписании, а `dropOrphanedEvents` его не снесёт — у него записи;
 * - строка аудита `EVENT_CANCELLED`.
 *
 * Строка проведения не удаляется: за записями на неё стоит история денег.
 */
@Injectable()
export class EventCancellationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly clients: ClientNotifier,
    private readonly staff: StaffNotifier,
  ) {}

  async cancel(
    tenantId: string,
    actorUserId: string,
    kind: EventKind,
    id: string,
    request: EventCancelRequest,
  ): Promise<EventCancelResult> {
    const reason = request.reason.trim();

    return this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, tenantId, kind, id);

      if (!event) {
        throw new NotFoundException(kind === 'TRAINING' ? 'Занятие не найдено' : 'Турнир не найден');
      }

      const now = new Date();
      const problem = cancelProblem(event, now, request.reason);

      if (problem) {
        throw problem.status === 409 ? new ConflictException(problem.message) : new BadRequestException(problem.message);
      }

      const data = { cancelledAt: now, cancelReason: reason };
      const where = { id, tenantId, cancelledAt: null };
      const updated =
        kind === 'TRAINING'
          ? await tx.trainingSession.updateMany({ where, data })
          : await tx.tournament.updateMany({ where, data });

      if (updated.count === 0) {
        throw new ConflictException('Уже отменено');
      }

      const entries: ClubCancelledEntry[] =
        kind === 'TRAINING'
          ? (
              await tx.trainingBooking.findMany({
                where: { tenantId, sessionId: id, status: BookingStatus.BOOKED },
                select: { id: true, subscriptionId: true },
                orderBy: { id: 'asc' },
              })
            ).map((row) => ({ ...row, kind: 'TRAINING' as const }))
          : (
              await tx.tournamentRegistration.findMany({
                where: { tenantId, tournamentId: id, status: BookingStatus.BOOKED },
                select: { id: true, subscriptionId: true },
                orderBy: { id: 'asc' },
              })
            ).map((row) => ({ ...row, kind: 'TOURNAMENT' as const }));

      let cancelledEntries = 0;

      for (const entry of entries) {
        const done = await cancelEntryByClubInTx(tx, { subscriptions: this.subscriptions, clients: this.clients }, tenantId, entry, {
          now,
          reason: `Клуб отменил ${kind === 'TRAINING' ? 'занятие' : 'турнир'}: ${reason}`,
          actorUserId,
          notice: { eventCancelled: reason },
        });

        if (done) cancelledEntries += 1;
      }

      // До снятия окон: пояс сообщения тренеру — у зала занятия.
      if (kind === 'TRAINING') {
        await this.staff.sessionCancelled(tx, tenantId, id, actorUserId, cancelledEntries, now);
      }

      const windows = await releaseWindows(tx, tenantId, kind, id, request.freeTables);

      await tx.auditLog.create({
        data: {
          tenantId,
          action: AuditAction.EVENT_CANCELLED,
          actorUserId,
          entityType: kind === 'TRAINING' ? 'TrainingSession' : 'Tournament',
          entityId: id,
          before: { cancelledAt: null },
          after: { cancelledAt: now.toISOString(), cancelledEntries, windows, freeTables: request.freeTables },
          reason,
        },
      });

      return { cancelledAt: now.toISOString(), cancelReason: reason, cancelledEntries };
    });
  }
}

/** Строка проведения под замком — с тем, что нужно правилу отмены. */
async function lockEvent(
  tx: Prisma.TransactionClient,
  tenantId: string,
  kind: EventKind,
  id: string,
): Promise<{ endsAt: Date; cancelledAt: Date | null } | undefined> {
  const rows =
    kind === 'TRAINING'
      ? await tx.$queryRaw<{ endsAt: Date; cancelledAt: Date | null }[]>`
          SELECT "endsAt", "cancelledAt" FROM "TrainingSession"
          WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE
        `
      : await tx.$queryRaw<{ endsAt: Date; cancelledAt: Date | null }[]>`
          SELECT "endsAt", "cancelledAt" FROM "Tournament"
          WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE
        `;

  return rows[0];
}

/**
 * Окна проведения во всех залах: убрать или превратить в «Стол занят»
 * (`OTHER` без ссылок — единственная форма закрытия без проведения, которую
 * пускает `DayClosure_attachments_match_purpose`). Возвращает число окон.
 */
async function releaseWindows(
  tx: Prisma.TransactionClient,
  tenantId: string,
  kind: EventKind,
  id: string,
  freeTables: boolean,
): Promise<number> {
  const where = kind === 'TRAINING' ? { tenantId, trainingSessionId: id } : { tenantId, tournamentId: id };

  if (freeTables) {
    return (await tx.dayClosure.deleteMany({ where })).count;
  }

  return (
    await tx.dayClosure.updateMany({
      where,
      data: { purpose: ClosurePurpose.OTHER, coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null },
    })
  ).count;
}
