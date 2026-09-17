import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, AuditAction, GuardianshipStatus, Prisma, Role } from '@yenisey/database';
import type {
  FamilyChild,
  FamilyNotice,
  GuardianshipRequestView,
  MyGuardian,
} from '@yenisey/types';
import { birthdayOfAge, CHILD_UNTIL_AGE, shortName } from '@yenisey/types';
import { formatBirthDate, parseBirthDate } from '../auth/birth-date';
import { joinFullName } from '../auth/full-name';
import { hashPassword } from '../auth/password';
import type { AccountDto } from '../auth/dto/register.dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  decideAnswer,
  decideCreateChild,
  decideRequest,
  decideRevoke,
  guardianHasRights,
  isChild,
  REQUEST_TTL_DAYS,
  type Decision,
} from './guardianship-rules';

/**
 * Одинаковый ответ на заявку по почте — при любом исходе.
 *
 * Иначе по ответам можно было бы перебрать почты и узнать, какие принадлежат
 * детям младше 16. Исходящие заявки родителю по той же причине не
 * показываются: их отсутствие рассказало бы то же самое.
 */
const REQUEST_NOTICE: FamilyNotice = {
  message:
    'Если у этой почты есть учётка и её владельцу нет 16, он увидит заявку у себя в кабинете. ' +
    'Как только он подтвердит, ребёнок появится в вашем списке.',
};

const EMAIL_TAKEN =
  'Эта почта уже занята. Если у семьи один ящик, заведите ребёнку адрес с плюсом — например, ivanov+kolya@mail.ru: ' +
  'письма придут в тот же ящик, а учётка будет отдельной.';

/** Где завели учётку ребёнка: в кабинете родителя или у стойки клуба. */
export interface DeskContext {
  tenantId: string;
  actorUserId: string;
  ipAddress: string | null;
}

function refuse(decision: Extract<Decision, { ok: false }>): never {
  throw new HttpException(decision.message, decision.status);
}

/**
 * Семья: родитель ведёт ребёнка младше 16.
 *
 * Расширение сверх ТЗ по решениям владельца от 12.09 и 17.09.2026. Правила —
 * `guardianship-rules.ts`; здесь только то, что они требуют от базы, и
 * транзакции, без которых половина действия осталась бы висеть.
 */
@Injectable()
export class FamilyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Дети, которых человек ведёт прямо сейчас. Шестнадцатилетние из списка уходят сами. */
  async children(guardianId: string): Promise<FamilyChild[]> {
    const today = new Date();
    const rows = await this.prisma.guardianship.findMany({
      where: {
        guardianUserId: guardianId,
        status: GuardianshipStatus.ACTIVE,
        child: { deactivatedAt: null, anonymizedAt: null },
      },
      select: {
        status: true,
        child: { select: { id: true, fullName: true, email: true, birthDate: true } },
      },
      orderBy: { child: { birthDate: 'desc' } },
    });

    return rows
      .filter((row) => guardianHasRights(row.status, row.child.birthDate, today))
      .map((row) => toChild(row.child));
  }

  /**
   * Завести ребёнку учётку и сразу закрепить за родителем.
   *
   * Подтверждать нечего: учётка создана этим же действием, и пароль от неё
   * родитель и задал. Учётка и опека — одной транзакцией: учётка ребёнка без
   * родителя — человек младше 16, который не может ни записаться сам, ни быть
   * записанным.
   *
   * У стойки (`desk`) действие совершает администратор от имени родителя,
   * который стоит рядом: ребёнок сразу привязывается к клубу, а в журнал
   * аудита клуба ложится строка — учётку чужого ребёнка завёл сотрудник.
   */
  async createChild(guardianId: string, dto: AccountDto, desk?: DeskContext): Promise<FamilyChild> {
    const today = new Date();
    const guardian = await this.prisma.user.findFirst({
      where: { id: guardianId, deactivatedAt: null, anonymizedAt: null },
      select: { birthDate: true },
    });

    if (!guardian) {
      throw new NotFoundException('Родитель не найден');
    }

    const childBirthDate = parseBirthDate(dto.birthDate, today);

    if (!childBirthDate) {
      throw new BadRequestException('Проверьте дату рождения: она не может быть в будущем или раньше 1900 года');
    }

    const decision = decideCreateChild({ guardianBirthDate: guardian.birthDate, childBirthDate, today });

    if (!decision.ok) {
      refuse(decision);
    }

    const passwordHash = await hashPassword(dto.password);

    try {
      const child = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: dto.email,
            phone: dto.phone,
            passwordHash,
            fullName: joinFullName(dto),
            birthDate: childBirthDate,
          },
          select: { id: true, fullName: true, email: true, birthDate: true },
        });

        const guardianship = await tx.guardianship.create({
          data: {
            childUserId: created.id,
            guardianUserId: guardianId,
            status: GuardianshipStatus.ACTIVE,
            createdByUserId: desk?.actorUserId ?? guardianId,
            createdInTenantId: desk?.tenantId ?? null,
            confirmedAt: today,
          },
          select: { id: true },
        });

        if (desk) {
          // Ребёнка заводят у стойки, чтобы он ходил в этот клуб: привязка и
          // анкета клиента — сразу, тем же рецептом, что MembershipService.
          await tx.tenantMembership.create({
            data: { userId: created.id, tenantId: desk.tenantId, role: Role.CLIENT },
          });
          await tx.clientProfile.create({ data: { userId: created.id, tenantId: desk.tenantId } });

          await tx.auditLog.create({
            data: {
              tenantId: desk.tenantId,
              action: AuditAction.CHILD_ACCOUNT_CREATED,
              actorType: ActorType.USER,
              actorUserId: desk.actorUserId,
              entityType: 'Guardianship',
              entityId: guardianship.id,
              after: { childUserId: created.id, guardianUserId: guardianId },
              ipAddress: desk.ipAddress,
            },
          });
        }

        return created;
      });

      return toChild(child);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(EMAIL_TAKEN);
      }
      throw error;
    }
  }

  /**
   * Заявка на закрепление уже существующей учётки.
   *
   * Ответ один при любом исходе — см. REQUEST_NOTICE. Подтвердить её может
   * только сам ребёнок: знать его почту — не право им распоряжаться.
   */
  async requestAttach(
    guardianId: string,
    email: string,
    desk?: DeskContext,
  ): Promise<FamilyNotice> {
    const today = new Date();
    const requester = await this.prisma.user.findUniqueOrThrow({
      where: { id: guardianId },
      select: { birthDate: true },
    });

    const target = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, deactivatedAt: null, anonymizedAt: null },
      select: {
        id: true,
        birthDate: true,
        guardianshipsAsChild: {
          where: {
            OR: [
              { status: GuardianshipStatus.ACTIVE },
              { status: GuardianshipStatus.PENDING, guardianUserId: guardianId },
            ],
          },
          select: { status: true },
        },
      },
    });

    const decision = decideRequest({
      requesterId: guardianId,
      requesterBirthDate: requester.birthDate,
      target: target && {
        userId: target.id,
        birthDate: target.birthDate,
        hasActiveGuardian: target.guardianshipsAsChild.some((row) => row.status === GuardianshipStatus.ACTIVE),
        hasPendingFromRequester: target.guardianshipsAsChild.some((row) => row.status === GuardianshipStatus.PENDING),
      },
      today,
    });

    if (!decision.ok) {
      refuse(decision);
    }

    if (decision.create && target) {
      await this.prisma.guardianship
        .create({
          data: {
            childUserId: target.id,
            guardianUserId: guardianId,
            status: GuardianshipStatus.PENDING,
            createdByUserId: desk?.actorUserId ?? guardianId,
            createdInTenantId: desk?.tenantId ?? null,
          },
        })
        .catch((error: unknown) => {
          // Двойное нажатие: вторая заявка упёрлась в частичный уникальный
          // индекс. Это то же намерение — и тот же ответ.
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
            throw error;
          }
        });
    }

    return REQUEST_NOTICE;
  }

  /**
   * Родитель меняет пароль ребёнку — например, если тот его забыл:
   * восстановления пароля в продукте нет.
   *
   * Все сессии ребёнка гаснут тем же приёмом, что при краже refresh-токена:
   * новый пароль ничего не значит, пока старые сессии живы. Access-токен
   * доживает свои 15 минут — отдельного отзыва у него нет.
   */
  async setChildPassword(guardianId: string, childId: string, password: string): Promise<void> {
    await this.requireRights(guardianId, childId);
    const passwordHash = await hashPassword(password);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: childId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: childId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /** Родитель отвязывает ребёнка. Строка остаётся — как история. */
  async unlink(guardianId: string, childId: string): Promise<void> {
    const row = await this.prisma.guardianship.findFirst({
      where: { guardianUserId: guardianId, childUserId: childId, status: GuardianshipStatus.ACTIVE },
      select: { id: true, status: true },
    });

    if (!row) {
      throw new NotFoundException('Ребёнок не найден среди ваших');
    }

    await this.revokeRow(row, { kind: 'guardian' }, { byUserId: guardianId, reason: null });
  }

  /**
   * Снять закрепление от имени клуба — с причиной и строкой аудита.
   *
   * Что ребёнок в этом клубе состоит, а снимающий там администратор,
   * проверяет вызывающий маршрут.
   */
  async revokeByClub(childId: string, reason: string | null, desk: DeskContext): Promise<void> {
    const row = await this.prisma.guardianship.findFirst({
      where: { childUserId: childId, status: GuardianshipStatus.ACTIVE },
      select: { id: true, status: true, guardianUserId: true },
    });

    if (!row) {
      throw new NotFoundException('Этот человек ни за кем не закреплён');
    }

    await this.revokeRow(row, { kind: 'club-admin' }, { byUserId: desk.actorUserId, reason, desk });
  }

  /** Кто ведёт человека сейчас. Пусто — никто, или ему уже 16. */
  async myGuardian(childId: string): Promise<MyGuardian | null> {
    const row = await this.prisma.guardianship.findFirst({
      where: { childUserId: childId, status: GuardianshipStatus.ACTIVE },
      select: { status: true, guardian: { select: { fullName: true } }, child: { select: { birthDate: true } } },
    });

    return row && guardianHasRights(row.status, row.child.birthDate, new Date())
      ? { name: shortName(row.guardian.fullName) }
      : null;
  }

  /** Заявки, которые ждут ответа самого человека. Устаревшие не показываются. */
  async incomingRequests(childId: string): Promise<GuardianshipRequestView[]> {
    const today = new Date();
    const child = await this.prisma.user.findUniqueOrThrow({ where: { id: childId }, select: { birthDate: true } });

    // После 16 закреплять незачем — и заявки показывать тоже.
    if (!isChild(child.birthDate, today)) {
      return [];
    }

    const rows = await this.prisma.guardianship.findMany({
      where: {
        childUserId: childId,
        status: GuardianshipStatus.PENDING,
        createdAt: { gte: new Date(today.getTime() - REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000) },
      },
      select: { id: true, createdAt: true, guardian: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      guardianName: shortName(row.guardian.fullName),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Ребёнок отвечает на заявку.
   *
   * Подтверждение — одной транзакцией: эта заявка становится опекой, остальные
   * ждущие закрываются. Гонку двух подтверждений ловит частичный уникальный
   * индекс «одна действующая опека».
   */
  async answer(childId: string, requestId: string, answer: 'CONFIRM' | 'REJECT'): Promise<void> {
    const today = new Date();
    const row = await this.prisma.guardianship.findUnique({
      where: { id: requestId },
      select: {
        status: true,
        childUserId: true,
        createdAt: true,
        guardian: { select: { birthDate: true } },
        child: { select: { birthDate: true } },
      },
    });

    if (!row) {
      throw new NotFoundException('Заявка не найдена');
    }

    const decision = decideAnswer({
      request: {
        status: row.status,
        childUserId: row.childUserId,
        guardianBirthDate: row.guardian.birthDate,
        createdAt: row.createdAt,
      },
      answererId: childId,
      childBirthDate: row.child.birthDate,
      answer,
      today,
    });

    if (!decision.ok) {
      refuse(decision);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.guardianship.updateMany({
          where: { id: requestId, status: GuardianshipStatus.PENDING },
          data:
            answer === 'CONFIRM'
              ? { status: GuardianshipStatus.ACTIVE, confirmedAt: today }
              : { status: GuardianshipStatus.REJECTED, rejectedAt: today },
        });

        if (updated.count === 0) {
          throw new ConflictException('На эту заявку уже ответили');
        }

        if (answer === 'CONFIRM') {
          await tx.guardianship.updateMany({
            where: { childUserId: childId, status: GuardianshipStatus.PENDING, id: { not: requestId } },
            data: { status: GuardianshipStatus.REJECTED, rejectedAt: today },
          });
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('У вас уже есть закреплённый родитель');
      }
      throw error;
    }
  }

  private async requireRights(guardianId: string, childId: string): Promise<void> {
    const row = await this.prisma.guardianship.findFirst({
      where: {
        guardianUserId: guardianId,
        childUserId: childId,
        status: GuardianshipStatus.ACTIVE,
        child: { deactivatedAt: null, anonymizedAt: null },
      },
      select: { status: true, child: { select: { birthDate: true } } },
    });

    if (!row) {
      throw new NotFoundException('Ребёнок не найден среди ваших');
    }

    if (!guardianHasRights(row.status, row.child.birthDate, new Date())) {
      throw new ForbiddenException(`С ${CHILD_UNTIL_AGE} лет человек распоряжается своей учёткой сам`);
    }
  }

  private async revokeRow(
    row: { id: string; status: GuardianshipStatus },
    actor: { kind: 'guardian' } | { kind: 'club-admin' },
    by: { byUserId: string; reason: string | null; desk?: DeskContext },
  ): Promise<void> {
    const reason = by.reason?.trim() || null;
    const decision = decideRevoke({ status: row.status, actor, reason });

    if (!decision.ok) {
      refuse(decision);
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Условие по статусу — в самом обновлении: два нажатия «Отвязать» или
      // родитель и клуб одновременно не должны дважды писать отзыв.
      const updated = await tx.guardianship.updateMany({
        where: { id: row.id, status: GuardianshipStatus.ACTIVE },
        data: {
          status: GuardianshipStatus.REVOKED,
          revokedAt: now,
          revokedByUserId: by.byUserId,
          revokedInTenantId: by.desk?.tenantId ?? null,
          revokeReason: reason,
        },
      });

      if (updated.count === 0) {
        throw new ConflictException('Закрепление уже снято');
      }

      if (by.desk) {
        await tx.auditLog.create({
          data: {
            tenantId: by.desk.tenantId,
            action: AuditAction.GUARDIANSHIP_REVOKED,
            actorType: ActorType.USER,
            actorUserId: by.desk.actorUserId,
            entityType: 'Guardianship',
            entityId: row.id,
            before: { status: GuardianshipStatus.ACTIVE },
            after: { status: GuardianshipStatus.REVOKED },
            reason,
            ipAddress: by.desk.ipAddress,
          },
        });
      }
    });
  }
}

function toChild(child: { id: string; fullName: string; email: string; birthDate: Date }): FamilyChild {
  return {
    id: child.id,
    fullName: child.fullName,
    email: child.email,
    birthDate: formatBirthDate(child.birthDate),
    guardianUntil: birthdayOfAge(child.birthDate, CHILD_UNTIL_AGE),
  };
}
