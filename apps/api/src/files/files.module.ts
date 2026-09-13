import { Module } from '@nestjs/common';
import { FileIntake } from './file-intake.service';
import { FileStorage, PostgresFileStorage } from './file-storage';
import { SingleFileUpload } from './single-file-upload.interceptor';

/**
 * Загруженные файлы: приём, хранение, чтение.
 *
 * Раздачи (`GET /files/:id`) здесь нет: кому отдавать файл, решают правила
 * того, чей это файл, — сейчас это правила профиля игрока (см. PlayersModule).
 *
 * Хранилище подставляется по абстрактному классу: переезд в S3 — это другая
 * строка `useClass`, и ни один сервис этого не заметит.
 */
@Module({
  providers: [FileIntake, SingleFileUpload, { provide: FileStorage, useClass: PostgresFileStorage }],
  exports: [FileIntake, SingleFileUpload, FileStorage],
})
export class FilesModule {}
