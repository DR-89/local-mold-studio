const CACHE_NAME = "local-mold-studio-shell-v69";
const SCOPE_URL = new URL(self.registration.scope);
const APP_URL = SCOPE_URL.href;
const START_URLS = [
  APP_URL,
  new URL("manifest.webmanifest", SCOPE_URL).href,
  new URL("favicon.svg", SCOPE_URL).href,
];

function discoverAssetUrls(text) {
  const urls = new Set();
  const patterns = [
    /\/?_next\/static\/[A-Za-z0-9_./-]+/g,
    /(?:\.\/|\/)?assets\/[A-Za-z0-9_./-]+/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      urls.add(new URL(match[0].replace(/^\//, ""), SCOPE_URL).href);
    }
  }
  return [...urls];
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const queue = [...START_URLS];
  const visited = new Set();
  while (queue.length > 0) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    const response = await fetch(url, { cache: "reload" });
    if (!response.ok) throw new Error(`App shell asset is missing: ${url}`);
    await cache.put(url, response.clone());
    const contentType = response.headers.get("content-type") ?? "";
    if (/html|javascript|json|css/.test(contentType)) {
      const text = await response.text();
      for (const discovered of discoverAssetUrls(text)) {
        if (!visited.has(discovered)) queue.push(discovered);
      }
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(SCOPE_URL.pathname)
  )
    return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cache.put(APP_URL, copy)),
            );
          }
          return response;
        })
        .catch(() =>
          caches
            .match(APP_URL)
            .then((response) => response ?? Response.error()),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)),
            );
          }
          return response;
        }),
    ),
  );
});
