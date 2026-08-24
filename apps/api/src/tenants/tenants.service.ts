import { Injectable, NotFoundException } from '@nestjs/common';
import type { PublicTenant } from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Публичные сведения о клубе по его коду.
   *
   * Отдаёт только название — ни цен, ни настроек, ни статуса подписки:
   * маршрут открыт без авторизации, потому что нужен формам входа и
   * регистрации до того, как человек вошёл.
   */
  async findPublicBySlug(slug: string): Promise<PublicTenant> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { slug: true, name: true },
    });

    if (!tenant) {
      throw new NotFoundException('Клуб не найден');
    }

    return tenant;
  }
}
