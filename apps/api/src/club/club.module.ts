import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { ClubController } from './club.controller';
import { ClubService } from './club.service';
import { MembershipService } from './membership.service';
import { ScheduleService } from './schedule.service';

/**
 * `MembershipService` экспортируется наружу: привязку человека к клубу заводят
 * три разных сценария — бронь стола, запись на мероприятие и ручная бронь
 * администратором, — и четвёртой копии этих двух upsert'ов быть не должно.
 */
@Module({
  controllers: [ClubController],
  providers: [ClubService, ScheduleService, CatalogService, MembershipService],
  exports: [ClubService, ScheduleService, CatalogService, MembershipService],
})
export class ClubModule {}
