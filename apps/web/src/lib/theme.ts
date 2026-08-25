export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'yenisey.theme';

/**
 * Скрипт, который выставляет тему до первой отрисовки.
 *
 * Выполняется синхронно в <head>: если применять тему из React-эффекта, у
 * человека с тёмной темой на долю секунды вспыхнет белый экран. Поэтому здесь
 * строка, а не импортируемая функция, — её вставляют в dangerouslySetInnerHTML.
 *
 * «system» не пишет атрибут вовсе: отсутствие data-theme и есть «как в
 * системе», за него отвечает медиазапрос в токенах.
 */
export const THEME_INIT_SCRIPT = `
try {
  var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.dataset.theme = stored;
  }
} catch (e) {}
`.trim();

export function applyTheme(preference: ThemePreference): void {
  if (preference === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = preference;
  }

  // Приватный режим и запрет на хранение данных сайта роняют localStorage —
  // тема при этом уже применена, терять её из-за неудачной записи незачем.
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* не страшно: выбор проживёт до конца сессии */
  }
}

export function readTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* см. applyTheme */
  }
  return 'system';
}
