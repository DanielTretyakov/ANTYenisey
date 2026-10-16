import { formatRubles, parseMarkup, plainText, type MarkupBlock, type MarkupSpan } from '@yenisey/types';

/**
 * Письма платформы (решения владельца от 12.10.2026): вёрстка и все шаблоны
 * одним модулем — его тесты идут через `node --test`, а относительных
 * импортов такому модулю нельзя (см. CLAUDE.md).
 *
 * Вёрстка табличная и со стилями в атрибутах: почтовики (Gmail, Яндекс,
 * Mail.ru, Outlook) режут `<style>` по-разному, и надёжно держится только
 * встроенное. Тёмная тема — `@media (prefers-color-scheme: dark)` в
 * `<style>`: где его не понимают, письмо остаётся светлым, но читаемым. У
 * каждого письма есть и текстовая версия — её показывают простые клиенты и
 * по ней спам-фильтры судят о честности письма.
 *
 * Шаблон — чистая функция «данные → тема, html, текст», как `render.ts` у
 * MAX: текст собирается при отправке, а не при постановке в очередь.
 */

/** Что знает письмо о месте, откуда оно. */
export interface LetterContext {
  /** Адрес сайта без косой черты в конце — для ссылок и картинки знака. */
  webOrigin: string;
  /** Оператор платформы для подвала: «ИП …, ИНН …». Пусто — «уточняется». */
  operator: string | null;
  /** Ссылка отписки — только у рассылок. */
  unsubscribeUrl?: string;
}

export interface RenderedLetter {
  subject: string;
  html: string;
  text: string;
}

/**
 * Кому и при каком условии письмо можно отправить:
 * - `any` — служебное о самой учётке: подтверждение, восстановление, смена
 *   пароля; уходит и на неподтверждённую почту;
 * - `verified` — служебное по делу: подписка, счета; только на подтверждённую;
 * - `news` — рассылка: подтверждённая почта, согласие, нет отписки.
 */
export type LetterAudience = 'any' | 'verified' | 'news';

// ---------------------------------------------------------------------------
// Вёрстка
// ---------------------------------------------------------------------------

/** Кусок письма: абзац, список, «ключ — значение», заметка или разметка новости. */
export type LetterBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'facts'; rows: [string, string][] }
  | { kind: 'note'; text: string }
  | { kind: 'markup'; blocks: MarkupBlock[] };

export interface LetterLayout {
  /** Строка-превью в списке писем — рядом с темой. */
  preheader: string;
  /** Надпись над заголовком обложки; пусто — «КНТ · клубы настольного тенниса». */
  eyebrow?: string;
  heading: string;
  /** Подзаголовок обложки — шрифтом заголовков, как строка-манифест на сайте. */
  lead?: string;
  /** Факты пилюлями на обложке — как «3 клуба · 1 город» у поиска клубов. */
  pills?: string[];
  blocks: LetterBlock[];
  button?: { label: string; url: string };
  /** Почему человеку пришло это письмо — в подвале. */
  reason: string;
}

/**
 * Цвета — из токенов сайта (`apps/web/src/styles/tokens.css`): изумруд
 * `--brand-600`, мяч `--ball`, плоскость обложки — изумруд, притемнённый к
 * `--ink-950` пополам, как шапка поиска клубов на стартовой.
 */
const COLOR = {
  brand: '#126b54',
  brandLight: '#35a588',
  ball: '#e8762a',
  hero: '#0e3c30',
  page: '#f6f5f1',
  card: '#ffffff',
  text: '#1d2320',
  muted: '#5d6661',
  subtle: '#858c88',
  border: '#e3e1da',
  soft: '#e4f1ec',
  sunken: '#f1efe9',
} as const;

/** Onest и Unbounded — шрифты сайта; где почтовик их не подгрузит — системные. */
const FONT = `'Onest', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
const DISPLAY = `'Unbounded', 'Onest', -apple-system, 'Segoe UI', Roboto, Arial, sans-serif`;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Ссылка в письме — только http(s): `javascript:` в атрибуте выполнился бы. */
export function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : '#';
}

function spanHtml(span: MarkupSpan): string {
  let html = escapeHtml(span.text);
  if (span.bold) html = `<strong>${html}</strong>`;
  if (span.italic) html = `<em>${html}</em>`;
  if (span.underline) html = `<u>${html}</u>`;
  return html;
}

const P_STYLE = `margin:0 0 16px;font:16px/1.6 ${FONT};color:${COLOR.text};`;
const UL_STYLE = `margin:0 0 18px;padding:0;list-style:none;font:15px/1.55 ${FONT};color:${COLOR.text};`;

/** Пункт списка — с мячом вместо точки, как знак «Стол». */
function listItem(html: string): string {
  return `<li style="margin:0 0 10px;padding-left:22px;position:relative;"><span style="position:absolute;left:2px;top:8px;width:8px;height:8px;border-radius:50%;background:${COLOR.ball};display:inline-block;"></span>${html}</li>`;
}

function blockHtml(block: LetterBlock): string {
  switch (block.kind) {
    case 'p':
      return `<p class="t" style="${P_STYLE}">${escapeHtml(block.text)}</p>`;
    case 'note':
      return `<p class="m" style="margin:0 0 18px;font:14px/1.55 ${FONT};color:${COLOR.muted};">${escapeHtml(block.text)}</p>`;
    case 'list':
      return `<ul class="t" style="${UL_STYLE}">${block.items.map((item) => listItem(escapeHtml(item))).join('')}</ul>`;
    case 'facts':
      return `<table role="presentation" class="soft" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:separate;background:${COLOR.soft};border-radius:14px;">${block.rows
        .map(
          ([label, value], index) =>
            `<tr><td class="m" style="padding:${index === 0 ? 14 : 6}px 18px ${index === block.rows.length - 1 ? 14 : 6}px;font:14px/1.4 ${FONT};color:${COLOR.muted};width:40%;">${escapeHtml(label)}</td><td class="t" style="padding:${index === 0 ? 14 : 6}px 18px ${index === block.rows.length - 1 ? 14 : 6}px;font:600 15px/1.4 ${FONT};color:${COLOR.text};">${escapeHtml(value)}</td></tr>`,
        )
        .join('')}</table>`;
    case 'markup':
      return block.blocks
        .map((item) =>
          item.kind === 'paragraph'
            ? `<p class="t" style="${P_STYLE}">${item.spans.map(spanHtml).join('')}</p>`
            : `<ul class="t" style="${UL_STYLE}">${item.items.map((spans) => listItem(spans.map(spanHtml).join(''))).join('')}</ul>`,
        )
        .join('');
  }
}

function blockText(block: LetterBlock): string {
  switch (block.kind) {
    case 'p':
    case 'note':
      return block.text;
    case 'list':
      return block.items.map((item) => `— ${item}`).join('\n');
    case 'facts':
      return block.rows.map(([label, value]) => `${label}: ${value}`).join('\n');
    case 'markup':
      return block.blocks
        .map((item) =>
          item.kind === 'paragraph'
            ? item.spans.map((span) => span.text).join('')
            : item.items.map((spans) => `— ${spans.map((span) => span.text).join('')}`).join('\n'),
        )
        .join('\n\n');
  }
}

/**
 * Обложка — та же плоскость, что шапка поиска клубов на стартовой: изумруд,
 * притемнённый к чернилам, светлое пятно справа сверху и русло реки с горами
 * (`/mail/hero.png`, `scripts/mail-hero.ts`). Картинкой-фоном: CSS-градиенты
 * многие почтовики выбрасывают. Где картинки выключены, остаётся сплошной
 * `COLOR.hero`, и белый текст на нём читается.
 */
function hero(layout: LetterLayout, ctx: LetterContext): string {
  const image = safeUrl(`${ctx.webOrigin}/mail/hero.png`);
  const pills = (layout.pills ?? [])
    .map(
      (pill) =>
        `<span style="display:inline-block;margin:0 6px 6px 0;padding:6px 13px;border-radius:999px;background:rgba(255,255,255,0.15);font:500 13px/1.2 ${FONT};color:#ffffff;">${escapeHtml(pill)}</span>`,
    )
    .join('');

  return `<tr><td class="hero" bgcolor="${COLOR.hero}" background="${image}" style="background:${COLOR.hero} url('${image}') right top / cover no-repeat;background-color:${COLOR.hero};border-radius:22px 22px 0 0;padding:30px 32px 34px;">
  <a href="${safeUrl(ctx.webOrigin)}" style="text-decoration:none;">
    <img src="${safeUrl(`${ctx.webOrigin}/icons/icon-192.png`)}" width="40" height="40" alt="КНТ" style="display:inline-block;vertical-align:middle;border:0;border-radius:10px;">
    <span style="display:inline-block;vertical-align:middle;margin-left:10px;font:700 19px/1 ${DISPLAY};color:#ffffff;letter-spacing:0.02em;">КНТ</span>
  </a>
  <p style="margin:30px 0 0;font:600 12px/1.4 ${FONT};letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.75);"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${COLOR.ball};margin-right:8px;vertical-align:1px;"></span>${escapeHtml(layout.eyebrow ?? 'КНТ · клубы настольного тенниса')}</p>
  <h1 style="margin:12px 0 0;font:700 30px/1.08 ${DISPLAY};color:#ffffff;letter-spacing:-0.01em;">${escapeHtml(layout.heading)}</h1>
  ${layout.lead ? `<p style="margin:14px 0 0;font:500 16px/1.4 ${DISPLAY};color:rgba(255,255,255,0.9);">${escapeHtml(layout.lead)}</p>` : ''}
  ${pills ? `<div style="margin-top:18px;">${pills}</div>` : ''}
</td></tr>`;
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:12px;background:${COLOR.brand};">
  <a href="${escapeHtml(safeUrl(url))}" style="display:inline-block;padding:15px 26px;font:600 16px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:12px;">${escapeHtml(label)}&nbsp;&nbsp;→</a>
</td></tr></table>`;
}

function footer(layout: LetterLayout, ctx: LetterContext): string {
  const unsubscribe = ctx.unsubscribeUrl
    ? `<br><a href="${escapeHtml(safeUrl(ctx.unsubscribeUrl))}" class="m" style="color:${COLOR.muted};text-decoration:underline;">Отписаться от рассылки</a>`
    : '';

  return `<tr><td class="foot" style="background:${COLOR.sunken};border-radius:0 0 22px 22px;padding:22px 32px 26px;">
  <p class="m" style="margin:0 0 10px;font:13px/1.6 ${FONT};color:${COLOR.muted};">${escapeHtml(layout.reason)}</p>
  <p class="m" style="margin:0;font:12px/1.6 ${FONT};color:${COLOR.subtle};">
    <span class="t" style="font:700 12px/1 ${DISPLAY};color:${COLOR.text};letter-spacing:0.04em;">КНТ</span>&nbsp; клубы настольного тенниса · <a href="${safeUrl(ctx.webOrigin)}" class="m" style="color:${COLOR.muted};">${escapeHtml(ctx.webOrigin.replace(/^https?:\/\//, ''))}</a><br>
    Оператор: ${escapeHtml(ctx.operator ?? 'уточняется')}${unsubscribe}
  </p>
</td></tr>`;
}

const DARK_STYLE = `
@media (prefers-color-scheme: dark) {
  body, .page { background:#0b0d0c !important; }
  .card { background:#161a19 !important; border-color:#2d3431 !important; }
  .foot { background:#111413 !important; }
  .t { color:#e8ece9 !important; }
  .m { color:#a8b1ac !important; }
  .soft { background:#1f3a31 !important; }
}`;

export function renderLayout(layout: LetterLayout, ctx: LetterContext): { html: string; text: string } {
  const body = layout.blocks.map(blockHtml).join('\n');

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(layout.heading)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600&amp;family=Unbounded:wght@500;700&amp;display=swap">
<style>${DARK_STYLE}</style>
</head>
<body class="page" style="margin:0;padding:0;background:${COLOR.page};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(layout.preheader)}</span>
<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.page};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${COLOR.card};border:1px solid ${COLOR.border};border-radius:22px;border-collapse:separate;">
${hero(layout, ctx)}
<tr><td style="padding:30px 32px 6px;">
${body}
${layout.button ? button(layout.button.label, layout.button.url) : ''}
</td></tr>
${footer(layout, ctx)}
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    layout.heading,
    ...(layout.lead ? [layout.lead] : []),
    '',
    ...layout.blocks.map(blockText).flatMap((chunk) => [chunk, '']),
    ...(layout.button ? [`${layout.button.label}: ${layout.button.url}`, ''] : []),
    '—',
    layout.reason,
    `КНТ — клубы настольного тенниса · ${ctx.webOrigin}`,
    `Оператор: ${ctx.operator ?? 'уточняется'}`,
    ...(ctx.unsubscribeUrl ? [`Отписаться от рассылки: ${ctx.unsubscribeUrl}`] : []),
  ].join('\n');

  return { html, text };
}

// ---------------------------------------------------------------------------
// Шаблоны
// ---------------------------------------------------------------------------

export interface VerifyEmailPayload {
  name: string;
  /** Сырой токен ссылки — после отправки отправщик стирает его из очереди. */
  token: string;
}

export interface PasswordResetPayload {
  name: string;
  token: string;
}

export interface PasswordChangedPayload {
  name: string;
  /** Момент смены, ISO. */
  at: string;
  timezone: string;
}

export interface ApplicationReceivedPayload {
  contactName: string;
  clubName: string;
}

export interface ClubCreatedPayload {
  name: string;
  clubName: string;
  slug: string;
}

export interface SubscriptionLetterPayload {
  variant: 'REMINDER' | 'PAST_DUE' | 'SUSPENDED' | 'PAID';
  club: string;
  slug: string;
  timezone: string;
  until: string;
  trial?: boolean;
  plan?: string | null;
  amount?: number | null;
  cancelled?: number;
  autoCharge?: boolean;
}

export interface BillingDocumentPayload {
  kind: 'INVOICE' | 'ACT';
  club: string;
  slug: string;
  documentId: string;
  number: string;
  amount: number;
  /** У акта — «сентябрь 2026». */
  period?: string | null;
}

export interface NewsLetterPayload {
  newsId: string;
  title: string;
  body: string;
  section: 'GENERAL' | 'UPDATES' | 'CLUBS';
}

export type LetterTemplate =
  | 'VERIFY_EMAIL'
  | 'PASSWORD_RESET'
  | 'PASSWORD_CHANGED'
  | 'APPLICATION_RECEIVED'
  | 'CLUB_CREATED'
  | 'SUBSCRIPTION'
  | 'BILLING_DOCUMENT'
  | 'NEWS';

/** Кому и при каком условии уходит письмо этого шаблона. */
export const LETTER_AUDIENCE: Record<LetterTemplate, LetterAudience> = {
  VERIFY_EMAIL: 'any',
  PASSWORD_RESET: 'any',
  PASSWORD_CHANGED: 'any',
  // Заявителю — на ту почту, что он сам вписал минуту назад.
  APPLICATION_RECEIVED: 'any',
  // Руководителю — на почту учётки, которую владелец платформы назвал сам.
  CLUB_CREATED: 'any',
  SUBSCRIPTION: 'verified',
  BILLING_DOCUMENT: 'verified',
  NEWS: 'news',
};

/** Поля, которые после отправки стираются из очереди: ссылку-ключ хранить незачем. */
export const SECRET_FIELDS = ['token'] as const;

function firstName(name: string): string {
  // «Иванов Пётр Сергеевич» → «Пётр»; одно слово — оно и есть.
  const parts = name.trim().split(/\s+/);
  return parts[1] ?? parts[0] ?? '';
}

function greeting(name: string): string {
  const first = firstName(name);
  return first ? `Здравствуйте, ${first}!` : 'Здравствуйте!';
}

function dateIn(iso: string, timezone: string, withTime = false): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(iso));
}

const SECTION_LABEL: Record<NewsLetterPayload['section'], string> = {
  GENERAL: 'Новости КНТ',
  UPDATES: 'Обновления КНТ',
  CLUBS: 'КНТ для клубов',
};

function letterLayout(template: LetterTemplate, payload: unknown, ctx: LetterContext): { subject: string; layout: LetterLayout } {
  const site = ctx.webOrigin;

  switch (template) {
    case 'VERIFY_EMAIL': {
      const p = payload as VerifyEmailPayload;
      return {
        subject: 'Подтвердите почту в КНТ',
        layout: {
          preheader: 'Одно нажатие — и почта подтверждена. Ссылка действует двое суток.',
          heading: 'Добро пожаловать в КНТ',
          lead: 'Один аккаунт на все клубы настольного тенниса.',
          pills: ['тренировки', 'турниры', 'свободные столы'],
          blocks: [
            { kind: 'p', text: greeting(p.name) },
            {
              kind: 'p',
              text: 'Аккаунт готов. С ним можно записываться на тренировки и турниры, бронировать столы и пользоваться абонементами в любом клубе КНТ.',
            },
            { kind: 'p', text: 'Подтвердите, что это ваша почта: на неё придут счета клуба, восстановление пароля и новости, если вы их выберете.' },
          ],
          button: { label: 'Подтвердить почту', url: `${site}/verify-email?token=${encodeURIComponent(p.token)}` },
          reason: 'Письмо пришло, потому что с этой почтой зарегистрировались в КНТ. Если это были не вы — просто не нажимайте кнопку.',
        },
      };
    }

    case 'PASSWORD_RESET': {
      const p = payload as PasswordResetPayload;
      return {
        subject: 'Восстановление пароля в КНТ',
        layout: {
          preheader: 'Ссылка для нового пароля действует один час.',
          eyebrow: 'Безопасность аккаунта',
          heading: 'Новый пароль',
          lead: 'Ссылка действует один час.',
          blocks: [
            { kind: 'p', text: greeting(p.name) },
            { kind: 'p', text: 'Кто-то — надеемся, вы — попросил восстановить пароль от КНТ. Нажмите кнопку и задайте новый.' },
            { kind: 'note', text: 'Ссылка действует один час и только один раз. После смены пароля вы выйдете из аккаунта на всех устройствах.' },
          ],
          button: { label: 'Задать новый пароль', url: `${site}/reset-password?token=${encodeURIComponent(p.token)}` },
          reason: 'Если пароль просили не вы, ничего не делайте: старый пароль продолжит работать.',
        },
      };
    }

    case 'PASSWORD_CHANGED': {
      const p = payload as PasswordChangedPayload;
      return {
        subject: 'Пароль в КНТ изменён',
        layout: {
          preheader: 'Если это были не вы — восстановите пароль.',
          eyebrow: 'Безопасность аккаунта',
          heading: 'Пароль изменён',
          lead: 'Если это были вы, ничего делать не нужно.',
          blocks: [
            { kind: 'p', text: greeting(p.name) },
            { kind: 'p', text: `Пароль от вашего аккаунта КНТ изменён ${dateIn(p.at, p.timezone, true)}. На всех устройствах нужно будет войти заново.` },
            { kind: 'note', text: 'Если пароль меняли не вы, сразу восстановите его по ссылке ниже и напишите в клуб.' },
          ],
          button: { label: 'Восстановить пароль', url: `${site}/forgot-password` },
          reason: 'Письмо о безопасности аккаунта — такие приходят всегда.',
        },
      };
    }

    case 'APPLICATION_RECEIVED': {
      const p = payload as ApplicationReceivedPayload;
      return {
        subject: `Заявка клуба «${p.clubName}» получена`,
        layout: {
          preheader: 'Свяжемся в течение рабочего дня и подключим клуб.',
          eyebrow: 'КНТ для клубов',
          heading: 'Заявка получена',
          lead: `Клуб «${p.clubName}» — скоро на КНТ.`,
          pills: ['7 дней бесплатно', 'запись онлайн', 'расписание залов'],
          blocks: [
            { kind: 'p', text: greeting(p.contactName) },
            { kind: 'p', text: `Спасибо за интерес к КНТ. Заявку клуба «${p.clubName}» мы получили.` },
            {
              kind: 'list',
              items: [
                'Свяжемся с вами в течение рабочего дня и ответим на вопросы.',
                'Чтобы клуб завели на вас, зарегистрируйтесь на сайте с этой почтой — это пара минут.',
                'Дальше вы сами настроите залы и столы и откроете клуб; первые 7 дней — бесплатно.',
              ],
            },
          ],
          button: { label: 'Как подключается клуб', url: `${site}/for-clubs` },
          reason: 'Письмо пришло, потому что эту почту указали в заявке на подключение клуба к КНТ.',
        },
      };
    }

    case 'CLUB_CREATED': {
      const p = payload as ClubCreatedPayload;
      return {
        subject: `Клуб «${p.clubName}» заведён в КНТ`,
        layout: {
          preheader: 'Настройте зал и столы и откройте клуб — пробный период начнётся с открытия.',
          eyebrow: 'КНТ для клубов',
          heading: 'Ваш клуб заведён',
          lead: `«${p.clubName}» ждёт открытия.`,
          pills: ['черновик', 'настройки сразу', '7 дней с открытия'],
          blocks: [
            { kind: 'p', text: greeting(p.name) },
            { kind: 'p', text: `Клуб «${p.clubName}» заведён в КНТ, вы — его руководитель. Пока это черновик: в поиске его нет, страницу видят только сотрудники.` },
            {
              kind: 'list',
              items: [
                'Откройте «Настройки» и заведите зал: адрес из подсказок, цены, число столов. В черновике всё применяется сразу.',
                'Добавьте контакты, описание и квадратный логотип.',
                'Нажмите «Открыть клуб» — с этого момента клуб в поиске и идут 7 пробных дней.',
              ],
            },
          ],
          button: { label: 'Перейти к настройкам', url: `${site}/clubs/${encodeURIComponent(p.slug)}/settings` },
          reason: 'Письмо пришло, потому что вас назначили руководителем клуба в КНТ.',
        },
      };
    }

    case 'SUBSCRIPTION':
      return subscriptionLetter(payload as SubscriptionLetterPayload, site);

    case 'BILLING_DOCUMENT': {
      const p = payload as BillingDocumentPayload;
      const invoice = p.kind === 'INVOICE';
      return {
        subject: invoice ? `Счёт № ${p.number} на подписку КНТ — ${p.club}` : `Акт № ${p.number}${p.period ? ` за ${p.period}` : ''} — ${p.club}`,
        layout: {
          preheader: invoice ? `К оплате ${formatRubles(p.amount)}.` : `Сумма ${formatRubles(p.amount)}.`,
          eyebrow: 'Подписка на КНТ',
          heading: invoice ? 'Счёт на оплату' : 'Акт оказанных услуг',
          lead: p.club,
          pills: [`№ ${p.number}`, formatRubles(p.amount), ...(p.period ? [p.period] : [])],
          blocks: [
            {
              kind: 'facts',
              rows: [
                ['Клуб', p.club],
                [invoice ? 'Счёт' : 'Акт', `№ ${p.number}`],
                ...(p.period ? ([['Период', p.period]] as [string, string][]) : []),
                ['Сумма', formatRubles(p.amount)],
              ],
            },
            {
              kind: 'p',
              text: invoice
                ? 'Документ открывается по кнопке — его можно распечатать или сохранить в PDF. После оплаты подписка продлится автоматически, как только платёж отметят.'
                : 'Документ открывается по кнопке — его можно распечатать или сохранить в PDF для бухгалтерии.',
            },
          ],
          button: {
            label: invoice ? 'Открыть счёт' : 'Открыть акт',
            url: `${site}/clubs/${encodeURIComponent(p.slug)}/billing/documents/${p.kind}/${encodeURIComponent(p.documentId)}`,
          },
          reason: 'Письмо руководителю клуба о подписке на КНТ — такие приходят всегда.',
        },
      };
    }

    case 'NEWS': {
      const p = payload as NewsLetterPayload;
      const excerpt = plainText(p.body).replace(/\s+/g, ' ').slice(0, 140);
      return {
        subject: p.title,
        layout: {
          preheader: excerpt,
          eyebrow: SECTION_LABEL[p.section],
          heading: p.title,
          blocks: [{ kind: 'markup', blocks: parseMarkup(p.body) }],
          button: { label: 'Читать на сайте', url: `${site}/news/${encodeURIComponent(p.newsId)}` },
          reason:
            p.section === 'CLUBS'
              ? 'Письмо пришло, потому что вы согласились получать новости КНТ для клубов.'
              : 'Письмо пришло, потому что вы согласились получать новости КНТ на почту.',
        },
      };
    }
  }
}

/** Подписка клуба на КНТ: напоминание, просрочка, приостановка, оплата. */
function subscriptionLetter(p: SubscriptionLetterPayload, site: string): { subject: string; layout: LetterLayout } {
  const end = dateIn(p.until, p.timezone);
  const facts: [string, string][] = [['Клуб', p.club]];
  if (p.plan) facts.push(['Тариф', p.plan]);
  if (p.amount) facts.push(['Сумма', formatRubles(p.amount)]);
  const billing = { label: p.variant === 'PAID' || p.variant === 'REMINDER' ? 'Подписка на КНТ' : 'Оплатить подписку', url: `${site}/clubs/${encodeURIComponent(p.slug)}/billing` };
  const reason = 'Письмо руководителю клуба о подписке на КНТ — такие приходят всегда.';

  switch (p.variant) {
    case 'REMINDER':
      return {
        subject: p.trial ? `Пробный период КНТ кончается ${end}` : `Подписка на КНТ кончается ${end}`,
        layout: {
          preheader: `${p.club}: продлите подписку, чтобы клуб работал дальше.`,
          eyebrow: 'Подписка на КНТ',
          heading: p.trial ? 'Пробный период скоро кончится' : 'Подписка скоро кончится',
          lead: p.club,
          pills: [`до ${end}`],
          blocks: [
            { kind: 'facts', rows: [...facts, ['Действует до', end]] },
            {
              kind: 'p',
              text: p.autoCharge
                ? 'Продлим автоматически: спишем оплату с сохранённой карты. Ничего делать не нужно.'
                : 'Выберите тариф и оплатите картой или выставьте счёт на юрлицо — клуб продолжит работать без перерыва.',
            },
          ],
          button: billing,
          reason,
        },
      };
    case 'PAST_DUE':
      return {
        subject: `Подписка на КНТ не оплачена — ${p.club}`,
        layout: {
          preheader: `Клуб работает до ${end}.`,
          eyebrow: 'Подписка на КНТ',
          heading: 'Подписка не оплачена',
          lead: p.club,
          pills: [`работает до ${end}`],
          blocks: [
            { kind: 'facts', rows: [...facts, ['Работает до', end]] },
            { kind: 'p', text: 'После этой даты доступ закроется, а все будущие записи клуба отменятся с полным возвратом клиентам. Если оплатить раньше, клуб продолжит работать без перерыва.' },
          ],
          button: billing,
          reason,
        },
      };
    case 'SUSPENDED':
      return {
        subject: `Доступ клуба к КНТ приостановлен — ${p.club}`,
        layout: {
          preheader: 'Оплата подписки вернёт доступ сразу.',
          eyebrow: 'Подписка на КНТ',
          heading: 'Доступ приостановлен',
          lead: p.club,
          blocks: [
            { kind: 'facts', rows: [...facts, ...(p.cancelled ? ([['Отменено записей', String(p.cancelled)]] as [string, string][]) : [])] },
            { kind: 'p', text: 'Клуб не принимает записи и брони, будущие записи отменены с полным возвратом. Оплата подписки вернёт доступ сразу.' },
          ],
          button: billing,
          reason,
        },
      };
    case 'PAID':
      return {
        subject: `Подписка на КНТ оплачена — ${p.club}`,
        layout: {
          preheader: `Доступ до ${end}. Спасибо!`,
          eyebrow: 'Подписка на КНТ',
          heading: 'Подписка оплачена',
          lead: p.club,
          pills: [`доступ до ${end}`, ...(p.amount ? [formatRubles(p.amount)] : [])],
          blocks: [{ kind: 'facts', rows: [...facts, ['Доступ до', end]] }, { kind: 'p', text: 'Спасибо! Акт придёт отдельным письмом в начале следующего месяца.' }],
          button: billing,
          reason,
        },
      };
  }
}

export function renderLetter(template: LetterTemplate, payload: unknown, ctx: LetterContext): RenderedLetter {
  const { subject, layout } = letterLayout(template, payload, ctx);
  const { html, text } = renderLayout(layout, ctx);

  return { subject, html, text };
}
