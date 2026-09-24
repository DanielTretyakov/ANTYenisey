import sharp from 'sharp';

/**
 * Перекодирование загруженных картинок.
 *
 * Картинка не сохраняется в том виде, в каком пришла, по двум причинам.
 *
 * 1. Метаданные. Фотография с телефона несёт EXIF с координатами съёмки —
 *    у аватара, который видит вся платформа, это адрес человека. `sharp`
 *    выбрасывает метаданные по умолчанию, если их явно не попросить оставить.
 * 2. Содержимое. Байты, прошедшие проверку сигнатуры, могут оказаться
 *    полиглотом — картинкой и чем-то ещё сразу. После перекодирования от
 *    исходного файла остаются только пиксели.
 *
 * Чистый модуль без относительных импортов — его гоняет `node --test`.
 */

/** Сторона аватара. Больше не нужно нигде: самый крупный показ — 160 точек. */
export const AVATAR_SIZE = 512;

/**
 * Потолок разрешения на входе, в пикселях.
 *
 * Сорок мегапикселей — больше, чем снимает телефон, и меньше, чем «бомба»:
 * PNG в сотню килобайт, который распаковывается в гигабайты. Проверка идёт
 * по заголовку, до распаковки.
 */
const MAX_INPUT_PIXELS = 40_000_000;

/**
 * Приказ — не больше листа A4 при 300 точках на дюйм. Этого хватает, чтобы
 * прочитать номер и печать, а скан в 600 точек весит вчетверо больше.
 */
const DOCUMENT_MAX_WIDTH = 2480;
const DOCUMENT_MAX_HEIGHT = 3508;

type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

function open(input: Uint8Array) {
  return (
    sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      // Поворот по EXIF — до того, как EXIF выброшен: иначе снимок, сделанный
      // телефоном «боком», так боком и останется.
      .rotate()
  );
}

/** Аватар: квадрат 512×512 в WebP. Кадрирование — по самому заметному. */
export async function normalizeAvatar(input: Uint8Array): Promise<Uint8Array> {
  return open(input)
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: sharp.strategy.attention })
    .webp({ quality: 82 })
    .toBuffer();
}

/** Баннер клуба: полоса 1600×500 для шапки страницы клуба. */
export const BANNER_WIDTH = 1600;
export const BANNER_HEIGHT = 500;

/**
 * Баннер клуба: полоса 1600×500 в WebP, кадрирование — по самому заметному.
 * Метаданные выбрасываются, как у аватара: снимок зала с телефона несёт
 * координаты, а баннер видит вся платформа.
 */
export async function normalizeBanner(input: Uint8Array): Promise<Uint8Array> {
  return open(input)
    .resize(BANNER_WIDTH, BANNER_HEIGHT, { fit: 'cover', position: sharp.strategy.attention })
    .webp({ quality: 80 })
    .toBuffer();
}

/**
 * Скан приказа: формат тот же, что пришёл, размер — не больше A4.
 *
 * Формат не меняется намеренно: снимок экрана с текстом в JPEG расплылся бы, а
 * фотография листа в PNG весила бы впятеро больше.
 */
export async function normalizeDocumentImage(input: Uint8Array, type: ImageType): Promise<Uint8Array> {
  const image = open(input).resize(DOCUMENT_MAX_WIDTH, DOCUMENT_MAX_HEIGHT, {
    fit: 'inside',
    withoutEnlargement: true,
  });

  switch (type) {
    case 'image/jpeg':
      return image.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    case 'image/png':
      return image.png({ compressionLevel: 9 }).toBuffer();
    case 'image/webp':
      return image.webp({ quality: 88 }).toBuffer();
  }
}
