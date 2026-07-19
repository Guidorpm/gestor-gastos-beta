// MEJORA 6B3 - Se sube la versión y se separa la estrategia de caché por
// tipo de recurso, para que index.html/index_operator.html nunca queden
// atrapados en una versión vieja en el navegador (sobre todo en móvil):
//   - HTML (navegación): network-first estricto con cache:'no-store', para
//     que el navegador nunca resuelva desde su propio caché HTTP tampoco.
//     Solo si la red falla del todo (offline) se intenta el caché.
//   - Íconos/manifest: cache-first liviano (no dependen de datos del
//     usuario, no hace falta red-primero para ellos).
//   - Todo lo demás (CDN, etc.): igual que antes, red primero con
//     fallback a caché si la red falla.
// activate() sigue borrando cualquier caché de una versión anterior.
// CORRECCIÓN 6B4.5.1 - Se sube la versión para forzar que cualquier Service
// Worker ya registrado en el navegador se actualice y descarte su caché
// anterior (activate() borra todo lo que no sea STATIC_CACHE actual).
// CORRECCIÓN 6B4.8 - NO se sube CACHE_VERSION acá (no hace falta: no se
// tocó la estrategia de caché, solo se agregan los manejadores de
// push/notificationclick que faltaban por completo — ver más abajo). El
// archivo igual se re-registra porque el contenido del script cambió (el
// navegador compara bytes, no esta constante) y el registro en index.html
// ya sube su propio "?v=" para forzarlo sin esperar el chequeo periódico.
const CACHE_VERSION = 'gestor-gastos-v10-6b4-5-1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const STATIC_ASSETS = ['icon-192.png', 'icon-512.png', 'manifest.json'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .catch(() => {})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== STATIC_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isHtmlRequest(request) {
  return request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', event => {
  const request = event.request;

  if (isHtmlRequest(request)) {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() => caches.match(request))
    );
    return;
  }

  if (STATIC_ASSETS.some(asset => request.url.endsWith(asset))) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request))
    );
    return;
  }

  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// ============================================================
// MEJORA 6B4.8 — Manejo de push/notificationclick.
// ------------------------------------------------------------
// CAUSA REAL encontrada de "no llegan avisos": este archivo NUNCA tuvo un
// listener de 'push' ni de 'notificationclick'. El cliente (index.html) ya
// crea una PushSubscription real y la guarda en Supabase, pero aunque el
// servidor llegara a enviar un push, este service worker no tenía ningún
// código para mostrarlo como notificación — se perdía en silencio. Esto es
// independiente de si existe o no infraestructura de servidor que envíe el
// push (ver informe 6B4.8): sin este manejador, ni un push real functionaría.
// ------------------------------------------------------------
self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { title: 'Gestor de Gastos', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Gestor de Gastos';
  const data = payload.data || {};
  // "tag" es la clave estable pedida (card_id+período+tipo de aviso): el
  // navegador reemplaza automáticamente una notificación previa con el
  // mismo tag en vez de apilar una nueva — así nunca se duplica el mismo
  // aviso al reintentar o reenviar.
  const tag = payload.tag || (data.cardId && data.period && data.notificationType
    ? `${data.cardId}:${data.period}:${data.notificationType}`
    : undefined);
  const options = {
    body: payload.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag,
    renotify: !!tag,
    data,
  };
  // CORRECCIÓN 6B4.15 - Avisa a cualquier pestaña abierta que un push
  // realmente llegó (para el panel de diagnóstico honesto). Esto NUNCA
  // prueba que funcione con la app cerrada -- si no hay ninguna pestaña
  // abierta, este mensaje simplemente no llega a nadie; la única prueba
  // real de "app cerrada" es abrir la app después y ver si el sistema
  // operativo mostró la notificación, algo que este mecanismo no puede
  // confirmar por sí solo.
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
        clientList.forEach(client => client.postMessage({ type: 'push-received', receivedAt: new Date().toISOString(), data }));
      }),
    ])
  );
});

function buildNotificationDeepLinkUrl(data) {
  const base = self.registration.scope;
  const params = new URLSearchParams();
  if (data?.cardId) params.set('openCard', data.cardId);
  if (data?.period) params.set('openPeriod', data.period);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

// CORRECCIÓN 6B4.8 - Fase 9: cada aviso debe abrir directamente la tarjeta y
// el período correspondiente. Si ya hay una pestaña abierta, se le manda un
// mensaje (evita recargar toda la app); si no hay ninguna, se abre una
// nueva con los parámetros en la URL (ver consumeNotificationDeepLinkFromUrl
// en index.html).
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'notification-click', data });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(buildNotificationDeepLinkUrl(data));
    })
  );
});
