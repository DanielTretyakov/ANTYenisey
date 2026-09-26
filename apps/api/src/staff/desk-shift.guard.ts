import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { StaffService } from './staff.service';

/**
 * «Смена» — только тем, кто сегодня на ней (решение владельца от 26.09.2026):
 * администратору — в день своей смены и в своём зале, управляющему — в его
 * залах, руководителю — всегда. Чтобы никто другой случайно ничего не внёс.
 *
 * Стоит на контроллерах смены после глобальных guard'ов: клубный контекст и
 * роли к этому моменту уже проверены. Зал берётся из адреса, если он там есть;
 * у записей и отметок его нет — тогда хватает смены в любом своём зале.
 */
@Injectable()
export class DeskShiftGuard implements CanActivate {
  constructor(private readonly staff: StaffService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & { params: Record<string, string> }>();

    if (!request.club) {
      return false;
    }

    await this.staff.assertDesk(request.club, request.params.hallId ?? null);

    return true;
  }
}
