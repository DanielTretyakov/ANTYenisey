/**
 * Уведомления в браузере: подписка этого устройства.
 *
 * Сервер знает только, сколько устройств человека подписано. Подписано ли
 * ЭТО — знает лишь сам браузер, поэтому состояние читается отсюда, а не из
 * ответа API.
 */

/** Где лежит service worker. В корне: открывать он должен любую страницу сайта. */
const WORKER_URL = '/push-sw.js';

export type PushSupport = 'supported' | 'unsupported' | 'denied';

/** Ошибка подписки с текстом для человека — карточка показывает его как есть. */
export class PushSetupError extends Error {}

/**
 * Умеет ли браузер уведомления. На iPhone — только если сайт добавлен на
 * экран «Домой»: в обычной вкладке Safari PushManager нет вовсе.
 */
export function pushSupport(): PushSupport {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }

  return Notification.permission === 'denied' ? 'denied' : 'supported';
}

/** Подписка этого браузера, если она есть. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() === 'unsupported') {
    return null;
  }

  const registration = await navigator.serviceWorker.getRegistration(WORKER_URL);

  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Подписаться. Разрешение спрашивается здесь — по нажатию кнопки, а не при
 * открытии страницы: браузеры глушат сайты, которые просят сразу.
 */
export async function subscribe(publicKey: string): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();

  if (permission === 'denied') {
    throw new PushSetupError('Уведомления запрещены в настройках браузера для этого сайта');
  }

  // Запрос закрыли, не ответив: ничего не запрещено, просто ещё не разрешено.
  if (permission !== 'granted') {
    throw new PushSetupError('Браузер не получил разрешения — нажмите «Разрешить» в его запросе');
  }

  try {
    const registration = await navigator.serviceWorker.register(WORKER_URL);
    await navigator.serviceWorker.ready;

    const existing = await registration.pushManager.getSubscription();

    // Подписка на старый ключ сервера (ключи сменили) — недоставляема; заменяем.
    if (existing && !sameKey(existing, publicKey)) {
      await existing.unsubscribe();
    } else if (existing) {
      return existing;
    }

    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyBytes(publicKey),
    });
  } catch {
    // Служба push браузера недоступна (нет сети, заблокирована) или браузер
    // отказал без объяснений: текст ошибки браузера человеку ничего не скажет.
    throw new PushSetupError('Браузер не смог включить уведомления — попробуйте ещё раз позже');
  }
}

/** То, что уходит на сервер: только адрес и ключи. */
export function subscriptionBody(subscription: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const json = subscription.toJSON();

  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
  };
}

/** Открытый ключ VAPID (base64url) → байты для pushManager.subscribe. */
export function vapidKeyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }

  return bytes;
}

function sameKey(subscription: PushSubscription, publicKey: string): boolean {
  const current = subscription.options.applicationServerKey;

  if (!current) {
    return false;
  }

  const expected = vapidKeyBytes(publicKey);
  const actual = new Uint8Array(current);

  return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
}
