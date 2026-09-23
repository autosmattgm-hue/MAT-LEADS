import fs from "node:fs";
import path from "node:path";

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

function list(value, fallback = []) {
  if (!value) return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const placeholderPattern = /^(replace-with|your[-_]|change[-_]?me|example[-_]|todo)/i;

function secret(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (placeholderPattern.test(normalized) || normalized.includes("...")) return "";
  return normalized;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
  port: number(process.env.PORT, 3000),
  appUrl: process.env.APP_URL || "http://localhost:3000",
  corsOrigins: list(process.env.CORS_ORIGINS, ["http://localhost:3000"]),
  jwtSecret: secret(process.env.JWT_SECRET) || "development-jwt-secret-replace-before-production",
  jwtRefreshSecret: secret(process.env.JWT_REFRESH_SECRET) || "development-refresh-secret-replace-before-production",
  google: {
    mapsApiKey: secret(process.env.GOOGLE_MAPS_API_KEY),
    placesApiKey: secret(process.env.GOOGLE_PLACES_API_KEY) || secret(process.env.GOOGLE_MAPS_API_KEY)
  },
  osm: {
    overpassEndpoints: list(process.env.OVERPASS_ENDPOINTS, [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://api.openstreetmap.fr/oapi/interpreter"
    ])
  },
  firebase: {
    projectId: secret(process.env.FIREBASE_PROJECT_ID),
    clientEmail: secret(process.env.FIREBASE_CLIENT_EMAIL),
    privateKey: secret(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n"),
    webApiKey: secret(process.env.FIREBASE_WEB_API_KEY)
  },
  nvidia: {
    apiKey: secret(process.env.NVIDIA_API_KEY),
    baseUrl: process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
    model: process.env.NVIDIA_MODEL || "meta/llama-3.1-8b-instruct",
    modelFallbacks: list(process.env.NVIDIA_MODEL_FALLBACKS, ["meta/llama-4-maverick-17b-128e-instruct"]),
    timeoutMs: number(process.env.NVIDIA_TIMEOUT_MS, 30000),
    cacheTtlMs: number(process.env.NVIDIA_CACHE_TTL_MS, 600000),
    maxTokens: number(process.env.NVIDIA_MAX_TOKENS, 240)
  },
  stripe: {
    secretKey: secret(process.env.STRIPE_SECRET_KEY),
    webhookSecret: secret(process.env.STRIPE_WEBHOOK_SECRET)
  },
  paypal: {
    env: process.env.PAYPAL_ENV || "sandbox",
    clientId: secret(process.env.PAYPAL_CLIENT_ID),
    clientSecret: secret(process.env.PAYPAL_CLIENT_SECRET),
    paymentLinks: {
      starter: process.env.PAYPAL_STARTER_PAYMENT_LINK || "https://www.paypal.com/ncp/payment/39W6KNEUB23KN",
      professional: process.env.PAYPAL_PROFESSIONAL_PAYMENT_LINK || "https://www.paypal.com/ncp/payment/9EVHZMVYV7A52",
      growthPlus: process.env.PAYPAL_GROWTH_PLUS_PAYMENT_LINK || "https://www.paypal.com/ncp/payment/YVE74UL365V8W",
      agency: process.env.PAYPAL_AGENCY_PAYMENT_LINK || "https://www.paypal.com/ncp/payment/SY3RYMGDZ9A7E"
    }
  },
  rateLimit: {
    windowMs: number(process.env.RATE_LIMIT_WINDOW_MS, 60000),
    max: number(process.env.RATE_LIMIT_MAX, 120)
  },
  owner: {
    email: (process.env.OWNER_EMAIL || "owner@matleads.local").toLowerCase(),
    password: process.env.OWNER_PASSWORD || "admin2026"
  }
};

export function assertProductionSecrets() {
  if (!env.isProduction) return;

  const missing = [
    ["JWT_SECRET", env.jwtSecret],
    ["JWT_REFRESH_SECRET", env.jwtRefreshSecret],
    ["GOOGLE_PLACES_API_KEY", env.google.placesApiKey],
    ["NVIDIA_API_KEY", env.nvidia.apiKey],
    ["FIREBASE_PROJECT_ID", env.firebase.projectId],
    ["FIREBASE_CLIENT_EMAIL", env.firebase.clientEmail],
    ["FIREBASE_PRIVATE_KEY", env.firebase.privateKey]
  ].filter(([, value]) => !value || value.startsWith("development-"));

  if (missing.length) {
    throw new Error(`Missing production secrets: ${missing.map(([name]) => name).join(", ")}`);
  }
}
