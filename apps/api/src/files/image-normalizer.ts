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

/** Сторона логотипа клуба: тот же квадрат, что аватар. */
export const LOGO_SIZE = 512;

/** Меньше этого знак расплывётся даже на самом крупном показе (64 точки ×2). */
export const LOGO_MIN_SIDE = 128;

/**
 * Допуск «квадратности»: 2158×2100 — тоже квадрат. Обрезка при приведении к
 * 512×512 срежет не больше пары процентов с краёв, и знак не пострадает.
 */
const LOGO_MAX_RATIO = 1.05;

/**
 * Годится ли картинка в логотип клуба (решение владельца от 02.10.2026:
 * логотип только квадратный). null — годится, иначе — отказ словами того,
 * кто загружает.
 *
 * Неквадратную картинку сервер не обрезает и не вписывает с полями, а
 * отклоняет: у горизонтального локапа обрезка срежет название, а поля
 * превратят знак в узкую полоску посередине. Квадрат клуб готовит сам.
 */
export function logoShapeProblem(width: number, height: number): string | null {
  const ratio = Math.max(width, height) / Math.min(width, height);

  if (!(ratio <= LOGO_MAX_RATIO)) {
    return `Логотип должен быть квадратным: сейчас ${width}×${height}`;
  }

  if (Math.min(width, height) < LOGO_MIN_SIDE) {
    return `Логотип слишком маленький: сейчас ${width}×${height}, нужно от ${LOGO_MIN_SIDE}×${LOGO_MIN_SIDE}`;
  }

  return null;
}

/** Отказ по форме логотипа — для человека, в отличие от сбоя чтения. */
export class LogoShapeError extends Error {}

/**
 * Логотип клуба: квадрат 512×512 в WebP, прозрачность сохраняется — знак
 * клуба часто нарисован по прозрачному фону. Метаданные выбрасываются, как у
 * аватара. Неквадратный — `LogoShapeError` с текстом отказа.
 */
export async function normalizeLogo(input: Uint8Array): Promise<Uint8Array> {
  // Размер — по заголовку, до распаковки. Поворот по EXIF на квадратность не
  // влияет: стороны просто меняются местами.
  const { width, height } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).metadata();

  if (!width || !height) {
    throw new Error('Размер картинки не прочитан');
  }

  const problem = logoShapeProblem(width, height);

  if (problem) {
    throw new LogoShapeError(problem);
  }

  return open(input).resize(LOGO_SIZE, LOGO_SIZE, { fit: 'cover' }).webp({ quality: 90 }).toBuffer();
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
