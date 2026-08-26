import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { ClubController } from './club.controller';
import { ClubService } from './club.service';
import { ScheduleService } from './schedule.service';

@Module({
  controllers: [ClubController],
  providers: [ClubService, ScheduleService, CatalogService],
  exports: [ClubService, ScheduleService, CatalogService],
})
export class ClubModule {}
