import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer from 'multer';
import { from, type Observable, switchMap } from 'rxjs';
import { MAX_UPLOAD_BYTES } from './file-signature';

/**
 * Разбор `multipart/form-data` с одним файлом в поле `file`.
 *
 * Свой перехватчик, а не `FileInterceptor` из Nest: тот отвечает на слишком
 * большой файл английским «File too large», и эта строка доезжала бы до
 * человека в форме. Здесь — те же multer и те же лимиты, но ответы по-русски.
 *
 * Файл читается в память: самый большой — 10 МБ, и дальше он всё равно целиком
 * идёт в `sharp` и в базу. Разбор обрывается на потолке, не дочитывая тело.
 */
@Injectable()
export class SingleFileUpload implements NestInterceptor {
  private readonly parse = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1,
      // Текстовые поля — у разряда: номер и дата приказа. Больше им не нужно.
      fields: 10,
      fieldSize: 1024,
    },
  }).single('file');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const parsed = new Promise<void>((resolve, reject) => {
      this.parse(request, response, (error: unknown) => (error ? reject(translate(error)) : resolve()));
    });

    return from(parsed).pipe(switchMap(() => next.handle()));
  }
}

function translate(error: unknown): Error {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return new PayloadTooLargeException(`Файл больше ${MAX_UPLOAD_BYTES / 1024 / 1024} МБ`);
      case 'LIMIT_UNEXPECTED_FILE':
      case 'LIMIT_FILE_COUNT':
        return new BadRequestException('Приложите один файл в поле «file»');
      default:
        return new BadRequestException('Форма загрузки разобрана с ошибкой');
    }
  }

  return new BadRequestException('Форма загрузки разобрана с ошибкой');
}

/** Байты загруженного файла, если он был. */
export function uploadedBytes(request: Request): Uint8Array | undefined {
  return (request as Request & { file?: Express.Multer.File }).file?.buffer;
}
