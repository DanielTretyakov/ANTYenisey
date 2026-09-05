import { Module } from '@nestjs/common';
import { EntriesModule } from '../entries/entries.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [EntriesModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
