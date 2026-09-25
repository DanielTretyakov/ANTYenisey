import { Module } from '@nestjs/common';
import { AddressModule } from '../address/address.module';
import { FilesModule } from '../files/files.module';
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
  imports: [FilesModule, AddressModule],
  controllers: [ClubController],
  providers: [ClubService, ScheduleService, CatalogService, MembershipService],
  exports: [ClubService, ScheduleService, CatalogService, MembershipService],
})
export class ClubModule {}
