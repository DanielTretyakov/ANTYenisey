import type { MetadataRoute } from 'next';

/**
 * Манифест сайта (решение владельца от 12.10.2026): значок на экране
 * «Домой» вместо снимка страницы. На iPhone он и условие уведомлений в
 * браузере — Safari присылает их только сайту, открытому с экрана «Домой».
 *
 * Значки сгенерированы из того же рисунка, что `icon.svg`: обычные — плашкой
 * со скруглением, маскируемый — во весь квадрат со знаком в безопасной зоне
 * (Android сам вырезает круг или скруглённый квадрат).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'КНТ — клубы настольного тенниса',
    short_name: 'КНТ',
    description: 'Запись на занятия и турниры, аренда стола в клубах настольного тенниса',
    lang: 'ru',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0b0d0c',
    theme_color: '#126b54',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
