import { Injectable, NotFoundException } from '@nestjs/common';
import type { PublicUser } from '@yenisey/types';
import { formatBirthDate } from '../auth/birth-date';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Аккаунт без секретных полей, вместе с клубами и ролью в каждом.
   *
   * Клуб в условии больше не нужен и не имеет смысла: учётная запись
   * глобальная, а изоляцию клубов держат составные ключи и ClubContextGuard —
   * то есть проверка идёт на каждом клубном маршруте, а не в момент чтения
   * профиля.
   */
  async findPublicById(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deactivatedAt: null, anonymizedAt: null },
      select: {
        id: true,
        email: true,
        phone: true,
        birthDate: true,
        fullName: true,
        gender: true,
        memberships: {
          where: { deactivatedAt: null },
          select: {
            role: true,
            tenantId: true,
            tenant: { select: { slug: true, name: true } },
          },
          orderBy: { tenant: { name: 'asc' } },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      birthDate: formatBirthDate(user.birthDate),
      fullName: user.fullName,
      gender: user.gender,
      memberships: user.memberships.map((membership) => ({
        tenantId: membership.tenantId,
        slug: membership.tenant.slug,
        name: membership.tenant.name,
        role: membership.role,
      })),
    };
  }
}
