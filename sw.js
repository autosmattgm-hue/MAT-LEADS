const CACHE_NAME = "mat-leads-ai-pro-x-v3";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/login.html",
  "/signup.html",
  "/dashboard.html",
  "/crm.html",
  "/pricing.html",
  "/profile.html",
  "/settings.html",
  "/reports.html",
  "/analytics.html",
  "/client-report.html",
  "/lead-details.html",
  "/admin.html",
  "/billing-success.html",
  "/tools.html",
  "/work-planner.html",
  "/css/style.css",
  "/components/layout.js",
  "/js/api.js",
  "/js/app.js",
  "/js/dashboard.js",
  "/js/leads.js",
  "/js/tools.js",
  "/js/work-planner.js",
  "/js/pwa.js",
  "/assets/logo-mark.svg",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/index.html")))
  );
});
