self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : null;
  const title = payload?.title || 'Aprobados';
  const options = {
    body: payload?.body || 'Tu material ya está disponible.',
    icon: '/vite.svg',
    badge: '/vite.svg',
    data: payload?.data || {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});
