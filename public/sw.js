const CACHE_PREFIX = "bill-calculator";
const APP_CACHE = `${CACHE_PREFIX}-app-v1`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-v1`;
const EXPECTED_CACHES = [APP_CACHE, RUNTIME_CACHE];
const APP_SHELL = ["./", "./manifest.json", "./icon.svg"];

const sameOriginUrl = (url) => {
  try {
    const parsed = new URL(url, self.location.href);
    return parsed.origin === self.location.origin ? parsed.href : null;
  } catch {
    return null;
  }
};

const cacheRequest = async (cacheName, request, response) => {
  if (!response || response.status !== 200) {
    return;
  }

  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) =>
        Promise.all(
          APP_SHELL.map((url) => cache.add(url).catch(() => undefined))
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX))
            .filter((key) => !EXPECTED_CACHES.includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_APP_SHELL" || !Array.isArray(event.data.urls)) {
    return;
  }

  event.waitUntil(
    caches.open(APP_CACHE).then((cache) =>
      Promise.all(
        event.data.urls
          .map(sameOriginUrl)
          .filter(Boolean)
          .map((url) => cache.add(url).catch(() => undefined))
      )
    )
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const requestUrl = sameOriginUrl(request.url);

  if (request.method !== "GET" || !requestUrl) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          cacheRequest(APP_CACHE, request, response).catch(() => undefined);
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(APP_CACHE);
          return (
            (await cache.match(request)) ||
            (await cache.match("./")) ||
            Response.error()
          );
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((response) => {
        cacheRequest(RUNTIME_CACHE, request, response).catch(() => undefined);
        return response;
      });
    })
  );
});
