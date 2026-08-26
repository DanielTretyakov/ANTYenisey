import { Module } from '@nestjs/common';
import { ClubController } from './club.controller';
import { ClubService } from './club.service';
import { ScheduleService } from './schedule.service';

@Module({
  controllers: [ClubController],
  providers: [ClubService, ScheduleService],
  exports: [ClubService, ScheduleService],
})
export class ClubModule {}
