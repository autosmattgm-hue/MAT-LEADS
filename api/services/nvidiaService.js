import crypto from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";

const aiCache = new Map();
const modelCooldowns = new Map();
const MAX_CACHE_ENTRIES = 200;
const MODEL_COOLDOWN_MS = 5 * 60 * 1000;

// Verified live NVIDIA NIM chat IDs (docs 2026): deepseek-v4-flash, z-ai glm-5.3-flash, moonshot kimi-k2, qwen3-next, nemotron nano.
// Retired — never call these (your error: llama-3.1-8b EOL 2026-08-26).
const DEFAULT_MODELS = [
  "z-ai/glm-5.3-flash",
  "deepseek-ai/deepseek-v4-flash",
  "deepseek-ai/deepseek-v4-flash-0731"
];
const DEAD_MODELS = new Set([
  "meta/llama-3.1-8b-instruct",
  "meta/llama-4-maverick-17b-128e-instruct",
  "deepseek-ai/deepseek-v4.1-flash",
]);

function isRetiredModel(id = "") {
  const v = String(id || "").trim();
  if (!v) return true;
  return DEAD_MODELS.has(v);
}

const providerState = {
  lastCheckedAt: null,
  lastSuccessAt: null,
  lastFailure: null
};

function isEndOfLifeError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("end of life") || msg.includes("end-of-life") || msg.includes("decommissioned") || msg.includes("retired") || msg.includes("no longer supported");
}

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
  const normalized = Array.isArray(messages) ? [...messages] : [];
  if (normalized[0]?.role === "system") {
    normalized[0] = { ...normalized[0], content: `${instruction}\n\n${normalized[0].content}` };
    return normalized;
  }
  return [{ role: "system", content: instruction }, ...normalized];
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
  const configured = [env.nvidia.model, ...(env.nvidia.modelFallbacks || [])];
  const models = [...new Set([...configured, ...DEFAULT_MODELS].map((model) => String(model || "").trim()).filter(Boolean))]
    .filter((model) => !isRetiredModel(model))
    .filter((model) => (modelCooldowns.get(model) || 0) <= now);
  return models.slice(0, 2);
}

function modelRequestOptions(model) {
  // GLM 5.3 uses reasoning by default. These interactive business workflows
  // need a direct answer, so avoid spending the request budget on it.
  if (/^z-ai\/glm-5\.3/i.test(model)) {
    return {
      reasoning_effort: "low",
      chat_template_kwargs: { clear_thinking: true }
    };
  }
  return {};
}

function requestBudget(timeoutMs, maxTotalMs) {
  const requested = Number(timeoutMs);
  return Math.max(5000, Math.min(Number.isFinite(requested) ? requested : maxTotalMs, maxTotalMs));
}

function nextAttemptTimeout(deadlineAt, attemptsRemaining, maxAttemptMs) {
  const remaining = deadlineAt - Date.now();
  if (remaining < 3000) return 0;
  const reservedForFallbacks = Math.max(0, attemptsRemaining - 1) * 3000;
  return Math.max(3000, Math.min(maxAttemptMs, remaining - reservedForFallbacks));
}

function isRetryableNvidiaFailure(error) {
  const status = Number(error?.status || 0);
  if (isEndOfLifeError(error)) return true;
  return error?.code === "NVIDIA_TIMEOUT" || error?.name === "TypeError" || status === 400 || status === 404 || status === 408 || status === 409 || status === 429 || status >= 500;
}

function friendlyAiError(error, fallback = "AI is temporarily unavailable. Please try again in a moment.") {
  const raw = String(error?.message || "");
  if (/NVIDIA_API_KEY|NVIDIA_NOT_CONFIGURED/i.test(raw)) return "AI key missing. Add NVIDIA_API_KEY in Vercel env vars, then redeploy.";
  if (isEndOfLifeError(error)) return "That model retired — switched to a live model. Please try again.";
  if (/timed out|NVIDIA_TIMEOUT|504/i.test(raw)) return "AI took too long — I retried a faster model. Please send again.";
  if (/402|PRO_REQUIRED/i.test(raw)) return raw;
  if (/401|INVALID_TOKEN|Login required/i.test(raw)) return "Please log in again, then retry.";
  if (error?.status && Number(error.status) >= 500) return `${fallback} (${raw.slice(0, 160)})`;
  return raw || fallback;
}

function publicNvidiaError(error) {
  const raw = String(error?.message || "");
  const status = Number(error?.status || 0);
  if (error?.code === "NVIDIA_NOT_CONFIGURED") return error;
  if (status === 401 || status === 403 || /authorization failed|invalid api key|invalid token|unauthorized/i.test(raw)) {
    return new AppError("NVIDIA AI authentication failed. Replace NVIDIA_API_KEY in .env or Vercel, then restart or redeploy.", 503, "NVIDIA_AUTH_FAILED");
  }
  if (status === 402 || /payment required|insufficient.*credit|billing/i.test(raw)) {
    return new AppError("NVIDIA AI has no available inference credit or model access. Check the NVIDIA account, then try again.", 503, "NVIDIA_CREDIT_REQUIRED");
  }
  if (isEndOfLifeError(error) || status === 404) {
    return new AppError("No configured NVIDIA model is available. Set NVIDIA_MODEL to deepseek-ai/deepseek-v4-flash, then restart or redeploy.", 503, "NVIDIA_MODEL_UNAVAILABLE");
  }
  if (error?.code === "NVIDIA_TIMEOUT" || status === 408 || status === 504) {
    return new AppError("NVIDIA AI timed out. Please try again in a moment.", 503, "NVIDIA_TIMEOUT");
  }
  if (status === 400 || status === 422) {
    return new AppError("NVIDIA AI rejected this request. Check the configured model IDs and try again.", 503, "NVIDIA_REQUEST_REJECTED");
  }
  return new AppError("NVIDIA AI is temporarily unavailable. Please try again in a moment.", 503, "NVIDIA_UNAVAILABLE");
}

function markProviderSuccess() {
  const at = new Date().toISOString();
  providerState.lastCheckedAt = at;
  providerState.lastSuccessAt = at;
  providerState.lastFailure = null;
}

function markProviderFailure(error) {
  providerState.lastCheckedAt = new Date().toISOString();
  providerState.lastFailure = {
    code: error.code || "NVIDIA_UNAVAILABLE",
    message: error.message || "NVIDIA AI is unavailable."
  };
}

function coolDownModel(model) {
  modelCooldowns.set(model, Date.now() + MODEL_COOLDOWN_MS);
}

export class NvidiaService {
  configured() {
    return Boolean(env.nvidia.apiKey);
  }

  status() {
    return {
      configured: this.configured(),
      verification: providerState.lastSuccessAt ? "verified" : providerState.lastFailure ? "failed" : "unverified",
      lastCheckedAt: providerState.lastCheckedAt,
      lastSuccessAt: providerState.lastSuccessAt,
      lastFailure: providerState.lastFailure
    };
  }

  sanitizeMessages(messages = []) {
    // NVIDIA chat models accept text only. Drop image_url parts (your deepseek sample) so Tycoon/Studio never 400.
    return (Array.isArray(messages) ? messages : []).map((m) => {
      const role = m?.role || "user";
      const content = m?.content;
      if (typeof content === "string") return { role, content };
      if (Array.isArray(content)) {
        const text = content.filter((p) => p?.type === "text").map((p) => String(p?.text || "")).join("\n").trim();
        return { role, content: text || "(no text provided)" };
      }
      return { role, content: String(content ?? "") };
    }).filter((m) => String(m.content || "").trim().length);
  }

  async complete(messages, {
    temperature = 0.5,
    maxTokens = env.nvidia.maxTokens,
    topP = 1,
    frequencyPenalty = 0,
    presencePenalty = 0,
    stream = false,
    timeoutMs = env.nvidia.timeoutMs,
    cacheTtlMs = env.nvidia.cacheTtlMs,
    preferredModels = null,
    maxAttempts = 2
  } = {}) {
    if (!this.configured()) {
      throw new AppError("Real NVIDIA AI requires NVIDIA_API_KEY in .env.", 503, "NVIDIA_NOT_CONFIGURED");
    }

    const invokeUrl = `${env.nvidia.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const cleanMessages = this.sanitizeMessages(messages);
    const basePayload = {
      messages: withPlainTextInstruction(cleanMessages),
      max_tokens: Math.max(64, Math.min(Number(maxTokens) || env.nvidia.maxTokens, 4096)),
      temperature: Number(temperature ?? 0.5),
      top_p: topP,
      frequency_penalty: frequencyPenalty,
      presence_penalty: presencePenalty,
      stream
    };
    let lastError = null;

    const preferred = Array.isArray(preferredModels) ? preferredModels.filter((m) => m && !isRetiredModel(m)) : null;
    const queue = [...new Set([...(preferred && preferred.length ? preferred : []), ...modelsToTry()])]
      .filter((m) => !isRetiredModel(m))
      .slice(0, Math.max(1, Math.min(Number(maxAttempts) || 2, 2)));
    if (!queue.length) throw new AppError("No usable NVIDIA model is configured. Set NVIDIA_MODEL=deepseek-ai/deepseek-v4-flash, then restart or redeploy.", 503, "NVIDIA_NO_LIVE_MODEL");
    const deadlineAt = Date.now() + requestBudget(timeoutMs, 24000);
    for (let index = 0; index < queue.length; index += 1) {
      const model = queue[index];
      const attemptTimeoutMs = nextAttemptTimeout(deadlineAt, queue.length - index, 12000);
      if (!attemptTimeoutMs) break;
      const requestPayload = { ...basePayload, ...modelRequestOptions(model), model };
      const cacheKey = !stream && cacheTtlMs > 0 ? cacheKeyFor(requestPayload) : "";
      const cached = cacheKey ? getCachedResult(cacheKey) : null;
      if (cached) return cached;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
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
        // EOL / retired models: ban for 5 min and move on instantly — don't burn the timeout.
        if (isEndOfLifeError(lastError) || isRetiredModel(model)) {
          coolDownModel(model);
          continue;
        }
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
      markProviderSuccess();
      return result;
    }

    throw lastError || new AppError("NVIDIA AI could not complete the request.", 503, "NVIDIA_UNAVAILABLE");
  }

  async completeSafe(messages, options = {}) {
    try {
      return await this.complete(messages, options);
    } catch (error) {
      const publicError = publicNvidiaError(error);
      markProviderFailure(publicError);
      throw publicError;
    }
  }

  completeWithModel(messages, options = {}) {
    return this.complete(messages, options);
  }

  chat(prompt) {
    return this.completeSafe([
      {
        role: "system",
        content: "You are MAT LEADS AI PRO X, a practical agency growth assistant. Give concise, useful, revenue-focused answers in plain text."
      },
      {
        role: "user",
        content: truncateText(prompt, 3000)
      }
    ], { temperature: 0.4, maxTokens: env.nvidia.maxTokens }, "AI is temporarily unavailable. Please check NVIDIA_API_KEY and try again.");
  }

  analyzeLead(lead) {
    const leadContext = compactLeadForAi(lead);
    const fallback = `Opportunity: Website/SEO lead for ${lead?.name || "this business"}. Problems: Missing online presence data. Offer: Website audit + rebuild. First Outreach Angle: Free audit. Revenue Estimate: $799-$1499 setup.`;
    return this.completeSafe([
      {
        role: "system",
        content: "You are an expert agency growth strategist. Be factual, direct, and concise. Use plain text."
      },
      {
        role: "user",
        content: `Analyze this lead for website, SEO, AI automation, and marketing opportunity. Return these labels only: Opportunity, Problems, Offer, First Outreach Angle, Revenue Estimate. Keep under 160 words. Do not use # or * characters.\n\n${JSON.stringify(leadContext)}`
      }
    ], { temperature: 0.25, maxTokens: 320 }, fallback);
  }

  writeOutreach(lead, type) {
    const leadContext = compactLeadForAi(lead);
    const closers = {
      cold_email: "Cold email that books a call. Subject + 3 short paragraphs + paid-audit CTA.",
      follow_up: "Polite breakup follow-up with urgency + invoice CTA.",
      website_redesign: "Website redesign pitch with 3 flaws, outcome, price anchor $799-$1499.",
      seo: "Local SEO pitch with map-pack outcome + monthly retainer anchor.",
      marketing: "Marketing growth pitch with offer + guarantee + call CTA.",
      ai_automation: "AI chatbot/automation pitch with hours saved + setup + monthly.",
      business_audit: "Paid audit pitch: sell the $149 audit before the build."
    };
    const fallback = `Subject: Quick idea for ${lead?.name || "your business"}\n\nHi, I found your listing and can help with website, WhatsApp and bookings. Reply YES for a free audit.`;
    return this.completeSafe([
      {
        role: "system",
        content: "You write professional B2B outreach for web development, SEO, marketing, and AI automation agencies. Be specific, respectful, and concise. Use plain text. Always end with a clear money CTA."
      },
      {
        role: "user",
        content: `Write a ${closers[type] || type} for this business lead. Include a subject line, short email body, and one clear CTA. Keep under 150 words. Do not use # or * characters.\n\n${JSON.stringify(leadContext)}`
      }
    ], { temperature: 0.3, maxTokens: 300 }, fallback);
  }

  proposalPack(lead, offerKey = "pro_site") {
    const leadContext = compactLeadForAi(lead);
    const fallback = `Proposal for ${lead?.name || "your business"}: Website rebuild, WhatsApp + booking setup, $799-$1499, 7-14 days. Reply YES to approve.`;
    return this.completeSafe([
      { role: "system", content: "You are a proposal writer for agencies. Plain text only. Structure: Problem, Offer, Deliverables, Timeline, Price, Guarantee, Next step to pay." },
      { role: "user", content: `Write a client-ready proposal for offer ${offerKey} for this lead. Keep under 260 words. No markdown.\n\n${JSON.stringify(leadContext)}` }
    ], { temperature: 0.4, maxTokens: 500 }, fallback);
  }

  tycoonChat(prompt, context = {}) {
    const ctx = JSON.stringify(context).slice(0, 2000);
    const fallback = `What to say: Hi, I can rebuild your online presence with WhatsApp bookings. Price to quote: $799 setup + $99/mo care. Why it wins: direct bookings. Next move: send audit + pay link.`;
    return this.completeSafe([
      {
        role: "system",
        content: "You are BUSINESS AI TYCOON, a ruthless professional business tycoon mentor. You think like a billionaire closer: pricing psychology, negotiation, objection handling, WhatsApp scripts, follow-up cadence, upsells, retainers. Always give: 1) What to say (copy-paste script), 2) Price to quote, 3) Why it wins, 4) Next move. Keep it practical, confident, street-smart. Plain text only, no markdown symbols."
      },
      {
        role: "user",
        content: `${String(prompt || "").slice(0, 1200)}\n\nLead context: ${ctx}`
      }
    ], { temperature: 0.5, topP: 1, maxTokens: 360, timeoutMs: env.nvidia.timeoutMs, cacheTtlMs: 600000, preferredModels: [env.nvidia.tycoonModel, "z-ai/glm-5.3-flash", "deepseek-ai/deepseek-v4-flash"], maxAttempts: 2 });
  }

  async completeRaw(messages, { temperature = 0.5, topP = 1, maxTokens = 2200, timeoutMs = 0 } = {}) {
    if (!this.configured()) {
      throw new AppError("Real NVIDIA AI requires NVIDIA_API_KEY in .env.", 503, "NVIDIA_NOT_CONFIGURED");
    }
    const invokeUrl = `${env.nvidia.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const models = modelsToTry();
    const websiteModels = [...new Set([env.nvidia.websiteModel, ...(env.nvidia.websiteFallbacks || []), ...models].map((model) => String(model || "").trim()).filter(Boolean))]
      .filter((model) => !isRetiredModel(model))
      .slice(0, 2);
    const deadlineAt = Date.now() + requestBudget(timeoutMs || env.nvidia.websiteTimeoutMs, 20000);
    const cleanMessages = this.sanitizeMessages(messages);
    let lastError = null;
    for (let index = 0; index < websiteModels.length; index += 1) {
      const model = websiteModels[index];
      const attemptTimeoutMs = nextAttemptTimeout(deadlineAt, websiteModels.length - index, 14000);
      if (!attemptTimeoutMs) break;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
      try {
        const response = await fetch(invokeUrl, {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${env.nvidia.apiKey}` },
          body: JSON.stringify({ model, ...modelRequestOptions(model), messages: cleanMessages, max_tokens: maxTokens, temperature: Number(temperature ?? 0.5), top_p: topP ?? 1, stream: false })
        });
        clearTimeout(timeout);
        if (!response.ok) {
          const body = await response.text();
          lastError = new AppError(`NVIDIA API request failed on ${model}: ${body.slice(0, 400)}`, response.status, "NVIDIA_API_ERROR");
          if (isEndOfLifeError(lastError) || isRetiredModel(model)) {
            coolDownModel(model);
            continue;
          }
          if (isRetryableNvidiaFailure(lastError)) continue;
          throw lastError;
        }
        const payload = await response.json();
        const content = payload.choices?.[0]?.message?.content || "";
        if (!content) { lastError = new AppError("Empty NVIDIA response", 503, "NVIDIA_EMPTY"); continue; }
        markProviderSuccess();
        return { configured: true, provider: "nvidia", model, content, usage: payload.usage || null, cached: false };
      } catch (error) {
        clearTimeout(timeout);
        lastError = error?.name === "AbortError" ? new AppError(`NVIDIA model ${model} timed out.`, 504, "NVIDIA_TIMEOUT") : error;
        if (isRetryableNvidiaFailure(lastError)) {
          coolDownModel(model);
          continue;
        }
        throw lastError;
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
    const brief = JSON.stringify({ business: lead.name || options.businessName, type: lead.businessType || lead.category, address: lead.address, phone: lead.phone, email: lead.email, style: options.style || "modern", colors: options.palette || "emerald", sections: options.sections || ["hero", "services", "reviews", "quote", "contact"] }).slice(0, 1500);
    return this.completeRaw([
      { role: "system", content: "You are an elite website builder AI. Output ONLY a complete, concise, production-ready one-page HTML file with inline CSS and minimal inline JS. Mobile-first and conversion-focused: hero, proof, services, offer, contact form, footer. Keep the complete response under 1100 tokens. No markdown or explanations." },
      { role: "user", content: `Build a premium client website for: ${brief}. Include click-to-call or WhatsApp-style CTA, one clear conversion form, SEO title/meta and only the needed sections. Return only complete HTML.` }
    ], { temperature: 0.3, maxTokens: 1100, timeoutMs: 18000 })
      .then((r) => ({ ...r, html: this.cleanHtml(r.content) }))
      .catch((error) => {
        const publicError = publicNvidiaError(error);
        markProviderFailure(publicError);
        throw publicError;
      });
  }

  refineWebsite(currentHtml, instruction, meta = {}) {
    return this.completeRaw([
      { role: "system", content: "You are an elite website editor AI. Return ONLY the complete updated HTML file with inline CSS/JS. Keep the response concise and under 1100 tokens. Apply the requested change and preserve the core business details. No markdown or explanations." },
      { role: "user", content: `Current site for ${meta.businessName || meta.leadName || "business"}:\n${String(currentHtml || "").slice(0, 6000)}\n\nRequested change: ${String(instruction || "").slice(0, 800)}\n\nReturn only the full updated HTML.` }
    ], { temperature: 0.3, maxTokens: 1100, timeoutMs: 18000 })
      .then((r) => ({ ...r, html: this.cleanHtml(r.content) }))
      .catch((error) => {
        const publicError = publicNvidiaError(error);
        markProviderFailure(publicError);
        throw publicError;
      });
  }
}
