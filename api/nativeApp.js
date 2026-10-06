import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { isFirebaseConfigured } from "./config/firebase.js";
import { AdminService } from "./services/adminService.js";
import { AuthService } from "./services/authService.js";
import { BillingService } from "./services/billingService.js";
import { CrmService } from "./services/crmService.js";
import { DashboardService } from "./services/dashboardService.js";
import { LeadService } from "./services/leadService.js";
import { NvidiaService } from "./services/nvidiaService.js";
import { WebsiteService } from "./services/websiteService.js";
import { EarnService } from "./services/earnService.js";
import { isAdminUser } from "./utils/entitlements.js";
import { AppError } from "./utils/errors.js";
import { aiSchemas, authSchemas, billingSchema, crmSchemas, earnSchemas, leadSearchSchema, paypalConfirmationSchema, profileSchema, settingsSchema } from "./utils/schemas.js";
import { verifyAccessToken } from "./middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const authService = new AuthService();
const leadService = new LeadService();
const crmService = new CrmService();
const dashboardService = new DashboardService();
const billingService = new BillingService();
const adminService = new AdminService();
const nvidiaService = new NvidiaService();
const websiteService = new WebsiteService();
const earnService = new EarnService();

function canUseProAi(user = {}) {
  if (isAdminUser(user)) return true;
  if (user?.entitlements?.unlimitedAccess) return true;
  if (Array.isArray(user?.permissions) && (user.permissions.includes("unlimited") || user.permissions.includes("business_tycoon") || user.permissions.includes("website_builder"))) return true;
  const sub = String(user?.subscription || user?.planName || user?.entitlements?.activePlan || "").toLowerCase();
  if (["professional", "growth_plus", "growth plus", "growth-plus", "agency", "enterprise", "pro"].some((k) => sub.includes(k))) return true;
  if (user?.entitlements?.activePlan && !["trial", "starter", ""].includes(String(user.entitlements.activePlan))) return true;
  return false;
}

function requireProAi(user) {
  if (canUseProAi(user)) return;
  const err = new Error("Business Tycoon AI + Website Studio need a Pro plan or higher. Upgrade on Pricing to unlock.");
  err.status = 402;
  err.code = "PRO_REQUIRED";
  throw err;
}

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"]
]);

const rateBuckets = new Map();
const publicFiles = new Set([
  "/",
  "/index.html",
  "/login.html",
  "/signup.html",
  "/dashboard.html",
  "/crm.html",
  "/lead-details.html",
  "/client-report.html",
  "/pricing.html",
  "/billing-success.html",
  "/profile.html",
  "/settings.html",
  "/admin.html",
  "/reports.html",
  "/analytics.html",
  "/website-studio.html",
  "/business-ai.html",
  "/share.html",
  "/earn.html",
  "/outreach.html",
  "/proposals.html",
  "/pay.html",
  "/manifest.webmanifest",
  "/sw.js",
  "/robots.txt",
  "/sitemap.xml"
]);
const publicFolders = ["/css/", "/js/", "/assets/", "/components/"];

function securityHeaders(extra = {}) {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "connect-src 'self'",
        "frame-src 'self' https://www.google.com https://maps.google.com",
        "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'"
    ].join("; "),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Permitted-Cross-Domain-Policies": "none",
    ...extra
  };
}

function send(res, status, payload, headers = {}) {
  const body = typeof payload === "string" || Buffer.isBuffer(payload)
    ? payload
    : JSON.stringify(payload);
  res.writeHead(status, {
    ...securityHeaders(),
    "Content-Length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

function json(res, status, payload) {
  send(res, status, payload, { "Content-Type": "application/json; charset=utf-8" });
}

function getHeader(req, name) {
  return req.headers[name.toLowerCase()] || "";
}

function isAllowedOrigin(origin) {
  if (!origin) return !env.isProduction;
  return env.corsOrigins.includes(origin) || origin === env.appUrl;
}

function applyCors(req, res) {
  const origin = getHeader(req, "origin");
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
}

function rateLimit(req) {
  const now = Date.now();
  const ip = req.socket.remoteAddress || "unknown";
  const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + env.rateLimit.windowMs };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + env.rateLimit.windowMs;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  if (bucket.count > env.rateLimit.max) throw new AppError("Too many requests.", 429, "RATE_LIMITED");
}

async function readJson(req) {
  if (!["POST", "PATCH", "PUT"].includes(req.method)) return {};
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new AppError("Request body too large.", 413, "BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("Invalid JSON body.", 400, "INVALID_JSON");
  }
}

function validate(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("Invalid request payload.", 422, "VALIDATION_ERROR", parsed.error.flatten());
  }
  return parsed.data;
}

async function getUser(req) {
  const header = getHeader(req, "authorization");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    throw new AppError("Authentication required.", 401, "AUTH_REQUIRED");
  }
  try {
    return await verifyAccessToken(token);
  } catch {
    throw new AppError("Invalid or expired token.", 401, "INVALID_TOKEN");
  }
}

async function getAdminUser(req) {
  const user = await getUser(req);
  if (user.role !== "admin") throw new AppError("Insufficient permissions.", 403, "FORBIDDEN");
  return user;
}

function matchRoute(method, pathname, pattern) {
  if (method !== pattern.method) return null;
  const match = pattern.regex.exec(pathname);
  if (!match) return null;
  return Object.fromEntries(pattern.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]));
}

const routes = [
  {
    method: "GET",
    regex: /^\/api\/health$/,
    keys: [],
    handler: async () => ({
      status: "ok",
      service: "mat-leads-ai-pro-x",
      environment: env.nodeEnv,
      integrations: {
        firebase: isFirebaseConfigured(),
        googlePlaces: Boolean(env.google.placesApiKey),
        openStreetMap: Boolean(env.osm.overpassEndpoints.length),
        nvidia: Boolean(env.nvidia.apiKey),
        stripe: Boolean(env.stripe.secretKey),
        paypal: Boolean((env.paypal.clientId && env.paypal.clientSecret) || Object.values(env.paypal.paymentLinks).every(Boolean)),
        paypalApi: Boolean(env.paypal.clientId && env.paypal.clientSecret),
        paypalHostedLinks: Object.values(env.paypal.paymentLinks).every(Boolean)
      },
      realMode: true,
      aiModels: {
        chat: [env.nvidia.model, ...(env.nvidia.modelFallbacks || [])].filter(Boolean),
        website: [env.nvidia.websiteModel, ...(env.nvidia.websiteFallbacks || []), "z-ai/glm-5.3-flash", "google/gemma-4-31b-it"].filter(Boolean),
        tycoon: [env.nvidia.tycoonModel, "deepseek-ai/deepseek-v4.1-flash", "z-ai/glm-5.3-flash"].filter(Boolean)
      },
      missingRequiredForLiveOperation: [
        !env.nvidia.apiKey && "NVIDIA_API_KEY",
        !env.firebase.projectId && "........",
        !env.stripe.secretKey && "........",
        !(env.paypal.clientId && env.paypal.clientSecret) && !Object.values(env.paypal.paymentLinks).every(Boolean) && "PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET or hosted PayPal payment links"
      ].filter(Boolean)
    })
  },
  {
    method: "POST",
    regex: /^\/api\/auth\/register$/,
    keys: [],
    handler: async ({ body }) => authService.register(validate(authSchemas.register, body)),
    status: 201
  },
  {
    method: "POST",
    regex: /^\/api\/auth\/login$/,
    keys: [],
    handler: async ({ body }) => authService.login(validate(authSchemas.login, body))
  },
  {
    method: "POST",
    regex: /^\/api\/auth\/refresh$/,
    keys: [],
    handler: async ({ body }) => authService.refreshSession(validate(authSchemas.refresh, body).refreshToken)
  },
  {
    method: "GET",
    regex: /^\/api\/auth\/me$/,
    keys: [],
    handler: async ({ req }) => ({ user: await authService.currentUser(await getUser(req)) })
  },
  {
    method: "GET",
    regex: /^\/api\/auth\/profile$/,
    keys: [],
    handler: async ({ req }) => ({ user: await authService.currentUser(await getUser(req)) })
  },
  {
    method: "PATCH",
    regex: /^\/api\/auth\/profile$/,
    keys: [],
    handler: async ({ req, body }) => authService.updateProfile(await getUser(req), validate(profileSchema, body))
  },
  {
    method: "GET",
    regex: /^\/api\/auth\/settings$/,
    keys: [],
    handler: async ({ req }) => {
      const user = await authService.currentUser(await getUser(req));
      return { settings: user.settings, user };
    }
  },
  {
    method: "PATCH",
    regex: /^\/api\/auth\/settings$/,
    keys: [],
    handler: async ({ req, body }) => authService.updateSettings(await getUser(req), validate(settingsSchema, body))
  },
  {
    method: "POST",
    regex: /^\/api\/leads\/search$/,
    keys: [],
    handler: async ({ req, body }) => leadService.search(validate(leadSearchSchema, body), await getUser(req))
  },
  {
    method: "POST",
    regex: /^\/api\/leads\/([^/]+)\/save$/,
    keys: ["id"],
    handler: async ({ req, params }) => {
      const lead = await leadService.save(params.id, await getUser(req));
      if (!lead) throw new AppError("Lead not found.", 404, "LEAD_NOT_FOUND");
      return { lead };
    }
  },
  {
    method: "GET",
    regex: /^\/api\/leads\/([^/]+)\/report$/,
    keys: ["id"],
    handler: async ({ req, params }) => {
      await getUser(req);
      const report = await leadService.getReport(params.id);
      if (!report) throw new AppError("Lead not found. Search real Google Places data first, then save or open a returned lead.", 404, "LEAD_NOT_FOUND");
      return report;
    }
  },
  {
    method: "POST",
    regex: /^\/api\/ai\/chat$/,
    keys: [],
    handler: async ({ req, body }) => {
      await getUser(req);
      const payload = validate(aiSchemas.chat, body);
      return nvidiaService.chat(payload.prompt);
    }
  },
  {
    method: "POST",
    regex: /^\/api\/ai\/analyze$/,
    keys: [],
    handler: async ({ req, body }) => {
      await getUser(req);
      const payload = validate(aiSchemas.analyze, body);
      const lead = await leadService.getById(payload.leadId);
      if (!lead) throw new AppError("Lead not found.", 404, "LEAD_NOT_FOUND");
      return nvidiaService.analyzeLead(lead);
    }
  },
  {
    method: "POST",
    regex: /^\/api\/ai\/outreach$/,
    keys: [],
    handler: async ({ req, body }) => {
      await getUser(req);
      const payload = validate(aiSchemas.outreach, body);
      const lead = await leadService.getById(payload.leadId);
      if (!lead) throw new AppError("Lead not found.", 404, "LEAD_NOT_FOUND");
      return nvidiaService.writeOutreach(lead, payload.type);
    }
  },
  {
    method: "POST",
    regex: /^\/api\/ai\/proposal$/,
    keys: [],
    handler: async ({ req, body }) => {
      await getUser(req);
      const payload = validate(aiSchemas.proposal, body);
      const lead = await leadService.getById(payload.leadId);
      if (!lead) throw new AppError("Lead not found.", 404, "LEAD_NOT_FOUND");
      return nvidiaService.proposalPack(lead, payload.offerKey || "pro_site");
    }
  },
  {
    method: "POST",
    regex: /^\/api\/ai\/tycoon$/,
    keys: [],
    handler: async ({ req, body }) => {
      const user = await getUser(req);
      requireProAi(user);
      const payload = validate(aiSchemas.tycoon, body);
      let lead = payload.lead && Object.keys(payload.lead).length ? payload.lead : null;
      if (!lead && payload.leadId) lead = await leadService.getById(payload.leadId);
      return nvidiaService.tycoonChat(payload.prompt, { lead: lead || {}, user: user.email || "" });
    }
  },
  {
    method: "POST",
    regex: /^\/api\/ai\/websites$/,
    keys: [],
    handler: async ({ req, body }) => {
      const user = await getUser(req);
      requireProAi(user);
      const payload = validate(aiSchemas.websiteBuild, body);
      let lead = payload.lead && Object.keys(payload.lead).length ? payload.lead : null;
      if (!lead && payload.leadId) lead = await leadService.getById(payload.leadId);
      if (!lead) lead = { id: payload.leadId || "lead", name: payload.businessName || "Business" };
      const result = await websiteService.build({ lead, options: { businessName: payload.businessName, style: payload.style, palette: payload.palette }, user });
      return { websiteId: result.website.id, shareToken: result.website.shareToken, shareUrl: `/s/${result.website.shareToken}`, studioUrl: `/website-studio.html?id=${encodeURIComponent(result.website.id)}`, website: result.website };
    }
  },
  {
    method: "PATCH",
    regex: /^\/api\/ai\/websites\/([^/]+)$/,
    keys: ["id"],
    handler: async ({ req, body, params }) => {
      const user = await getUser(req);
      requireProAi(user);
      const payload = validate(aiSchemas.websiteRefine, { ...body, websiteId: params.id });
      const result = await websiteService.refine({ id: params.id, instruction: payload.instruction, user });
      return { websiteId: result.website.id, shareToken: result.website.shareToken, shareUrl: `/s/${result.website.shareToken}`, website: result.website };
    }
  },
  {
    method: "GET",
    regex: /^\/api\/ai\/websites\/([^/]+)$/,
    keys: ["id"],
    handler: async ({ req, params }) => {
      await getUser(req);
      const website = await websiteService.getById(params.id);
      if (!website) throw new AppError("Website not found.", 404, "WEBSITE_NOT_FOUND");
      return { website, shareUrl: `/s/${website.shareToken}`, studioUrl: `/website-studio.html?id=${encodeURIComponent(website.id)}` };
    }
  },
  {
    method: "GET",
    regex: /^\/api\/s\/([^/]+)$/,
    keys: ["token"],
    handler: async ({ params }) => {
      const website = await websiteService.getByToken(params.token);
      if (!website) throw new AppError("Shared website not found.", 404, "WEBSITE_NOT_FOUND");
      return { website, html: website.html };
    }
  },
  {
    method: "GET",
    regex: /^\/api\/crm\/leads$/,
    keys: [],
    handler: async ({ req }) => ({ leads: await crmService.listLeads(await getUser(req)) })
  },
  {
    method: "PATCH",
    regex: /^\/api\/crm\/leads\/([^/]+)\/stage$/,
    keys: ["id"],
    handler: async ({ req, body, params }) => {
      const payload = validate(crmSchemas.stage, body);
      const lead = await crmService.updateStage(params.id, payload.stage, await getUser(req));
      if (!lead) throw new AppError("Lead not found.", 404, "LEAD_NOT_FOUND");
      return { lead };
    }
  },
  {
    method: "POST",
    regex: /^\/api\/crm\/leads\/([^/]+)\/notes$/,
    keys: ["id"],
    handler: async ({ req, body, params }) => {
      const payload = validate(crmSchemas.note, body);
      return { activity: await crmService.addNote(params.id, payload.note, payload.tags, await getUser(req)) };
    },
    status: 201
  },
  {
    method: "GET",
    regex: /^\/api\/dashboard\/metrics$/,
    keys: [],
    handler: async ({ req }) => ({ metrics: await dashboardService.metrics(await getUser(req)) })
  },
  {
    method: "POST",
    regex: /^\/api\/billing\/stripe\/payment-intent$/,
    keys: [],
    handler: async ({ req, body }) => billingService.createStripePaymentIntent(
      validate(billingSchema, body).plan,
      await getUser(req),
      getHeader(req, "idempotency-key")
    )
  },
  {
    method: "POST",
    regex: /^\/api\/billing\/paypal\/order$/,
    keys: [],
    handler: async ({ req, body }) => billingService.createPaypalOrder(validate(billingSchema, body).plan, await getUser(req))
  },
  {
    method: "POST",
    regex: /^\/api\/billing\/paypal\/confirm$/,
    keys: [],
    handler: async ({ req, body }) => billingService.confirmPaypalPayment(validate(paypalConfirmationSchema, body), await getUser(req))
  },
  {
    method: "GET",
    regex: /^\/api\/admin\/overview$/,
    keys: [],
    handler: async ({ req }) => {
      await getAdminUser(req);
      return adminService.overview();
    }
  },
  {
    method: "GET",
    regex: /^\/api\/earn\/offers$/,
    keys: [],
    handler: async ({ req }) => {
      await getUser(req);
      return { offers: earnService.offers() };
    }
  },
  {
    method: "GET",
    regex: /^\/api\/earn\/referral$/,
    keys: [],
    handler: async ({ req }) => {
      const user = await getUser(req);
      const data = await earnService.myReferral(user);
      return { ...data, paidUsd: (data.paidCents / 100).toFixed(2), pendingUsd: (data.pendingCents / 100).toFixed(2) };
    }
  },
  {
    method: "GET",
    regex: /^\/api\/earn\/invoices$/,
    keys: [],
    handler: async ({ req }) => ({ invoices: await earnService.myInvoices(await getUser(req)) })
  },
  {
    method: "POST",
    regex: /^\/api\/earn\/invoices$/,
    keys: [],
    handler: async ({ req, body }) => earnService.createInvoice(await getUser(req), validate(earnSchemas.invoice, body)),
    status: 201
  },
  {
    method: "GET",
    regex: /^\/api\/earn\/invoices\/([^/]+)$/,
    keys: ["id"],
    handler: async ({ params }) => {
      const invoice = await earnService.getInvoice(params.id);
      if (!invoice) throw new AppError("Invoice not found.", 404, "INVOICE_NOT_FOUND");
      return { invoice };
    }
  },
  {
    method: "POST",
    regex: /^\/api\/earn\/invoices\/([^/]+)\/paid$/,
    keys: ["id"],
    handler: async ({ req, body, params }) => earnService.markInvoicePaid(params.id, await getUser(req), validate(earnSchemas.invoicePaid, body))
  },
  {
    method: "GET",
    regex: /^\/api\/earn\/payouts$/,
    keys: [],
    handler: async ({ req }) => ({ payouts: await earnService.myPayouts(await getUser(req)) })
  },
  {
    method: "POST",
    regex: /^\/api\/earn\/payouts$/,
    keys: [],
    handler: async ({ req, body }) => earnService.requestPayout(await getUser(req), validate(earnSchemas.payout, body)),
    status: 201
  },
  {
    method: "POST",
    regex: /^\/api\/earn\/track-signup$/,
    keys: [],
    handler: async ({ req, body }) => {
      const user = await getUser(req);
      const ref = String(body?.ref || body?.code || "").slice(0, 40);
      if (!ref) return { tracked: false };
      return { tracked: true, referral: await earnService.trackSignup(user, ref) };
    }
  }
];

async function handleApi(req, res, url) {
  rateLimit(req);
  const body = await readJson(req);
  for (const route of routes) {
    const params = matchRoute(req.method, url.pathname, route);
    if (!params) continue;
    const payload = await route.handler({ req, body, params, url });
    return json(res, route.status || 200, payload);
  }
  throw new AppError(`Route not found: ${req.method} ${url.pathname}`, 404, "NOT_FOUND");
}

async function serveStatic(req, res, url) {
  if (!["GET", "HEAD"].includes(req.method)) {
    throw new AppError("Method not allowed.", 405, "METHOD_NOT_ALLOWED");
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const isPublic = publicFiles.has(url.pathname) || publicFiles.has(requested) || publicFolders.some((folder) => requested.startsWith(folder));
  if (!isPublic || requested.includes("..") || requested.startsWith("/.")) {
    throw new AppError("File not found.", 404, "STATIC_NOT_FOUND");
  }

  const safePath = path.normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const absolute = path.resolve(projectRoot, `.${safePath}`);
  if (!absolute.startsWith(projectRoot)) throw new AppError("File not allowed.", 403, "STATIC_FORBIDDEN");

  let filePath = absolute;
  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    if (!path.extname(filePath)) filePath = `${filePath}.html`;
  }

  try {
    const body = await fs.readFile(filePath);
    const type = mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
    if (req.method === "HEAD") return send(res, 200, "", { "Content-Type": type });
    const cacheControl = type.includes("text/html") || type.includes("javascript") || type.includes("css")
      ? "no-store"
      : "public, max-age=3600";
    return send(res, 200, body, {
      "Content-Type": type,
      "Cache-Control": cacheControl
    });
  } catch {
    const fallback = await fs.readFile(path.join(projectRoot, "index.html"));
    return send(res, 404, fallback, { "Content-Type": "text/html; charset=utf-8" });
  }
}

export async function handleRequest(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return send(res, 204, "");

  try {
    const url = new URL(req.url, env.appUrl);
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url);
    }
    if (url.pathname.startsWith("/s/")) {
      const token = decodeURIComponent(url.pathname.slice(3).split("/")[0] || "");
      if (!token) throw new AppError("Shared website not found.", 404, "WEBSITE_NOT_FOUND");
      const website = await websiteService.getByToken(token);
      if (!website?.html) throw new AppError("Shared website not found.", 404, "WEBSITE_NOT_FOUND");
      return send(res, 200, website.html, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" });
    }
    return await serveStatic(req, res, url);
  } catch (error) {
    const status = error.status || 500;
    const showMessage = status < 500 || String(error.code || "").endsWith("_NOT_CONFIGURED");
    if (status >= 500) {
      try {
        const { logger } = await import("./utils/logger.js");
        logger.error("request_failed", { path: req.url, method: req.method, code: error.code, message: error.message, stack: String(error.stack || "").slice(0, 800) });
      } catch {}
    }
    return json(res, status, {
      error: {
        code: error.code || "INTERNAL_SERVER_ERROR",
        message: showMessage ? error.message : "Something went wrong. Please retry; if it persists check Vercel env vars + logs.",
        details: error.details
      }
    });
  }
}
