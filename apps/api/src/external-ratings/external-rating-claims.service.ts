import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type RatingSystem } from '@yenisey/database';
import type { MyExternalRatings } from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { profileUrl } from './external-rules';

/**
 * «Выберите себя» (решение владельца от 20.10.2026): сверка нашла под ФИО и
 * год человека нескольких игроков источника — он сам отмечает, кто из них он.
 *
 * Выбрать можно только из того, что предложила сверка, — не любой профиль
 * источника: иначе любой приписал бы себе рейтинг чемпиона. Один профиль
 * закрепляет только один человек — это держит база (`ExternalRating_one_claim`).
 */
@Injectable()
export class ExternalRatingClaimsService {
  constructor(private readonly prisma: PrismaService) {}

  async mine(userId: string): Promise<MyExternalRatings> {
    const [claimed, choices] = await Promise.all([
      this.prisma.externalRating.findMany({
        where: { userId, claimedAt: { not: null } },
        select: { system: true },
      }),
      this.prisma.externalRatingChoice.findMany({
        where: { userId },
        select: { system: true, externalId: true, name: true, city: true, birthYear: true, rating: true, place: true },
        orderBy: [{ system: 'asc' }, { rating: 'desc' }],
      }),
    ]);
    const claimedSystems = claimed.map((row) => row.system);
    const view: MyExternalRatings = { claimed: claimedSystems, choices: {} };

    // Закрепил — выбирать уже не из чего; варианты остаются в базе до
    // следующей сверки, чтобы открепивший мог сразу выбрать заново.
    for (const { system, ...choice } of choices) {
      if (claimedSystems.includes(system)) continue;

      (view.choices[system] ??= []).push({ ...choice, url: profileUrl(system, choice.externalId) });
    }

    return view;
  }

  /** «Это я!» — закрепить вариант за собой. */
  async claim(userId: string, system: RatingSystem, externalId: string): Promise<MyExternalRatings> {
    const choice = await this.prisma.externalRatingChoice.findUnique({
      where: { userId_system_externalId: { userId, system, externalId } },
    });

    if (!choice) {
      throw new NotFoundException('Такого варианта нет — список обновляется раз в сутки, откройте страницу заново');
    }

    const data = {
      externalId: choice.externalId,
      rating: choice.rating,
      place: choice.place,
      asOf: choice.asOf,
      checkedAt: new Date(),
      claimedAt: new Date(),
    };

    try {
      await this.prisma.externalRating.upsert({
        where: { userId_system: { userId, system } },
        create: { userId, system, ...data },
        update: data,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Этот профиль уже закрепил за собой другой человек. Если это ошибка — напишите в клуб');
      }

      throw error;
    }

    return this.mine(userId);
  }

  /** «Это не я» — открепить свой выбор; варианты снова видны. */
  async unclaim(userId: string, system: RatingSystem): Promise<MyExternalRatings> {
    await this.prisma.externalRating.deleteMany({ where: { userId, system, claimedAt: { not: null } } });

    return this.mine(userId);
  }
}
