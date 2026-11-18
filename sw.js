const PREFIX="lulema-shell-";
const VERSION="v4";
// 同一域名下的项目各用自己的缓存，避免清理 Hexo 或其他网站的缓存。
const CACHE=PREFIX+encodeURIComponent(self.registration.scope)+VERSION;
const SHELL=["./","./index.html","./styles.css","./config.js","./src/app.js","./src/model.js","./src/charts.js","./src/storage.js","./src/cloud.js","./assets/icon.svg","./assets/icon-192.png","./assets/icon-512.png","./manifest.webmanifest"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(names=>Promise.all(names.filter(n=>n.startsWith(PREFIX+encodeURIComponent(self.registration.scope))&&n!==CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=="GET"||!url.href.startsWith(self.registration.scope)||url.origin!==self.location.origin)return;
  // 云端 API 永不缓存；这里只缓存这个项目的静态文件。
  if(request.mode==="navigate") {
    event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put("./index.html",copy)));}return response;}).catch(()=>caches.match(new URL("./index.html",self.registration.scope).href)));
    return;
  }
  if(!SHELL.some(asset=>new URL(asset,self.registration.scope).pathname===url.pathname))return;
  event.respondWith(caches.open(CACHE).then(async cache=>{
    try {const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;}
    catch {return await cache.match(request)||new Response("Offline",{status:503});}
  }));
});
