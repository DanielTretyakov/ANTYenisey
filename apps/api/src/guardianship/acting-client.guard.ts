import { isStaff } from '@yenisey/types';
import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GuardianshipStatus, Role } from '@yenisey/database';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { decideActing, type ActingMode } from './guardianship-rules';

/** За кого выполняется клиентское действие. */
export interface ActingClient {
  /** Чью запись создают, отменяют или показывают: самого человека или его ребёнка. */
  userId: string;
  /** Действует родитель за ребёнка. */
  byGuardian: boolean;
}

interface ActingRequest extends AuthenticatedRequest {
  /** null — открытый маршрут, и никто не вошёл. */
  actingClient?: ActingClient | null;
}

const ACTING_MODE_KEY = 'actingMode';

/**
 * Клиентское действие, которое можно выполнить за своего ребёнка.
 *
 * Заменяет `@Roles('CLIENT')` на маршрутах записи, отмены и своих списков.
 * Тот проверял роль ВЫЗЫВАЮЩЕГО — и тренер, чей сын ходит в группу, упирался
 * бы в «Недостаточно прав», хотя пишет не себя (решение от 17.09.2026). Здесь
 * сначала решается, за кого действие, а роль проверяется уже у него.
 *
 * Ребёнок указывается параметром `?for=<id>`. Без него человек действует сам.
 *
 * Порядок глобальных guard'ов (`auth.module.ts`) не меняется: этот
 * выполняется после них, когда токен разобран и клуб определён.
 */
export const ClientAction = (mode: ActingMode = 'write') =>
  applyDecorators(SetMetadata(ACTING_MODE_KEY, mode), UseGuards(ActingClientGuard));

/** За кого действие — то, что решил `ActingClientGuard`. */
export const Acting = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<ActingRequest>();

  if (request.actingClient === undefined) {
    // Ошибка программиста, а не клиента: параметр запрошен без @ClientAction().
    throw new Error('@Acting() использован на маршруте без @ClientAction()');
  }

  return request.actingClient;
});

@Injectable()
export class ActingClientGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const mode =
      this.reflector.getAllAndOverride<ActingMode>(ACTING_MODE_KEY, [context.getHandler(), context.getClass()]) ??
      'write';
    const request = context.switchToHttp().getRequest<ActingRequest>();
    const raw = (request.query as Record<string, unknown> | undefined)?.for;
    const forId = typeof raw === 'string' && raw !== '' ? raw : null;
    const callerId = request.user?.sub ?? null;

    if (!callerId) {
      // Открытый список мероприятий смотрят и без входа — но за ребёнка
      // без входа не смотрят.
      if (forId) {
        throw new UnauthorizedException('Требуется авторизация');
      }

      request.actingClient = null;
      return true;
    }

    const today = new Date();
    const caller = await this.prisma.user.findUniqueOrThrow({
      where: { id: callerId },
      select: { birthDate: true },
    });

    const guardianship =
      forId && forId !== callerId
        ? await this.prisma.guardianship.findFirst({
            where: {
              guardianUserId: callerId,
              childUserId: forId,
              status: GuardianshipStatus.ACTIVE,
              child: { deactivatedAt: null, anonymizedAt: null },
            },
            select: { status: true, child: { select: { birthDate: true } } },
          })
        : null;

    const decision = decideActing({
      mode,
      callerId,
      callerBirthDate: caller.birthDate,
      forId,
      guardianship,
      childBirthDate: guardianship?.child.birthDate ?? null,
      today,
    });

    if (!decision.ok) {
      throw new HttpException(decision.message, decision.status);
    }

    await this.checkClubRole(request, decision, mode);

    request.actingClient = { userId: decision.userId, byGuardian: decision.byGuardian };
    return true;
  }

  /**
   * Роль в клубе — у того, ЗА КОГО действие.
   *
   * Сам за себя человек записывается клиентом, как и раньше. За ребёнка
   * проверяется привязка ребёнка: сотрудником клуба он быть может (и тогда
   * записывается через рабочее место), а отключённым в клубе — не может.
   * Смотреть свои списки роль не мешает никому.
   */
  private async checkClubRole(request: ActingRequest, acting: ActingClient, mode: ActingMode): Promise<void> {
    const club = request.club;

    if (!club) {
      return;
    }

    if (!acting.byGuardian) {
      if (mode === 'write' && isStaff(club.roles)) {
        throw new ForbiddenException('Недостаточно прав');
      }
      return;
    }

    const membership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: acting.userId, tenantId: club.tenantId } },
      select: { roles: true, deactivatedAt: true },
    });

    if (membership?.deactivatedAt) {
      throw new ForbiddenException('Доступ ребёнка в этот клуб закрыт');
    }

    if (mode === 'write' && membership && isStaff(membership.roles)) {
      throw new ForbiddenException('Недостаточно прав');
    }
  }
}
