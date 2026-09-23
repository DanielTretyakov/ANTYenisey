import { Module } from '@nestjs/common';
import { ClubModule } from '../club/club.module';
import { EntriesModule } from '../entries/entries.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // ClubModule — ради MembershipService: привязку человека к клубу заводят
  // три сценария, и общая копия у них должна быть одна. SubscriptionsModule —
  // ради оплаты записи абонементом.
  imports: [ClubModule, EntriesModule, SubscriptionsModule, NotificationsModule],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
