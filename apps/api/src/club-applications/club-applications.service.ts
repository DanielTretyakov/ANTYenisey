import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformRole, Prisma } from '@yenisey/database';
import type { ClubApplicationStatus, ClubApplicationView } from '@yenisey/types';
import type { Env } from '../config/env';
import { zoneClock } from '../notifications/clock';
import { sendAfterFor } from '../notifications/notification-rules';
import { NotificationsService } from '../notifications/notifications.service';
import type { ClubApplicationPayload } from '../notifications/render';
import { PrismaService } from '../prisma/prisma.service';
import { blankToNull, contactsProblem, isBotSubmission } from './application-rules';
import type { ClubApplicationDto, ClubApplicationUpdateDto } from './club-applications.dto';

const VIEW_SELECT = {
  id: true,
  createdAt: true,
  contactName: true,
  clubName: true,
  city: { select: { name: true, region: true } },
  phone: true,
  email: true,
  halls: true,
  tables: true,
  comment: true,
  status: true,
  note: true,
} satisfies Prisma.ClubApplicationSelect;

type Row = Prisma.ClubApplicationGetPayload<{ select: typeof VIEW_SELECT }>;

/**
 * Заявки клубов на подключение (решение владельца от 03.10.2026): форма
 * «Подключить свой клуб» без входа и список у владельца платформы.
 */
@Injectable()
export class ClubApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Принять заявку и сообщить владельцам платформы — одной транзакцией:
   * откатилась заявка — нет и сообщения.
   *
   * Бот (заполнена ловушка) получает тот же ответ, что человек, но заявка не
   * сохраняется: отличить «отклонено» по ответу он не должен, иначе научится
   * обходить ловушку.
   */
  async submit(dto: ClubApplicationDto): Promise<void> {
    if (isBotSubmission(dto.website)) return;

    const problem = contactsProblem(dto);

    if (problem) throw new BadRequestException(problem);

    const cityId = blankToNull(dto.cityId);
    const city = cityId ? await this.prisma.city.findUnique({ where: { id: cityId }, select: { name: true } }) : null;

    if (cityId && !city) throw new BadRequestException('cityId: такого города нет в справочнике');

    const now = new Date();
    // Ночью владельца не будим: заявка подождёт восьми утра по поясу платформы.
    const sendAfter = sendAfterFor(now, zoneClock(this.config.get('PLATFORM_TIMEZONE', { infer: true })), false);

    await this.prisma.$transaction(async (tx) => {
      const created = await tx.clubApplication.create({
        data: {
          contactName: dto.contactName,
          clubName: dto.clubName,
          cityId,
          phone: blankToNull(dto.phone),
          email: blankToNull(dto.email),
          halls: dto.halls ?? null,
          tables: dto.tables ?? null,
          comment: blankToNull(dto.comment),
        },
        select: { id: true },
      });

      const owners = await tx.user.findMany({
        where: { platformRole: PlatformRole.OWNER, deactivatedAt: null },
        select: { id: true },
      });
      const payload: ClubApplicationPayload = {
        clubName: dto.clubName,
        city: city?.name ?? null,
        halls: dto.halls ?? null,
        tables: dto.tables ?? null,
      };

      await this.notifications.enqueue(
        tx,
        owners.map((owner) => ({
          userId: owner.id,
          type: 'CLUB_APPLICATION' as const,
          payload: payload as unknown as Prisma.InputJsonValue,
          dedupeKey: `club-application:${created.id}`,
          sendAfter,
        })),
      );
    });
  }

  async list(userId: string): Promise<ClubApplicationView[]> {
    await this.assertOwner(userId);

    const rows = await this.prisma.clubApplication.findMany({
      select: VIEW_SELECT,
      // Новые — сверху, внутри статуса — свежие первыми.
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });

    return rows.map(toView).sort((a, b) => statusOrder(a.status) - statusOrder(b.status));
  }

  async update(userId: string, id: string, dto: ClubApplicationUpdateDto): Promise<ClubApplicationView> {
    await this.assertOwner(userId);

    try {
      const row = await this.prisma.clubApplication.update({
        where: { id },
        data: { status: dto.status, note: blankToNull(dto.note) },
        select: VIEW_SELECT,
      });

      return toView(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Заявка не найдена');
      }

      throw error;
    }
  }

  /** Как у «Клубов и подписок»: роли клубные, а у заявки клуба ещё нет. */
  private async assertOwner(userId: string): Promise<void> {
    const found = await this.prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true, deactivatedAt: true } });

    if (found?.platformRole !== PlatformRole.OWNER || found.deactivatedAt) {
      throw new ForbiddenException('Заявки клубов ведёт только владелец платформы');
    }
  }
}

const ORDER: Record<ClubApplicationStatus, number> = { NEW: 0, IN_PROGRESS: 1, CONNECTED: 2, DECLINED: 3 };

function statusOrder(status: ClubApplicationStatus): number {
  return ORDER[status];
}

function toView(row: Row): ClubApplicationView {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    contactName: row.contactName,
    clubName: row.clubName,
    city: row.city ? [row.city.name, row.city.region].filter(Boolean).join(', ') : null,
    phone: row.phone,
    email: row.email,
    halls: row.halls,
    tables: row.tables,
    comment: row.comment,
    status: row.status,
    note: row.note,
  };
}
