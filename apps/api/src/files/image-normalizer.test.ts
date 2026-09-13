import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { AVATAR_SIZE, normalizeAvatar, normalizeDocumentImage } from './image-normalizer.ts';

/** Снимок «с телефона»: JPEG с EXIF, где лежат модель камеры и координаты. */
async function photoWithExif(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'Phone', Model: 'Camera', Orientation: '6' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '56/1 0/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '92/1 52/1 0/1' },
    })
    .toBuffer();
}

describe('normalizeAvatar', () => {
  it('квадрат 512×512 в WebP', async () => {
    const out = await normalizeAvatar(await photoWithExif(1200, 800));
    const meta = await sharp(out).metadata();

    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, AVATAR_SIZE);
    assert.equal(meta.height, AVATAR_SIZE);
  });

  it('EXIF с координатами не переживает загрузку', async () => {
    const input = await photoWithExif(800, 600);
    assert.ok((await sharp(input).metadata()).exif, 'у исходника EXIF должен быть');

    const meta = await sharp(await normalizeAvatar(input)).metadata();

    assert.equal(meta.exif, undefined);
    assert.equal(meta.icc, undefined);
    assert.equal(meta.xmp, undefined);
  });

  it('не картинка — ошибка, а не пустой аватар', async () => {
    await assert.rejects(normalizeAvatar(new TextEncoder().encode('%PDF-1.7 не картинка')));
  });

  it('обрезанный файл — ошибка', async () => {
    const whole = await photoWithExif(400, 400);
    await assert.rejects(normalizeAvatar(whole.subarray(0, Math.floor(whole.length / 2))));
  });
});

describe('normalizeDocumentImage', () => {
  it('формат сохраняется, метаданные — нет', async () => {
    const out = await normalizeDocumentImage(await photoWithExif(1000, 1400), 'image/jpeg');
    const meta = await sharp(out).metadata();

    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.exif, undefined);
  });

  it('скан больше A4 при 300 точках уменьшается, меньший — нет', async () => {
    const huge = await sharp({ create: { width: 4960, height: 7016, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    const big = await sharp(await normalizeDocumentImage(huge, 'image/png')).metadata();

    assert.equal(big.width, 2480);
    assert.equal(big.height, 3508);

    const small = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#fff' } })
      .webp()
      .toBuffer();
    const kept = await sharp(await normalizeDocumentImage(small, 'image/webp')).metadata();

    assert.equal(kept.width, 600);
    assert.equal(kept.format, 'webp');
  });
});
