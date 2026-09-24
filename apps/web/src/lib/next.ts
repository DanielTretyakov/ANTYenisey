/**
 * Куда вернуть человека после входа или регистрации.
 *
 * Только путь этого же сайта: `/clubs/...`, но не `//evil.example` и не
 * `/\evil.example` — браузер читает оба как адрес чужого сайта, и форма входа
 * стала бы переходником для фишинга: «войдите на настоящем сайте, а потом
 * мы отправим вас куда скажем».
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return null;
  }

  return value;
}

/** Ссылка на вход с возвратом на текущую или указанную страницу. */
export function loginHref(next?: string | null): string {
  const target = safeNext(next ?? currentPath());

  return target ? `/login?next=${encodeURIComponent(target)}` : '/login';
}

/** То же для регистрации: `club` сохраняется, если был. */
export function registerHref(next: string | null, club?: string | null): string {
  const params = new URLSearchParams();

  if (club) params.set('club', club);
  if (safeNext(next)) params.set('next', next!);

  const query = params.toString();

  return query ? `/register?${query}` : '/register';
}

function currentPath(): string | null {
  return typeof window === 'undefined' ? null : window.location.pathname + window.location.search;
}
