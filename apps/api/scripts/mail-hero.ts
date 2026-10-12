/**
 * Фон обложки письма — `apps/web/public/mail/hero.png`.
 *
 *   pnpm --filter @yenisey/api mail:hero
 *
 * Тот же рисунок, что шапка стартовой страницы: изумруд платформы,
 * притемнённый к чернилам (`--brand-600` 50 % с `--ink-950`), светлое пятно
 * `--brand-400` справа сверху и русло реки с горами (`RiverBackdrop`,
 * горизонтальный). Картинкой, а не CSS: градиенты половина почтовиков
 * выбрасывает, а фон-картинку понимает большинство; где картинки выключены,
 * остаётся сплошной цвет `HERO_COLOR` письма.
 *
 * Размер — вдвое шире письма (560 → 1120), чтобы на экранах с плотными
 * пикселями фон не мылился.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp') as typeof import('sharp');

const root = resolve(import.meta.dirname, '../../..');
const width = 1120;
const height = 480;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1200 514" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="glow" cx="0.86" cy="-0.08" r="0.75" gradientTransform="scale(1 0.55)">
      <stop offset="0" stop-color="#35a588" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#35a588" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="depth" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#11493a"/>
      <stop offset="1" stop-color="#0b2e25"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="514" fill="url(#depth)"/>
  <rect width="1200" height="514" fill="url(#glow)"/>
  <path d="M-60 430 C220 330 360 470 560 330 C760 190 900 300 1260 80" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="130" stroke-linecap="round"/>
  <path d="M-60 430 C220 330 360 470 560 330 C760 190 900 300 1260 80" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="2.5"/>
  <path d="M560 540 L680 370 L740 440 L840 280 L920 390 L1020 230 L1260 470" fill="none" stroke="#ffffff" stroke-opacity="0.1" stroke-width="2.5"/>
</svg>`;

const target = resolve(root, 'apps/web/public/mail/hero.png');
mkdirSync(resolve(root, 'apps/web/public/mail'), { recursive: true });
await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(target);
console.log(`Готово: ${target}`);
