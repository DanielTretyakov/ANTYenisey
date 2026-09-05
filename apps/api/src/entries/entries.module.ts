import { Module } from '@nestjs/common';
import { EntriesService } from './entries.service';

/**
 * Сборка записей человека — общая для раздела «Мои записи» и страницы клуба.
 *
 * Своих маршрутов не имеет: это библиотека, а не раздел API. Контроллеры
 * лежат в `me` (все клубы) и `events` (один клуб).
 */
@Module({
  providers: [EntriesService],
  exports: [EntriesService],
})
export class EntriesModule {}
