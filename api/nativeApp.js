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
import { AppError } from "./utils/errors.js";
import { aiSchemas, authSchemas, billingSchema, crmSchemas, leadSearchSchema, paypalConfirmationSchema, profileSchema, settingsSchema } from "./utils/schemas.js";
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
  "/manifest.webmanifest",
  "/sw.js",
  "/robots.txt",
  "/sitemap.xml"
]);
const publicFolders = ["/css/", "/js/", "/assets/", "/components/"];

function securityHeaders() {
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
      "frame-ancestors 'none'"
    ].join("; "),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Permitted-Cross-Domain-Policies": "none"
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
    return await serveStatic(req, res, url);
  } catch (error) {
    const status = error.status || 500;
    const showMessage = status < 500 || String(error.code || "").endsWith("_NOT_CONFIGURED");
    return json(res, status, {
      error: {
        code: error.code || "INTERNAL_SERVER_ERROR",
        message: showMessage ? error.message : "Something went wrong.",
        details: error.details
      }
    });
  }
}
