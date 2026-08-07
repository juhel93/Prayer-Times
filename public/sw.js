// Minimal service worker — just enough to make the app "installable" as a PWA.
// It doesn't do offline caching (this app needs a live connection to work
// anyway, since photo extraction calls a server), it just needs to exist
// and handle fetch so browsers recognize the app as a proper PWA.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Pass everything straight through to the network — no offline caching.
});
