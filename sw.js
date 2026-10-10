// A versioned, complete application shell. No GitHub or credential requests
// enter Cache Storage. Scope is only offline/shogi/, never Streamlit.
const VERSION='banjo-shogi-shell-stage18-1f-v1';
const SHELL=['./','./index.html','./style.css','./app.js','./core.js','./storage.js','./github.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(SHELL.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'}))))));
// Keep the old worker running until all its windows are closed. This avoids
// mixing cached modules from different releases in an open editor.
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith('banjo-shogi-shell-')&&name!==VERSION)await caches.delete(name);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
  event.respondWith((async()=>{const cache=await caches.open(VERSION),hit=await cache.match(event.request,{ignoreSearch:true});if(hit)return hit;
    if(event.request.mode==='navigate')return cache.match('./index.html');return fetch(event.request);
  })());
});
self.addEventListener('message',event=>{if(event.data==='CHECK_SHELL')event.waitUntil((async()=>{const cache=await caches.open(VERSION);const ready=(await Promise.all(SHELL.map(path=>cache.match(path)))).every(Boolean);event.ports[0]?.postMessage({ready,version:VERSION});})());});
