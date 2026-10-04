import { Module } from '@nestjs/common';
import { EntriesModule } from '../entries/entries.module';
import { MeController } from './me.controller';
import { FavouriteCoachesService } from './favourite-coaches.service';
import { MeService } from './me.service';

@Module({
  imports: [EntriesModule],
  controllers: [MeController],
  providers: [MeService, FavouriteCoachesService],
})
export class MeModule {}
