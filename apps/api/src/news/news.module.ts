import { Module } from '@nestjs/common';
import { NewsController, PlatformNewsController } from './news.controller';
import { NewsService } from './news.service';

/** Новости платформы (решение владельца от 26.09.2026). */
@Module({
  controllers: [NewsController, PlatformNewsController],
  providers: [NewsService],
})
export class NewsModule {}
