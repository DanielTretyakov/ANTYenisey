import { Module } from '@nestjs/common';
import { ClubModule } from '../club/club.module';
import { EntriesModule } from '../entries/entries.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  // ClubModule — ради MembershipService: привязку человека к клубу заводят
  // три сценария, и общая копия у них должна быть одна.
  imports: [ClubModule, EntriesModule],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
