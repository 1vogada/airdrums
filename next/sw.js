// Keeps the site's own files fresh.
//
// GitHub Pages lets a browser reuse a file for ten minutes without asking.
// Right after an update that can leave a browser running the new page with an
// old script: a button for a page the script has never heard of does nothing.
// This worker makes every request for the site's own files ask the server
// "has it changed?" first (a tiny request when it hasn't). Charts, lyrics and
// Spotify go to other sites and are left alone.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const fresh = request.mode === 'navigate'
    ? fetch(request.url, { cache: 'no-cache' })
    : fetch(new Request(request, { cache: 'no-cache' }));
  event.respondWith(fresh.catch(() => fetch(request)));
});
