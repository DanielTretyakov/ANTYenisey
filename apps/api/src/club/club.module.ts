import { Module } from '@nestjs/common';
import { ClubController } from './club.controller';
import { ClubService } from './club.service';

@Module({
  controllers: [ClubController],
  providers: [ClubService],
  exports: [ClubService],
})
export class ClubModule {}
