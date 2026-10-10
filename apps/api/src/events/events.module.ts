import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { StaffModule } from '../staff/staff.module';
import { ClubModule } from '../club/club.module';
import { EntriesModule } from '../entries/entries.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ClubEntriesController } from './club-entries.controller';
import { EventCancellationController } from './event-cancellation.controller';
import { EventCancellationService } from './event-cancellation.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // ClubModule — ради MembershipService: привязку человека к клубу заводят
  // три сценария, и общая копия у них должна быть одна. SubscriptionsModule —
  // ради оплаты записи абонементом.
  imports: [AttendanceModule, ClubModule, EntriesModule, SubscriptionsModule, NotificationsModule, StaffModule],
  controllers: [EventsController, EventCancellationController, ClubEntriesController],
  providers: [EventsService, EventCancellationService],
})
export class EventsModule {}
