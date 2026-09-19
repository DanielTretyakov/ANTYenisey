import { Module } from '@nestjs/common';
import { ClubModule } from '../club/club.module';
import { GuardianshipModule } from '../guardianship/guardianship.module';
import {
  MeSubscriptionsController,
  PersonSubscriptionsController,
  SubscriptionPlansController,
} from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Абонементы клиента: тарифы, продажа, корректировка, история и списание
 * визитов при записи.
 *
 * `ClubModule` — ради `MembershipService`: абонемент ссылается на анкету
 * клиента, и заводит её тот же код, что и первая запись. `GuardianshipModule`
 * — ради «действую за» в `/me/subscriptions`.
 *
 * `SubscriptionsService` отдаётся наружу: запись, отметка и карточка человека
 * работают с абонементами через него.
 */
@Module({
  imports: [ClubModule, GuardianshipModule],
  controllers: [SubscriptionPlansController, PersonSubscriptionsController, MeSubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
