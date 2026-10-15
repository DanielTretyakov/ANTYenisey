/**
 * Быстрая помощь (решение владельца от 15.10.2026): какие статьи справки
 * касаются открытой страницы. Кнопка «?» в правом нижнем углу показывает
 * ровно их — не всю справку.
 *
 * Чистый модуль, под тестами: правило — путь страницы, без клуба (клуб едет
 * участком адреса и на выбор статей не влияет). Первое совпавшее правило —
 * самое точное, поэтому подстраницы клуба стоят раньше его страницы.
 * Меняется страница или статья — правится эта таблица.
 */

interface Rule {
  /** Путь без кода клуба: `/clubs/*` вместо `/clubs/yenisey`. */
  match: (path: string) => boolean;
  slugs: string[];
}

/** Подстраница клуба: `/clubs/:slug/<rest>` или глубже. */
const club = (rest: string) => (path: string) => path === `/clubs/*${rest}` || path.startsWith(`/clubs/*${rest}/`);
const exact = (target: string) => (path: string) => path === target;
const under = (target: string) => (path: string) => path === target || path.startsWith(`${target}/`);

const RULES: Rule[] = [
  // Рабочее место клуба — те же статьи, что ссылка «Как это работает?» в колонке, и соседние.
  { match: club('/desk'), slugs: ['smena', 'otmetka-prisutstviya', 'otmena-provedeniya', 'lyudi-kluba', 'abonementy-u-stojki'] },
  { match: club('/schedule'), slugs: ['raspisanie-zala', 'otmena-provedeniya', 'raspisanie-personala', 'nastrojki-v-polnoch'] },
  { match: club('/staff'), slugs: ['raspisanie-personala', 'roli-sotrudnikov', 'smena'] },
  { match: club('/subscriptions'), slugs: ['abonementy-u-stojki', 'abonement', 'lyudi-kluba'] },
  { match: club('/posts'), slugs: ['lenta-kluba'] },
  { match: club('/people'), slugs: ['lyudi-kluba', 'roli-sotrudnikov', 'rebyonok-uchyotka', 'profil-igroka'] },
  { match: club('/settings'), slugs: ['nastrojki-v-polnoch', 'otkrytie-kluba', 'roli-sotrudnikov', 'podpiska-knt'] },
  { match: club('/billing'), slugs: ['podpiska-knt'] },
  { match: club('/catalog'), slugs: ['otmena-provedeniya', 'raspisanie-zala'] },
  // Тренер.
  { match: club('/coach/groups'), slugs: ['moi-gruppy', 'statistika-trenera', 'sparring'] },
  { match: club('/coach'), slugs: ['kartochka-trenera', 'moi-gruppy', 'sparring'] },
  // Игрок в клубе.
  { match: club('/booking'), slugs: ['bron-stola', 'otmena-zapisi', 'abonement', 'sparring'] },
  { match: club('/rating'), slugs: ['rejting', 'profil-igroka'] },
  { match: club('/news'), slugs: ['lenta-kluba', 'uvedomleniya'] },
  {
    match: exact('/clubs/*'),
    slugs: ['zapis-na-zanyatie', 'bron-stola', 'otmena-zapisi', 'abonement', 'zapis-za-rebyonka', 'rejting'],
  },
  // Платформа.
  { match: exact('/'), slugs: ['najti-klub', 'odin-akkaunt', 'zapis-na-zanyatie', 'moi-trenery', 'uvedomleniya'] },
  { match: under('/my-bookings'), slugs: ['otmena-zapisi', 'zapis-za-rebyonka', 'abonement', 'uvedomleniya'] },
  { match: exact('/cabinet/edit/notifications'), slugs: ['uvedomleniya'] },
  { match: exact('/cabinet/edit/clubs'), slugs: ['najti-klub', 'moi-trenery', 'rebyonok-uchyotka', 'rebyonku-14'] },
  { match: under('/cabinet'), slugs: ['profil-igroka', 'odin-akkaunt', 'rebyonok-uchyotka', 'abonement', 'uvedomleniya'] },
  { match: under('/coaches'), slugs: ['moi-trenery', 'kartochka-trenera', 'zapis-na-zanyatie'] },
  { match: under('/players'), slugs: ['profil-igroka', 'rejting'] },
  { match: under('/for-clubs'), slugs: ['otkrytie-kluba', 'podpiska-knt', 'roli-sotrudnikov'] },
  { match: under('/platform'), slugs: ['otkrytie-kluba', 'podpiska-knt'] },
  { match: exact('/register'), slugs: ['odin-akkaunt', 'rebyonok-uchyotka'] },
  { match: exact('/login'), slugs: ['odin-akkaunt'] },
];

/** Если у страницы своих статей нет — с чего начинают все. */
const FALLBACK = ['odin-akkaunt', 'najti-klub', 'zapis-na-zanyatie'];

/**
 * Где быстрой помощи нет: в самой справке она повторяла бы страницу, а
 * документ для печати (счёт, акт) — не экран.
 */
export function quickHelpHidden(pathname: string): boolean {
  return pathname === '/help' || pathname.startsWith('/help/') || /^\/clubs\/[^/]+\/billing\/documents\//.test(pathname);
}

/** Статьи справки, которые касаются страницы, — по порядку важности. */
export function pageHelpSlugs(pathname: string): string[] {
  const path = normalizePath(pathname);
  return RULES.find((rule) => rule.match(path))?.slugs ?? FALLBACK;
}

/** `/clubs/yenisey/booking/` → `/clubs/*\/booking`. */
export function normalizePath(pathname: string): string {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return trimmed.replace(/^\/clubs\/[^/]+/, '/clubs/*');
}
