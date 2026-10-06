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
  return error?.code === "NVIDIA_TIMEOUT" || status === 400 || status === 404 || status === 408 || status === 409 || status === 429 || status >= 500;
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
    cacheTtlMs = env.nvidia.cacheTtlMs,
    preferredModels = null
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

    const preferred = Array.isArray(preferredModels) ? preferredModels.filter(Boolean) : null;
    const queue = preferred && preferred.length
      ? [...new Set([...preferred, ...modelsToTry()])]
      : modelsToTry();
    for (const model of queue) {
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

    throw lastError || new AppError("NVIDIA AI could not complete the request.", 503, "NVIDIA_UNAVAILABLE");
  }

  completeWithModel(messages, options = {}) {
    return this.complete(messages, options);
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

  tycoonChat(prompt, context = {}) {
    const ctx = JSON.stringify(context).slice(0, 2000);
    return this.completeWithModel([
      {
        role: "system",
        content: "You are BUSINESS AI TYCOON, a ruthless professional business tycoon mentor. You think like a billionaire closer: pricing psychology, negotiation, objection handling, WhatsApp scripts, follow-up cadence, upsells, retainers. Always give: 1) What to say (copy-paste script), 2) Price to quote, 3) Why it wins, 4) Next move. Keep it practical, confident, street-smart. Plain text only, no markdown symbols."
      },
      {
        role: "user",
        content: `${String(prompt || "").slice(0, 3000)}\n\nLead context: ${ctx}`
      }
    ], { temperature: 0.5, maxTokens: 700, preferredModels: [env.nvidia.tycoonModel, "deepseek-ai/deepseek-v4.1-flash", "z-ai/glm-5.3"] });
  }

  async completeRaw(messages, { temperature = 0.7, maxTokens = 3800, timeoutMs = 60000 } = {}) {
    if (!this.configured()) {
      throw new AppError("Real NVIDIA AI requires NVIDIA_API_KEY in .env.", 503, "NVIDIA_NOT_CONFIGURED");
    }
    const invokeUrl = `${env.nvidia.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const models = modelsToTry();
    const websiteModels = [...new Set([env.nvidia.websiteModel, ...((env.nvidia.websiteFallbacks || []).length ? env.nvidia.websiteFallbacks : []), "z-ai/glm-5.3", "deepseek-ai/deepseek-v4.1-flash", ...models].filter(Boolean))];
    let lastError = null;
    for (const model of websiteModels) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(5000, timeoutMs));
      try {
        const response = await fetch(invokeUrl, {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${env.nvidia.apiKey}` },
          body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, top_p: 0.95, stream: false })
        });
        clearTimeout(timeout);
        if (!response.ok) {
          const body = await response.text();
          lastError = new AppError(`NVIDIA API request failed on ${model}: ${body.slice(0, 400)}`, response.status, "NVIDIA_API_ERROR");
          if (isRetryableNvidiaFailure(lastError)) continue;
          throw lastError;
        }
        const payload = await response.json();
        const content = payload.choices?.[0]?.message?.content || "";
        if (!content) { lastError = new AppError("Empty NVIDIA response", 503, "NVIDIA_EMPTY"); continue; }
        return { configured: true, provider: "nvidia", model, content, usage: payload.usage || null, cached: false };
      } catch (error) {
        clearTimeout(timeout);
        lastError = error?.name === "AbortError" ? new AppError(`NVIDIA model ${model} timed out.`, 504, "NVIDIA_TIMEOUT") : error;
        continue;
      }
    }
    throw lastError || new AppError("NVIDIA AI could not complete the request.", 503, "NVIDIA_UNAVAILABLE");
  }

  cleanHtml(raw) {
    let html = String(raw || "");
    html = html.replace(/```html/gi, "").replace(/```/g, "").trim();
    const start = html.toLowerCase().indexOf("<!doctype");
    if (start > 0) html = html.slice(start);
    if (!/<html/i.test(html)) html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
    return html.slice(0, 120000);
  }

  buildWebsite(lead = {}, options = {}) {
    const brief = JSON.stringify({ business: lead.name || options.businessName, type: lead.businessType || lead.category, address: lead.address, phone: lead.phone, email: lead.email, style: options.style || "modern", colors: options.palette || "emerald", sections: options.sections || ["hero", "services", "reviews", "quote", "contact"] }).slice(0, 2000);
    return this.completeRaw([
      { role: "system", content: "You are an elite website builder AI. Output ONLY complete production-ready HTML in one file, with inline CSS and minimal inline JS. Mobile-first, professional, conversion-focused: sticky nav, hero with call CTA, trust badges, services grid, gallery placeholders, testimonials, pricing/offer, booking/quote form, map/contact, footer with business details. Use the business data provided. No markdown, no explanations, only HTML code." },
      { role: "user", content: `Build a premium 5+ section business website for: ${brief}. Business name headline, click-to-call, WhatsApp style CTA, lead form, SEO title/meta. Return only HTML.` }
    ], { temperature: 0.7, maxTokens: 3800 }).then((r) => ({ ...r, html: this.cleanHtml(r.content) }));
  }

  refineWebsite(currentHtml, instruction, meta = {}) {
    return this.completeRaw([
      { role: "system", content: "You are an elite website editor AI. Return ONLY the full updated complete HTML file with inline CSS/JS. Apply the requested change perfectly while keeping everything else. No markdown, no explanations." },
      { role: "user", content: `Current site for ${meta.businessName || meta.leadName || "business"}:\n${String(currentHtml || "").slice(0, 12000)}\n\nRequested change: ${String(instruction || "").slice(0, 2000)}\n\nReturn only the full updated HTML.` }
    ], { temperature: 0.6, maxTokens: 3800 }).then((r) => ({ ...r, html: this.cleanHtml(r.content) }));
  }
}
