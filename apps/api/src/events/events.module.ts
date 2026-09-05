import { Module } from '@nestjs/common';
import { EntriesModule } from '../entries/entries.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [EntriesModule],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
