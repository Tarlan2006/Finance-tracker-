/// <reference lib="webworker" />
import { flushQueue, hasWaitingQueue } from './lib/queue';
declare const self: ServiceWorkerGlobalScope;
declare const __PRECACHE__: string[];
declare const __VERSION__: string;
const CACHE = `tenge-${__VERSION__}`;
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(__PRECACHE__)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('tenge-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => { if (!response.ok) throw new Error('Navigation unavailable'); return response; }).catch(async () => {
      const shell = await caches.match('/index.html');
      // Workers Assets redirects /index.html to /. A redirected cached Response cannot
      // fulfill a navigation whose redirect mode is manual; rewrap the cached body.
      return shell ? new Response(shell.body, { status: 200, headers: shell.headers }) : new Response('Откройте приложение онлайн один раз', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })); return;
  }
  event.respondWith((async () => { const cached = await caches.match(event.request); const update = fetch(event.request).then(async response => { if (response.ok) { const cache = await caches.open(CACHE); await cache.put(event.request, response.clone()); } return response; }); if (cached) { event.waitUntil(update.catch(() => undefined)); return cached; } return update; })());
});
// Chromium Background Sync can drain the same durable queue with the window closed.
self.addEventListener('sync', ((event: ExtendableEvent & { tag: string }) => { if (event.tag === 'finance-queue') event.waitUntil(flushQueue().then(async () => { const clients = await self.clients.matchAll({ type: 'window' }); clients.forEach(client => client.postMessage({ type: 'queue-updated' })); if (await hasWaitingQueue()) throw new Error('Очередь ожидает повторной синхронизации'); })); }) as EventListener);
