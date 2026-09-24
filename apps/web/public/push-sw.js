/*
 * Service worker уведомлений «Енисея» (Web Push).
 *
 * Лежит в корне сайта, а не в /_next: область действия service worker — его
 * каталог и ниже, а открывать по нажатию он должен любую страницу сайта.
 *
 * Сообщение приходит от сервера уже готовым — { title, body, url, tag } (см.
 * apps/api/src/notifications/push-rules.ts): тексты собирает API, и второй
 * шаблон здесь разошёлся бы с сообщениями в MAX.
 */

self.addEventListener('install', () => {
  // Новая версия берёт управление сразу, не дожидаясь закрытия всех вкладок.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Не JSON — показываем как есть: пустое уведомление хуже странного.
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Енисей';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      data: { url: data.url || '/' },
      lang: 'ru',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target = new URL(event.notification.data?.url || '/', self.location.origin);

  // Только свой сайт: адрес из сообщения — от нашего API, но открывать чужой
  // домен из уведомления незачем в любом случае.
  if (target.origin !== self.location.origin) {
    return;
  }

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === target.origin);

      if (open) {
        await open.focus();
        return open.navigate(target.href);
      }

      return self.clients.openWindow(target.href);
    })(),
  );
});
