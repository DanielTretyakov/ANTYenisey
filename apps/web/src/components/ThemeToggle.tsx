'use client';

import { useEffect, useState } from 'react';
import { applyTheme, readTheme, type ThemePreference } from '@/lib/theme';

const ORDER: ThemePreference[] = ['system', 'light', 'dark'];

const LABELS: Record<ThemePreference, string> = {
  system: 'Тема: как в системе',
  light: 'Тема: светлая',
  dark: 'Тема: тёмная',
};

/**
 * Переключатель темы: система → светлая → тёмная → система.
 *
 * До монтирования компонент рисует заглушку того же размера: значение темы
 * живёт в localStorage, на сервере его нет, и попытка отрисовать реальную
 * иконку сразу дала бы расхождение разметки с сервером.
 */
export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    setPreference(readTheme());
  }, []);

  function handleClick(): void {
    const next = ORDER[(ORDER.indexOf(preference ?? 'system') + 1) % ORDER.length]!;
    applyTheme(next);
    setPreference(next);
  }

  if (preference === null) {
    return <span className="h-11 w-11" aria-hidden="true" />;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={LABELS[preference]}
      aria-label={LABELS[preference]}
      className="inline-flex h-11 w-11 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-surface-sunken hover:text-text"
    >
      <ThemeIcon preference={preference} />
    </button>
  );
}

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  const common = {
    viewBox: '0 0 20 20',
    className: 'h-5 w-5',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (preference === 'light') {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="3.6" />
        <path d="M10 2v1.8M10 16.2V18M18 10h-1.8M3.8 10H2M15.7 4.3l-1.3 1.3M5.6 14.4l-1.3 1.3M15.7 15.7l-1.3-1.3M5.6 5.6L4.3 4.3" />
      </svg>
    );
  }

  if (preference === 'dark') {
    return (
      <svg {...common}>
        <path d="M16.5 12.3A7 7 0 0 1 7.7 3.5a7 7 0 1 0 8.8 8.8Z" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.6" />
      <path d="M7 16.5h6" />
    </svg>
  );
}
