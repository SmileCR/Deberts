// Service worker Деберца: застосунок відкривається і без мережі.
// index.html — спочатку з мережі (щоб бачити оновлення), без мережі — з кешу.
// Бібліотеки з CDN (версії зафіксовані) і іконки — з кешу.
const SHELL = "deberts-shell-v3";
const CDN = [
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js"
];
const LOCAL = ["./", "./index.html", "./manifest.webmanifest", "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png", "./icon-32.png"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(LOCAL.map((u) => cache.add(u).catch(() => {})));
    await Promise.all(CDN.map((u) => fetch(u, { mode: "no-cors" }).then((r) => cache.put(u, r)).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Сторінка застосунку: спершу мережа, без мережі — кеш.
  if (url.origin === self.location.origin && (req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("index.html"))) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(SHELL);
        cache.put("./index.html", fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match("./index.html", { ignoreSearch: true });
        return cached || Response.error();
      }
    })());
    return;
  }

  // Бібліотеки CDN і локальні файли: з кешу, інакше з мережі.
  if (CDN.includes(req.url) || (url.origin === self.location.origin)) {
    event.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: url.origin === self.location.origin });
      if (cached) return cached;
      const res = await fetch(req);
      const cache = await caches.open(SHELL);
      cache.put(req, res.clone());
      return res;
    })());
  }
  // Запити до Supabase (онлайн-кімнати) не перехоплюємо: без мережі вони просто не пройдуть.
});
