import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { QuickHelp } from '@/components/help/QuickHelp';
import { DevNotice } from '@/components/layout/DevNotice';
import { NavigationProgress } from '@/components/layout/NavigationProgress';
import { HELP_ARTICLES } from '@/content/help';
import { onest, unbounded } from '@/lib/fonts';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'КНТ — клубы настольного тенниса',
    template: '%s · КНТ',
  },
  description:
    'Найдите клуб настольного тенниса в своём городе: запись на занятия и турниры, аренда стола и робота',
  // Значок iPhone для экрана «Домой» — во весь квадрат, углы скругляет система.
  icons: { apple: '/icons/apple-touch-icon.png' },
  // Открытый с экрана «Домой» — как приложение, без строки браузера.
  appleWebApp: { capable: true, title: 'КНТ', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  // Цвет строки состояния в мобильных браузерах: изумруд днём, чёрный ночью.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0d0c' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={`${onest.variable} ${unbounded.variable}`} suppressHydrationWarning>
      <head>
        {/* Тема применяется до первой отрисовки — см. комментарий в lib/theme.ts.
            suppressHydrationWarning на <html> нужен именно из-за этого: скрипт
            успевает поставить data-theme раньше, чем React сверит разметку. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {/* Полоса «загружаем страницу» — от нажатия на ссылку до смены адреса. */}
        <NavigationProgress />
        {/* «Сервис в разработке» — над шапкой всех страниц (17.10.2026). */}
        <DevNotice />
        {children}
        {/* Быстрая помощь — на всех страницах (решение владельца от 15.10.2026).
            Статьи — только заголовками и выдержками: тексты в браузер не нужны. */}
        <QuickHelp articles={HELP_ARTICLES.map(({ slug, title, summary }) => ({ slug, title, summary }))} />
      </body>
    </html>
  );
}
