/**
 * Какие файлы принимает платформа и как понять, что пришло на самом деле.
 *
 * Чистый модуль без относительных импортов: его гоняет `node --test`, а тот
 * требует расширение `.ts` в пути, которого не принимает сборка.
 */

/** Форматы, которые платформа вообще хранит. SVG среди них нет и не будет. */
export type StoredContentType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

/** Вид файла — то же перечисление, что `StoredFileKind` в схеме. */
export type FileKind = 'AVATAR' | 'RANK_DOCUMENT';

const MB = 1024 * 1024;

/**
 * Что принимается на входе, по видам.
 *
 * Лимит здесь — на ЗАГРУЗКУ, а не на хранение. Аватар приходит с телефона в
 * 3–4 МБ и хранится пережатым до десятков килобайт; приказ в PDF хранится как
 * есть, и его лимит совпадает с потолком хранения в constraints.sql.
 */
export const FILE_RULES: Record<FileKind, { maxInputBytes: number; accepts: readonly StoredContentType[] }> = {
  AVATAR: {
    maxInputBytes: 5 * MB,
    accepts: ['image/jpeg', 'image/png', 'image/webp'],
  },
  RANK_DOCUMENT: {
    maxInputBytes: 10 * MB,
    accepts: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  },
};

/** Потолок любой загрузки: разбор запроса обрывается на нём, не дочитывая тело. */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(FILE_RULES).map((rule) => rule.maxInputBytes));

/**
 * Тип файла по первым байтам.
 *
 * Заголовку `Content-Type` и расширению верить нельзя: их пишет клиент, и
 * «image/png» на HTML-странице ничего не стоит. Байты подделать тоже можно,
 * но тогда файл не прочитает и `sharp`, — а картинки после проверки всё
 * равно перекодируются.
 *
 * Всё, что не опознано, — null: SVG, HTML, GIF, архивы. Отказ по умолчанию.
 */
export function sniffContentType(bytes: Uint8Array): StoredContentType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }

  // WebP — это контейнер RIFF: «RIFF», четыре байта длины, «WEBP». Одного
  // «RIFF» мало — так же начинаются WAV и AVI.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return 'image/webp';
  }

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return 'application/pdf';
  }

  return null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

/**
 * Проверка загрузки до всякой обработки: размер своего вида и формат.
 *
 * Возвращает определённый тип или текст отказа для человека. Размер
 * проверяется по видам здесь, а не лимитом разбора запроса: тот один на все
 * маршруты и равен самому щедрому виду.
 */
export function checkUpload(
  kind: FileKind,
  bytes: Uint8Array,
): { ok: true; contentType: StoredContentType } | { ok: false; message: string } {
  const rule = FILE_RULES[kind];

  if (bytes.length === 0) {
    return { ok: false, message: 'Файл пустой' };
  }

  if (bytes.length > rule.maxInputBytes) {
    return { ok: false, message: `Файл больше ${Math.round(rule.maxInputBytes / MB)} МБ` };
  }

  const contentType = sniffContentType(bytes);

  if (!contentType || !rule.accepts.includes(contentType)) {
    return {
      ok: false,
      message:
        kind === 'AVATAR'
          ? 'Аватар — картинка JPEG, PNG или WebP'
          : 'Приказ — картинка JPEG, PNG, WebP или PDF',
    };
  }

  return { ok: true, contentType };
}
