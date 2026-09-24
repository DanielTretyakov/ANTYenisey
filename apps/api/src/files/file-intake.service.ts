import { BadRequestException, Injectable } from '@nestjs/common';
import { checkUpload, type FileKind, type StoredContentType } from './file-signature';
import { normalizeAvatar, normalizeBanner, normalizeDocumentImage } from './image-normalizer';

/** Файл, готовый к записи: тип определён по байтам, картинка перекодирована. */
export interface PreparedFile {
  kind: FileKind;
  contentType: StoredContentType;
  data: Uint8Array;
}

/**
 * Приём загруженного файла: проверка и перекодирование — до записи в базу.
 *
 * Отдельно от хранилища: хранилище знает, КУДА класть байты, а здесь решается,
 * ЧТО вообще можно положить. При переезде в S3 это правило не меняется.
 */
@Injectable()
export class FileIntake {
  async prepare(kind: FileKind, upload: Uint8Array | undefined): Promise<PreparedFile> {
    if (!upload) {
      throw new BadRequestException('Приложите файл в поле «file»');
    }

    const checked = checkUpload(kind, upload);

    if (!checked.ok) {
      throw new BadRequestException(checked.message);
    }

    // PDF хранится как есть: пересобрать его без потерь нечем, а раздаётся он
    // только вложением и под запретом исполнения (см. PlayerFilesController).
    if (checked.contentType === 'application/pdf') {
      return { kind, contentType: checked.contentType, data: upload };
    }

    try {
      // Фотография тренера проходит тем же путём, что аватар: квадрат 512×512
      // в WebP, метаданные с координатами съёмки не переживают перекодирование.
      if (kind === 'AVATAR' || kind === 'COACH_PHOTO') {
        return { kind, contentType: 'image/webp', data: await normalizeAvatar(upload) };
      }

      if (kind === 'CLUB_BANNER') {
        return { kind, contentType: 'image/webp', data: await normalizeBanner(upload) };
      }

      return { kind, contentType: checked.contentType, data: await normalizeDocumentImage(upload, checked.contentType) };
    } catch {
      // Сигнатура совпала, а прочитать не вышло: файл обрезан, повреждён или
      // слишком велик по разрешению. Подробности sharp человеку не помогут.
      throw new BadRequestException('Не удалось прочитать картинку: файл повреждён или слишком большой по разрешению');
    }
  }
}
