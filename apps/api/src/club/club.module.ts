import { Module } from '@nestjs/common';
import { ClosuresService } from './closures.service';
import { ClubController } from './club.controller';
import { ClubService } from './club.service';

@Module({
  controllers: [ClubController],
  providers: [ClubService, ClosuresService],
  exports: [ClubService, ClosuresService],
})
export class ClubModule {}
