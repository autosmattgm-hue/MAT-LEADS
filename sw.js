const CACHE_NAME = "mat-leads-ai-pro-x-v92";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/share.html",
  "/about.html",
  "/login.html",
  "/signup.html",
  "/forgot-password.html",
  "/dashboard.html",
  "/crm.html",
  "/pricing.html",
  "/profile.html",
  "/settings.html",
  "/reports.html",
  "/outreach.html",
  "/ai-agent.html",
  "/analytics.html",
  "/client-report.html",
  "/lead-details.html",
  "/admin.html",
  "/billing-success.html",
  "/tools.html",
  "/work-planner.html",
  "/website-studio.html",
  "/website-editor.html",
  "/academy.html",
  "/earn.html",
  "/proposals.html",
  "/pay.html",
  "/money.html",
  "/freelance.html",
  "/digital.html",
  "/content.html",
  "/sales.html",
  "/students.html",
  "/ecommerce.html",
  "/affiliate.html",
  "/coaching.html",
  "/social.html",
  "/community.html",
  "/faq.html",
  "/features/phone-lead-generation",
  "/features/ai-website-builder",
  "/css/style.css",
  "/css/enhanced.css",
  "/css/landing.css",
  "/css/academy.css",
  "/css/auth.css",
  "/css/playbook.css",
  "/css/tools.css",
  "/components/layout.js",
  "/js/api.js",
  "/js/app.js",
  "/js/landing.js",
  "/js/academy.js",
  "/js/auth-ui.js",
  "/js/playbook.js",
  "/js/firebase-auth.js",
  "/js/dashboard.js",
  "/js/settings.js",
  "/js/leads.js",
  "/js/saved-searches.js",
  "/js/tools.js",
  "/js/work-planner.js",
  "/js/tool-engine.js",
  "/js/money.js",
  "/js/freelance.js",
  "/js/digital.js",
  "/js/content.js",
  "/js/sales.js",
  "/js/students.js",
  "/js/ecommerce.js",
  "/js/affiliate.js",
  "/js/coaching.js",
  "/js/social.js",
  "/js/community.js",
  "/js/earn.js",
  "/js/proposals.js",
  "/js/outreach.js",
  "/js/ai-console.js",
  "/js/ai-agent.js",
  "/js/ai-quick-chat.js",
  "/js/website-studio.js",
  "/js/website-editor.js",
  "/js/site-quality.js",
  "/js/website-runtime.js",
  "/js/pwa.js",
  "/assets/logo-mark.svg",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = { body: event.data?.text() || "You have a new MAT LEADS update." }; }
  event.waitUntil(self.registration.showNotification(payload.title || "MAT LEADS update", {
    body: payload.body || "Open your workspace to review the latest action.",
    icon: "/assets/logo-mark.svg",
    badge: "/assets/logo-mark.svg",
    tag: payload.tag || "mat-leads-update",
    data: { url: payload.url || "/dashboard.html" }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/dashboard.html", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => "focus" in client);
    return existing ? existing.navigate(target).then((client) => client.focus()) : self.clients.openWindow(target);
  }));
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
