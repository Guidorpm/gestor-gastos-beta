const WORKER_VERSION = 'gestor-gastos-notificaciones-v10';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))),
      self.clients.claim()
    ])
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('push', event => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      body: event.data ? event.data.text() : ''
    };
  }

  const notification = payload.notification || payload;
  const data = {
    ...(payload.data || {}),
    ...(notification.data || {})
  };

  const title =
    notification.title ||
    payload.title ||
    'Gestor de gastos';

  const options = {
    body:
      notification.body ||
      payload.body ||
      'Tenés un aviso de vencimiento.',
    icon:
      notification.icon ||
      payload.icon ||
      './icon-192.png',
    badge:
      notification.badge ||
      payload.badge ||
      './icon-192.png',
    tag:
      notification.tag ||
      payload.tag ||
      'gestor-gastos-aviso',
    renotify: true,
    data: {
      ...data,
      url:
        data.url ||
        notification.url ||
        payload.url ||
        './'
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const destination =
    event.notification.data?.url ||
    './';

  event.waitUntil(
    self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(destination).catch(() => {});
          return client.focus();
        }
      }

      return self.clients.openWindow(destination);
    })
  );
});
