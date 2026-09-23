import crypto from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";

const aiCache = new Map();
const modelCooldowns = new Map();
const MAX_CACHE_ENTRIES = 200;
const MODEL_COOLDOWN_MS = 2 * 60 * 1000;

function plainTextAiOutput(content) {
  return String(content || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line
      .replace(/^\s{0,3}#{1,6}\s*/g, "")
      .replace(/^\s*[*]+\s+/g, "")
      .replace(/^\s*[-]\s+/g, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[#$*]/g, "")
      .trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function withPlainTextInstruction(messages) {
  const instruction = "Formatting rule: reply in plain text only. Do not use Markdown. Do not use # headings. Do not use * bullets or bold markers. Keep answers concise.";
  return [
    {
      role: "system",
      content: instruction
    },
    ...messages
  ];
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => {
    if (item === undefined || item === null || item === "") return false;
    if (Array.isArray(item) && item.length === 0) return false;
    if (typeof item === "object" && !Array.isArray(item) && Object.keys(item).length === 0) return false;
    return true;
  }));
}

function truncateText(value, max = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function missingAuditChecks(checks = {}) {
  return Object.entries(checks)
    .filter(([, passed]) => passed === false)
    .map(([key]) => key)
    .slice(0, 8);
}

function compactLeadForAi(lead = {}) {
  const details = lead.details || {};
  const audit = lead.audit || {};
  return compactObject({
    name: lead.name,
    category: lead.businessType || lead.category,
    address: truncateText(lead.address, 180),
    country: lead.country,
    market: lead.marketName || lead.market,
    phone: lead.phone,
    email: lead.email,
    website: lead.websiteUrl,
    maps: lead.googleMapsLink,
    rating: lead.rating,
    reviews: lead.reviewsCount,
    score: lead.opportunityScore || audit.score,
    missing: missingAuditChecks(audit.checks),
    owner: details.ownerContact?.ownerName || details.ownerContact?.operator || details.ownerContact?.contactPerson,
    openingHours: truncateText(lead.openingHours || details.operations?.openingHours, 180),
    social: Object.keys(details.social || {}).slice(0, 5),
    source: lead.source
  });
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function cacheKeyFor(payload) {
  return crypto.createHash("sha256").update(stableJson(payload)).digest("hex");
}

function getCachedResult(cacheKey) {
  const cached = aiCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    aiCache.delete(cacheKey);
    return null;
  }
  return {
    ...cached.result,
    cached: true
  };
}

function setCachedResult(cacheKey, result, ttlMs) {
  if (!ttlMs || ttlMs <= 0) return;
  aiCache.set(cacheKey, {
    result,
    expiresAt: Date.now() + ttlMs
  });
  while (aiCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = aiCache.keys().next().value;
    aiCache.delete(oldestKey);
  }
}

function modelsToTry() {
  const now = Date.now();
  const models = [...new Set([env.nvidia.model, ...(env.nvidia.modelFallbacks || [])].filter(Boolean))]
    .filter((model) => (modelCooldowns.get(model) || 0) <= now);
  return models.length ? models : [...new Set([env.nvidia.model, ...(env.nvidia.modelFallbacks || [])].filter(Boolean))];
}

function isRetryableNvidiaFailure(error) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || "");
  if (error?.code === "NVIDIA_TIMEOUT") return true;
  if (status >= 500) return true;
  if ([400, 403, 404, 408, 409, 410, 422, 429].includes(status)) return true;
  return /end of life|no longer available|decommission|deprecated|unavailable|not found/i.test(message);
}

function coolDownModel(model) {
  modelCooldowns.set(model, Date.now() + MODEL_COOLDOWN_MS);
}

export class NvidiaService {
  configured() {
    return Boolean(env.nvidia.apiKey);
  }

  async complete(messages, {
    temperature = 1,
    maxTokens = env.nvidia.maxTokens,
    topP = 1,
    frequencyPenalty = 0,
    presencePenalty = 0,
    stream = false,
    timeoutMs = env.nvidia.timeoutMs,
    cacheTtlMs = env.nvidia.cacheTtlMs
  } = {}) {
    if (!this.configured()) {
      throw new AppError("Real NVIDIA AI requires NVIDIA_API_KEY in .env.", 503, "NVIDIA_NOT_CONFIGURED");
    }

    const invokeUrl = `${env.nvidia.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const basePayload = {
      messages: withPlainTextInstruction(messages),
      max_tokens: Math.max(64, Math.min(Number(maxTokens) || env.nvidia.maxTokens, 900)),
      temperature,
      top_p: topP,
      frequency_penalty: frequencyPenalty,
      presence_penalty: presencePenalty,
      stream
    };
    let lastError = null;

    for (const model of modelsToTry()) {
      const requestPayload = { ...basePayload, model };
      const cacheKey = !stream && cacheTtlMs > 0 ? cacheKeyFor(requestPayload) : "";
      const cached = cacheKey ? getCachedResult(cacheKey) : null;
      if (cached) return cached;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(3000, timeoutMs));
      let response;
      try {
        response = await fetch(invokeUrl, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "Accept": stream ? "text/event-stream" : "application/json",
            "Authorization": `Bearer ${env.nvidia.apiKey}`
          },
          body: JSON.stringify(requestPayload)
        });
      } catch (error) {
        lastError = error?.name === "AbortError"
          ? new AppError(`NVIDIA model ${model} took too long to reply.`, 504, "NVIDIA_TIMEOUT")
          : error;
        clearTimeout(timeout);
        if (isRetryableNvidiaFailure(lastError)) {
          coolDownModel(model);
          continue;
        }
        throw lastError;
      }
      clearTimeout(timeout);

      if (!response.ok) {
        const body = await response.text();
        let detail = body.slice(0, 500);
        try {
          const parsed = JSON.parse(body);
          detail = parsed.error?.message || parsed.detail || detail;
        } catch {
          // Keep the raw text detail when NVIDIA returns non-JSON errors.
        }
        lastError = new AppError(`NVIDIA API request failed on ${model}: ${detail}`, response.status, "NVIDIA_API_ERROR");
        if (isRetryableNvidiaFailure(lastError)) {
          coolDownModel(model);
          continue;
        }
        throw lastError;
      }

      const payload = await response.json();
      const content = payload.choices?.[0]?.message?.content || payload.choices?.[0]?.delta?.content || "";
      const result = {
        configured: true,
        provider: "nvidia",
        model,
        content: plainTextAiOutput(content) || "No content returned by NVIDIA model.",
        usage: payload.usage || null,
        cached: false
      };
      if (cacheKey) setCachedResult(cacheKey, result, cacheTtlMs);
      return result;
    }

    if (lastError) {
      throw new AppError(
        `No live NVIDIA model available. ${lastError.message} Update NVIDIA_MODEL and NVIDIA_MODEL_FALLBACKS in .env with a model that is still available on https://build.nvidia.com.`,
        503,
        "NVIDIA_MODELS_NOT_CONFIGURED"
      );
    }

    throw new AppError("NVIDIA AI could not complete the request.", 503, "NVIDIA_UNAVAILABLE");
  }

  chat(prompt) {
    return this.complete([
      {
        role: "system",
        content: "You are MAT LEADS AI PRO X, a practical agency growth assistant. Give concise, useful, revenue-focused answers in plain text."
      },
      {
        role: "user",
        content: truncateText(prompt, 3000)
      }
    ], { temperature: 0.4, maxTokens: env.nvidia.maxTokens });
  }

  analyzeLead(lead) {
    const leadContext = compactLeadForAi(lead);
    return this.complete([
      {
        role: "system",
        content: "You are an expert agency growth strategist. Be factual, direct, and concise. Use plain text."
      },
      {
        role: "user",
        content: `Analyze this lead for website, SEO, AI automation, and marketing opportunity. Return these labels only: Opportunity, Problems, Offer, First Outreach Angle, Revenue Estimate. Keep under 160 words. Do not use # or * characters.\n\n${JSON.stringify(leadContext)}`
      }
    ], { temperature: 0.25, maxTokens: 320 });
  }

  writeOutreach(lead, type) {
    const leadContext = compactLeadForAi(lead);
    return this.complete([
      {
        role: "system",
        content: "You write professional B2B outreach for web development, SEO, marketing, and AI automation agencies. Be specific, respectful, and concise. Use plain text."
      },
      {
        role: "user",
        content: `Write a ${type} for this business lead. Include a subject line, short email body, and one clear CTA. Keep under 150 words. Do not use # or * characters.\n\n${JSON.stringify(leadContext)}`
      }
    ], { temperature: 0.3, maxTokens: 300 });
  }
}
