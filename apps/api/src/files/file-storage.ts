import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma, StoredFileKind } from '@yenisey/database';
import { PrismaService } from '../prisma/prisma.service';
import type { StoredContentType } from './file-signature';

/** Что известно о файле без его байтов. */
/**
 * Чей файл: человека или клуба — ровно одно (CHECK StoredFile_one_owner).
 * Клубу принадлежит только баннер.
 */
export type FileOwner = { ownerUserId: string } | { ownerTenantId: string };

export interface StoredFileInfo {
  id: string;
  ownerUserId: string | null;
  ownerTenantId: string | null;
  kind: StoredFileKind;
  contentType: StoredContentType;
  size: number;
  createdAt: Date;
}

/** Файл вместе с содержимым — для раздачи. */
export interface StoredFileContent extends StoredFileInfo {
  data: Uint8Array;
  sha256: string;
}

export type NewStoredFile = FileOwner & {
  kind: StoredFileKind;
  contentType: StoredContentType;
  data: Uint8Array;
};

/**
 * Хранилище загруженных файлов.
 *
 * Интерфейс, а не прямые запросы к таблице по месту: байты сейчас лежат в
 * Postgres, потому что хостинга с объектным хранилищем пока нет, — и переезд в
 * S3 должен означать замену одной реализации, а не правку каждого сервиса,
 * который файлы трогает.
 *
 * Запись и удаление принимают транзакцию: файл всегда меняется вместе со
 * ссылкой на него. Новый аватар без обновлённого профиля — мусор в базе,
 * профиль со ссылкой на удалённый файл — битая картинка.
 */
export abstract class FileStorage {
  abstract save(tx: Prisma.TransactionClient, file: NewStoredFile): Promise<StoredFileInfo>;

  abstract read(id: string): Promise<StoredFileContent | null>;

  /**
   * Удалить файлы этого вида у человека — все, кроме `keepId`.
   *
   * Не «удалить старый по id»: две загрузки аватара подряд обе прочитали бы
   * один и тот же старый файл, и вторая либо упала бы на уже удалённом, либо
   * оставила бы первый новый файл сиротой — чужое фото, которое никто не
   * видит и никто не удалит. Здесь у человека после транзакции остаётся ровно
   * тот файл, на который ссылается профиль.
   */
  abstract prune(
    tx: Prisma.TransactionClient,
    target: FileOwner & { kind: StoredFileKind; keepId: string | null },
  ): Promise<void>;
}

/**
 * Файлы в таблице `StoredFile`, байты — колонкой `bytea`.
 *
 * Для аватаров в десятки килобайт и сканов приказов, которые загружают раз в
 * несколько лет, этого хватает с запасом. Предел подхода — резервная копия
 * базы, которая растёт вместе с файлами; к моменту, когда это станет заметно,
 * должен появиться хостинг (см. план хостинга).
 */
@Injectable()
export class PostgresFileStorage extends FileStorage {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async save(tx: Prisma.TransactionClient, file: NewStoredFile): Promise<StoredFileInfo> {
    const created = await tx.storedFile.create({
      data: {
        ...ownerOf(file),
        kind: file.kind,
        contentType: file.contentType,
        size: file.data.length,
        sha256: createHash('sha256').update(file.data).digest('hex'),
        // Копия в собственный ArrayBuffer: Prisma не принимает представление
        // поверх общего буфера, а Buffer из sharp и multer бывает именно таким.
        data: new Uint8Array(file.data),
      },
      select: INFO,
    });

    return toInfo(created);
  }

  async read(id: string): Promise<StoredFileContent | null> {
    const found = await this.prisma.storedFile.findUnique({
      where: { id },
      select: { ...INFO, data: true, sha256: true },
    });

    return found ? { ...toInfo(found), data: found.data, sha256: found.sha256 } : null;
  }

  async prune(
    tx: Prisma.TransactionClient,
    target: FileOwner & { kind: StoredFileKind; keepId: string | null },
  ): Promise<void> {
    await tx.storedFile.deleteMany({
      where: {
        ...ownerOf(target),
        kind: target.kind,
        ...(target.keepId ? { id: { not: target.keepId } } : {}),
      },
    });
  }
}

/** Владелец из объединения — ровно одним полем, второе не пишется вовсе. */
function ownerOf(owner: FileOwner): { ownerUserId: string } | { ownerTenantId: string } {
  return 'ownerUserId' in owner ? { ownerUserId: owner.ownerUserId } : { ownerTenantId: owner.ownerTenantId };
}

const INFO = {
  id: true,
  ownerUserId: true,
  ownerTenantId: true,
  kind: true,
  contentType: true,
  size: true,
  createdAt: true,
} as const;

function toInfo(row: {
  id: string;
  ownerUserId: string | null;
  ownerTenantId: string | null;
  kind: StoredFileKind;
  contentType: string;
  size: number;
  createdAt: Date;
}): StoredFileInfo {
  return {
    ...row,
    // Тип в базе ограничен CHECK'ом (constraints.sql, раздел 18), поэтому
    // сужение здесь — не догадка, а то, что база и так гарантирует.
    contentType: row.contentType as StoredContentType,
  };
}
