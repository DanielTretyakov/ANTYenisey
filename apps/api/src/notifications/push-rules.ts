/**
 * Уведомления в браузер: как сообщение становится уведомлением и что значит
 * ответ службы push.
 *
 * Чистый модуль без относительных импортов — гоняется `node --test`.
 */

/** То, что получает service worker (apps/web/public/push-sw.js). */
export interface PushPayload {
  title: string;
  body: string;
  /** Куда вести по нажатию: кнопка сообщения или главная сайта. */
  url: string;
  /** Одинаковый tag заменяет прежнее уведомление, а не копит их стопкой. */
  tag: string;
}

/** Уведомление браузера показывает немного: длинное обрезается им самим, и некрасиво. */
const BODY_LIMIT = 1000;

/**
 * Текст сообщения → уведомление браузера.
 *
 * Первая строка — заголовок, остальное — текст: во всех шаблонах первая
 * строка и есть суть («Вы записаны», «Сводка клуба…»). Однострочное
 * сообщение идёт текстом под заголовком «Енисей». Пустые строки-отступы
 * между блоками в уведомлении не нужны — там нет места.
 */
export function toPushPayload(
  message: { text: string; link?: { url: string } },
  context: { webOrigin: string; tag: string },
): PushPayload {
  const [first = '', ...rest] = message.text.split('\n');
  const body = rest.filter((line) => line.trim() !== '').join('\n');
  const single = body === '';

  return {
    title: single ? 'Енисей' : first,
    body: truncate(single ? first : body, BODY_LIMIT),
    url: message.link?.url ?? context.webOrigin,
    tag: context.tag,
  };
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** Чем кончилась отправка на одну подписку. */
export type PushOutcome =
  | { kind: 'sent' }
  | { kind: 'gone'; error: string }
  | { kind: 'retry'; error: string }
  | { kind: 'fatal'; error: string };

/**
 * Ответ службы push → что делать с подпиской и строкой очереди.
 *
 * 404 и 410 — подписки больше нет: браузер её отозвал или человек запретил
 * уведомления. 429 и 5xx — служба занята, повторим. 0 — сеть. Прочие 4xx —
 * ошибка в нашем запросе (403 — чужой ключ VAPID, 413 — слишком длинно):
 * повтор даст то же.
 */
export function classifyPush(status: number, body = ''): PushOutcome {
  if (status >= 200 && status < 300) {
    return { kind: 'sent' };
  }

  const error = `${status}: ${body || 'нет ответа'}`.slice(0, 1000);

  if (status === 404 || status === 410) {
    return { kind: 'gone', error };
  }

  if (status === 0 || status === 429 || status >= 500) {
    return { kind: 'retry', error };
  }

  return { kind: 'fatal', error };
}

/** Итог строки очереди по всем подпискам человека. */
export type PushRowOutcome =
  | { kind: 'sent' }
  | { kind: 'skipped'; error: string }
  | { kind: 'retry'; error: string }
  | { kind: 'fatal'; error: string };

/**
 * Сообщение ушло, если дошло хоть до одного устройства. Не дошло никуда —
 * решает худший исход, который ещё можно исправить: повтор важнее отказа,
 * а все подписки отозваны — отправлять больше некуда.
 */
export function combinePush(outcomes: readonly PushOutcome[]): PushRowOutcome {
  if (outcomes.some((outcome) => outcome.kind === 'sent')) {
    return { kind: 'sent' };
  }

  const retry = outcomes.find((outcome) => outcome.kind === 'retry');

  if (retry && retry.kind === 'retry') {
    return retry;
  }

  const fatal = outcomes.find((outcome) => outcome.kind === 'fatal');

  if (fatal && fatal.kind === 'fatal') {
    return fatal;
  }

  return { kind: 'skipped', error: 'подписки браузера отозваны' };
}
