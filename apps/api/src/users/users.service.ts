import { Injectable, NotFoundException } from '@nestjs/common';
import type { PublicUser } from '@yenisey/types';
import { formatBirthDate } from '../auth/birth-date';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Пользователь без секретных полей.
   *
   * tenantId в условии обязателен, хотя id и так уникален: это второй рубеж
   * поверх составных внешних ключей — запрос физически не может вернуть
   * человека из чужого клуба, даже если id подставили из другого tenant.
   */
  async findPublicById(userId: string, tenantId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, deactivatedAt: null, anonymizedAt: null },
      select: {
        id: true,
        tenantId: true,
        email: true,
        phone: true,
        birthDate: true,
        role: true,
        fullName: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      phone: user.phone,
      birthDate: formatBirthDate(user.birthDate),
      role: user.role,
      fullName: user.fullName,
    };
  }
}
