// Minimaler Service Worker: nur damit der Browser die Seite als installierbare App akzeptiert.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
