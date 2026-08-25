import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { onest, unbounded } from '@/lib/fonts';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Енисей — академия настольного тенниса',
    template: '%s · Енисей',
  },
  description: 'Запись на тренировки, турниры и аренда столов',
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
      <body>{children}</body>
    </html>
  );
}
