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
  heading: string;
  blocks: LetterBlock[];
  button?: { label: string; url: string };
  /** Почему человеку пришло это письмо — в подвале. */
  reason: string;
}

const COLOR = {
  brand: '#126b54',
  orange: '#e8762a',
  page: '#f6f5f1',
  card: '#ffffff',
  text: '#1d2320',
  muted: '#5d6661',
  border: '#e3e1da',
  soft: '#e4f1ec',
} as const;

const FONT = `-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
const DISPLAY = `'Unbounded', ${FONT}`;

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

const P_STYLE = `margin:0 0 16px;font:15px/1.6 ${FONT};color:${COLOR.text};`;

function blockHtml(block: LetterBlock): string {
  switch (block.kind) {
    case 'p':
      return `<p class="t" style="${P_STYLE}">${escapeHtml(block.text)}</p>`;
    case 'note':
      return `<p class="m" style="margin:0 0 16px;font:13px/1.55 ${FONT};color:${COLOR.muted};">${escapeHtml(block.text)}</p>`;
    case 'list':
      return `<ul class="t" style="margin:0 0 16px;padding-left:20px;font:15px/1.6 ${FONT};color:${COLOR.text};">${block.items
        .map((item) => `<li style="margin:0 0 6px;">${escapeHtml(item)}</li>`)
        .join('')}</ul>`;
    case 'facts':
      return `<table role="presentation" class="soft" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border-collapse:separate;background:${COLOR.soft};border-radius:10px;">${block.rows
        .map(
          ([label, value]) =>
            `<tr><td class="m" style="padding:8px 14px;font:13px/1.4 ${FONT};color:${COLOR.muted};width:40%;">${escapeHtml(label)}</td><td class="t" style="padding:8px 14px;font:600 14px/1.4 ${FONT};color:${COLOR.text};">${escapeHtml(value)}</td></tr>`,
        )
        .join('')}</table>`;
    case 'markup':
      return block.blocks
        .map((item) =>
          item.kind === 'paragraph'
            ? `<p class="t" style="${P_STYLE}">${item.spans.map(spanHtml).join('')}</p>`
            : `<ul class="t" style="margin:0 0 16px;padding-left:20px;font:15px/1.6 ${FONT};color:${COLOR.text};">${item.items
                .map((spans) => `<li style="margin:0 0 6px;">${spans.map(spanHtml).join('')}</li>`)
                .join('')}</ul>`,
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

/** Знак «Стол» в шапке — тот же рисунок, что значок сайта. */
function header(ctx: LetterContext): string {
  return `<tr><td style="padding:28px 32px 8px;">
  <a href="${safeUrl(ctx.webOrigin)}" style="text-decoration:none;">
    <img src="${safeUrl(`${ctx.webOrigin}/icons/icon-192.png`)}" width="36" height="36" alt="КНТ" style="display:inline-block;vertical-align:middle;border:0;border-radius:8px;">
    <span class="t" style="display:inline-block;vertical-align:middle;margin-left:10px;font:700 18px/1 ${DISPLAY};color:${COLOR.text};letter-spacing:0.02em;">КНТ</span>
  </a>
</td></tr>`;
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;"><tr><td style="border-radius:10px;background:${COLOR.brand};">
  <a href="${escapeHtml(safeUrl(url))}" style="display:inline-block;padding:13px 24px;font:600 15px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

function footer(layout: LetterLayout, ctx: LetterContext): string {
  const unsubscribe = ctx.unsubscribeUrl
    ? `<br><a href="${escapeHtml(safeUrl(ctx.unsubscribeUrl))}" class="m" style="color:${COLOR.muted};text-decoration:underline;">Отписаться от рассылки</a>`
    : '';

  return `<tr><td class="m" style="padding:0 32px 28px;font:12px/1.6 ${FONT};color:${COLOR.muted};">
  ${escapeHtml(layout.reason)}<br>
  КНТ — клубы настольного тенниса · <a href="${safeUrl(ctx.webOrigin)}" class="m" style="color:${COLOR.muted};">${escapeHtml(ctx.webOrigin.replace(/^https?:\/\//, ''))}</a><br>
  Оператор: ${escapeHtml(ctx.operator ?? 'уточняется')}${unsubscribe}
</td></tr>`;
}

const DARK_STYLE = `
@media (prefers-color-scheme: dark) {
  body, .page { background:#141816 !important; }
  .card { background:#1c211f !important; border-color:#2d3431 !important; }
  .t { color:#e8ece9 !important; }
  .m { color:#a8b1ac !important; }
  .soft { background:#1f3a31 !important; }
  .rule { border-color:#2d3431 !important; }
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
<style>${DARK_STYLE}</style>
</head>
<body class="page" style="margin:0;padding:0;background:${COLOR.page};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(layout.preheader)}</span>
<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.page};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${COLOR.card};border:1px solid ${COLOR.border};border-radius:16px;border-collapse:separate;">
${header(ctx)}
<tr><td style="padding:12px 32px 4px;">
<div style="height:4px;width:44px;background:${COLOR.orange};border-radius:2px;margin:0 0 18px;"></div>
<h1 class="t" style="margin:0 0 18px;font:700 22px/1.3 ${DISPLAY};color:${COLOR.text};">${escapeHtml(layout.heading)}</h1>
${body}
${layout.button ? button(layout.button.label, layout.button.url) : ''}
</td></tr>
<tr><td style="padding:0 32px;"><div class="rule" style="border-top:1px solid ${COLOR.border};margin:4px 0 18px;"></div></td></tr>
${footer(layout, ctx)}
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    layout.heading,
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
          blocks: [
            { kind: 'p', text: greeting(p.name) },
            {
              kind: 'p',
              text: 'Ваша учётная запись готова: один аккаунт на все клубы настольного тенниса — записи на тренировки и турниры, аренда столов, абонементы.',
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
          heading: 'Новый пароль',
          blocks: [
            { kind: 'p', text: greeting(p.name) },
            { kind: 'p', text: 'Кто-то — надеемся, вы — попросил восстановить пароль от КНТ. Нажмите кнопку и задайте новый.' },
            { kind: 'note', text: 'Ссылка действует один час и только один раз. После смены пароля мы выйдем из учётной записи на всех устройствах.' },
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
          heading: 'Пароль изменён',
          blocks: [
            { kind: 'p', text: greeting(p.name) },
            { kind: 'p', text: `Пароль от вашей учётной записи КНТ изменён ${dateIn(p.at, p.timezone, true)}. Все прежние входы закрыты.` },
            { kind: 'note', text: 'Если пароль меняли не вы, сразу восстановите его по ссылке ниже и напишите в клуб.' },
          ],
          button: { label: 'Восстановить пароль', url: `${site}/forgot-password` },
          reason: 'Письмо о безопасности учётной записи — такие приходят всегда.',
        },
      };
    }

    case 'APPLICATION_RECEIVED': {
      const p = payload as ApplicationReceivedPayload;
      return {
        subject: `Заявка клуба «${p.clubName}» получена`,
        layout: {
          preheader: 'Свяжемся в течение рабочего дня и подключим клуб.',
          heading: 'Заявка получена',
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
          heading: 'Ваш клуб заведён',
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
          heading: invoice ? 'Счёт на оплату' : 'Акт оказанных услуг',
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
          heading: p.title,
          blocks: [{ kind: 'note', text: SECTION_LABEL[p.section] }, { kind: 'markup', blocks: parseMarkup(p.body) }],
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
          heading: p.trial ? 'Пробный период скоро кончится' : 'Подписка скоро кончится',
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
          heading: 'Подписка не оплачена',
          blocks: [
            { kind: 'facts', rows: [...facts, ['Работает до', end]] },
            { kind: 'p', text: 'После этой даты доступ закроется, а все будущие записи клуба отменятся с полным возвратом клиентам. Оплата сразу всё сохранит.' },
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
          heading: 'Доступ приостановлен',
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
          heading: 'Подписка оплачена',
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
