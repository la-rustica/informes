const CACHE = 'la-rustica-v2';
const SHELL = ['./', './index.html', './app.js', './config.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  const isShell = url.origin === self.location.origin && !url.pathname.startsWith('/api/');
  if(!isShell || e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached=>{
      if(cached) return cached;
      return fetch(e.request).then(resp=>{
        const copy = resp.clone();
        caches.open(CACHE).then(c=>c.put(e.request, copy));
        return resp;
      }).catch(()=>cached);
    })
  );
});
