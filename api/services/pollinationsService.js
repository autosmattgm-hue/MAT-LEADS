import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";

const POLLINATIONS = {
  GEN_BASE: "https://gen.pollinations.ai",
  MODELS: {
    // Cheap, fast, non-reasoning flagship default for interactive workloads.
    TEXT_DEFAULT: "openai/gpt-5.4-nano",
    TEXT_FALLBACKS: ["openai/gpt-5-nano", "google/gemini-3-flash-preview", "openai/gpt-4o-mini"],
    // Website builds want large, reliable instruction followers.
    WEBSITE_DEFAULT: "openai/gpt-5.4",
    WEBSITE_FALLBACKS: ["openai/gpt-5.4-mini", "google/gemini-3-flash-preview", "openai/gpt-4o-mini"],
    IMAGE_DEFAULT: "black-forest-labs/flux.1-schnell",
    VIDEO_DEFAULT: "google/veo-3.1-fast",
    EMBEDDING_DEFAULT: "openai/text-embedding-3-small",
    AUDIO_VOICE_DEFAULT: "nova",
    TTS_MODEL_DEFAULT: "openai/tts-1",
    STT_MODEL_DEFAULT: "openai/whisper-large-v3",
    TRANSCRIBE_MODEL_DEFAULT: "openai/gpt-transcribe",
    THREE_D_MODEL_DEFAULT: "microsoft/trellis-2",
  },
  TEXT_CHAT: "/v1/chat/completions",
  IMAGE: "/image",
  AUDIO: "/audio",
  VIDEO: "/video",
  THREE_D: "/3d",
  EMBEDDINGS: "/v1/embeddings",
  MODELS_LIST: "/v1/models",
};

const PROVIDER = "pollinations";

function publicPollinationsError(error) {
  const m = String(error?.message || "").toLowerCase();
  if (m.includes("end of life") || m.includes("end-of-life") || m.includes("decommissioned") || m.includes("retired") || m.includes("no longer supported") || m.includes("not found")) {
    return new AppError("The AI provider endpoint is no longer available. Check POLLINATIONS_API_KEY and retry.", 503, "POLLINATIONS_EOL");
  }
  if (m.includes("401") || m.includes("403") || m.includes("unauthorized") || m.includes("forbidden")) {
    return new AppError("The AI provider key is missing or invalid. Add POLLINATIONS_API_KEY to .env and restart.", 503, "POLLINATIONS_AUTH_FAILED");
  }
  if (m.includes("402") || m.includes("quota") || m.includes("insufficient") || m.includes("credit")) {
    return new AppError("The AI provider free quota is exceeded. Add a valid key or check your balance.", 503, "POLLINATIONS_QUOTA_EXCEEDED");
  }
  if (m.includes("429") || m.includes("rate limit") || m.includes("too many requests")) {
    return new AppError("The AI provider is rate-limiting this request. Pause and retry.", 503, "POLLINATIONS_RATE_LIMITED");
  }
  if (String(error?.name || "").toLowerCase() === "aborterror" || /timed out/i.test(String(error?.message || ""))) {
    return new AppError("The AI provider timed out. Please retry.", 504, "POLLINATIONS_TIMEOUT");
  }
  if (m.includes("404") || m.includes("not found") || m.includes("model not found") || m.includes("endpoint not found")) {
    return new AppError("The AI provider returned a 404. Check the configured model and retry.", 503, "POLLINATIONS_NOT_FOUND");
  }
  return new AppError("The AI provider request failed. Click Generate again to retry.", 503, "POLLINATIONS_UNAVAILABLE");
}

function fetchJson(url, options) {
  return fetch(url, options).then(async (response) => {
    const text = await response.text();
    let payload = null;
    const ct = response.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    } else {
      payload = { raw: text };
    }
    if (!response.ok) {
      const status = response.status;
      const message = status === 401 || status === 403 ? "Unauthorized" : text ? String(text).slice(0, 200) : "Request failed";
      const error = new Error(message);
      error.name = "POLLINATIONS_" + status;
      error.status = status;
      error.code = "POLLINATIONS_" + status;
      throw error;
    }
    return payload;
  });
}

export class PollinationsService {
  constructor() {
    this.refreshConfig();
  }

  refreshConfig() {
    this.baseUrl = String(env.pollinations.baseUrl || POLLINATIONS.GEN_BASE).replace(/\/$/, "");
    this.configured = Boolean(env.pollinations.apiKey);
    return this;
  }

  configured() {
    return Boolean(env.pollinations.apiKey);
  }

  setKey(key) {
    if (key) env.pollinations.apiKey = key;
    this.refreshConfig();
  }

  authHeaders(extra = {}) {
    const key = env.pollinations.apiKey;
    return { ...(key ? { Authorization: "Bearer " + key } : {}), ...extra };
  }

  resolveTextModels(requested, fallbackPool) {
    const models = [requested, ...(Array.isArray(fallbackPool) ? fallbackPool : [])]
      .map((m) => String(m || "").trim())
      .filter(Boolean);
    return [...new Set(models)].slice(0, 3);
  }

  async send(domain, payload = {}, options = {}) {
    if (!this.configured) {
      throw new AppError("Real AI requires POLLINATIONS_API_KEY in .env.", 503, "POLLINATIONS_NOT_CONFIGURED");
    }
    switch (domain) {
      case "text":
        return this.text(payload, options);
      case "image":
        return this.image(payload, options);
      case "audio":
        return this.audio(payload, options);
      case "video":
        return this.video(payload, options);
      case "3d":
        return this._3d(payload, options);
      case "embeddings":
        return this.embeddings(payload, options);
      default:
        throw new AppError("Unknown AI domain: " + domain, 400, "POLLINATIONS_INVALID_DOMAIN");
    }
  }

  async text(messages, options = {}) {
    const {
      temperature = 0.5,
      maxTokens = 2000,
      topP = 1,
      model = POLLINATIONS.MODELS.TEXT_DEFAULT,
      fallbackModels = POLLINATIONS.MODELS.TEXT_FALLBACKS,
      timeoutMs = 60000,
      safe = undefined,
    } = options;
    const cleanMessages = Array.isArray(messages) ? messages : [{ role: "user", content: String(messages ?? "") }];
    const queue = this.resolveTextModels(model, fallbackModels);
    const safety = safe === undefined || safe === null || safe === false || safe === 0 ? {} : { safe: Array.isArray(safe) ? safe.join(",") : String(safe) };
    let lastError = null;
    for (const attempt of queue) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(5000, Number(timeoutMs) || 60000));
      try {
        const body = {
          model: attempt,
          messages: cleanMessages,
          max_tokens: Math.min(Math.max(Number(maxTokens) || 2000, 100), 8192),
          temperature: Number(temperature ?? 0.5),
          top_p: Number(topP ?? 1),
          stream: false,
          ...safety,
        };
        const response = await fetchJson(this.baseUrl + POLLINATIONS.TEXT_CHAT, {
          method: "POST",
          signal: controller.signal,
          headers: this.authHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
          body: JSON.stringify(body),
        });
        let content = null;
        if (response.output !== undefined) content = String(response.output || "");
        else if (response.output_text !== undefined) content = String(response.output_text || "");
        else if (response.choices && Array.isArray(response.choices)) {
          const c = response.choices[0] || {};
          if (c.message && c.message.content !== undefined) content = String(c.message.content ?? "");
          else if (c.text !== undefined) content = String(c.text ?? "");
          else if (typeof c.content === "string") content = c.content;
        } else if (response.content !== undefined) content = String(response.content || "");
        else if (response.text !== undefined) content = String(response.text || "");
        if (!content || !String(content).trim()) {
          throw new AppError("Pollinations AI returned an empty response.", 503, "POLLINATIONS_EMPTY");
        }
        return { configured: true, provider: PROVIDER, model: attempt, content, usage: response.usage || null, cached: false };
      } catch (error) {
        lastError = error;
        const msg = String(error?.message || "").toLowerCase();
        // Auth/quota/config mistakes should surface immediately, not burn retries.
        if (/unauthorized|forbidden|invalid api key|not_configured|402|quota|insufficient/i.test(msg)) break;
      } finally {
        clearTimeout(timer);
      }
    }
    throw publicPollinationsError(lastError || new Error("Pollinations AI request failed."));
  }

  async image(payload = {}, options = {}) {
    const {
      prompt, model = POLLINATIONS.MODELS.IMAGE_DEFAULT, seed = null,
      width = null, height = null, nologo = true, safe = undefined, referrer = null,
    } = payload;
    const cleanPrompt = String(prompt || "").trim();
    if (!cleanPrompt) throw new AppError("Image prompt is required.", 400, "POLLINATIONS_INVALID_IMAGE");
    let url = this.baseUrl + POLLINATIONS.IMAGE + "/" + encodeURIComponent(cleanPrompt);
    const params = new URLSearchParams();
    params.set("model", String(model || POLLINATIONS.MODELS.IMAGE_DEFAULT));
    if (seed !== null && seed !== undefined && String(seed) !== "") params.set("seed", String(seed));
    if (width) params.set("width", String(width));
    if (height) params.set("height", String(height));
    if (nologo !== false) params.set("nologo", "true");
    if (safe !== undefined && safe !== null && safe !== false && safe !== 0 && safe !== "") {
      params.set("safe", Array.isArray(safe) ? safe.join(",") : String(safe));
    }
    if (referrer) params.set("referrer", String(referrer));
    if (env.pollinations.apiKey) params.set("key", env.pollinations.apiKey);
    url += "?" + params.toString();
    const response = await fetch(url, { headers: { ...this.authHeaders(), Accept: "image/*" }, signal: options.signal });
    if (!response.ok) throw publicPollinationsError(new Error("Image request failed: " + response.status));
    const arrayBuffer = await response.arrayBuffer();
    return { provider: PROVIDER, model: String(model), format: response.headers.get("content-type") || "image/jpeg", data: Buffer.from(arrayBuffer).toString("base64"), url };
  }

  async audio(payload = {}, options = {}) {
    // Pollinations simple TTS/music endpoint: GET /audio/{text}?model=&voice=
    const { text, model = null, voice = POLLINATIONS.MODELS.AUDIO_VOICE_DEFAULT } = payload;
    const cleanText = String(text || "").trim();
    if (!cleanText) throw new AppError("Audio text is required.", 400, "POLLINATIONS_INVALID_AUDIO");
    let url = this.baseUrl + POLLINATIONS.AUDIO + "/" + encodeURIComponent(cleanText);
    const params = new URLSearchParams();
    if (model) params.set("model", String(model));
    if (voice) params.set("voice", String(voice));
    if (env.pollinations.apiKey) params.set("key", env.pollinations.apiKey);
    url += "?" + params.toString();
    const response = await fetch(url, { headers: { ...this.authHeaders(), Accept: "audio/*" }, signal: options.signal });
    if (!response.ok) throw publicPollinationsError(new Error("Audio request failed: " + response.status));
    const arrayBuffer = await response.arrayBuffer();
    return { provider: PROVIDER, model: String(model || "audio-default"), voice: String(voice || ""), format: response.headers.get("content-type") || "audio/mpeg", data: Buffer.from(arrayBuffer).toString("base64"), url };
  }

  async transcribeAudio(payload = {}, options = {}) {
    // OpenAI-compatible speech-to-text: POST /v1/audio/transcriptions (multipart or JSON with file/url/audio).
    const { model = POLLINATIONS.MODELS.STT_MODEL_DEFAULT, file = null, url = null, audio = null, language = null } = payload;
    const endpoint = this.baseUrl + "/v1/audio/transcriptions";
    if (file && typeof file === "object" && (file.buffer || file.path || file.stream)) {
      const form = new FormData();
      form.append("model", String(model));
      const blob = file.buffer ? new Blob([file.buffer], { type: file.mimetype || "audio/mpeg" }) : file.stream;
      form.append("file", blob, file.name || "audio.mp3");
      if (language) form.append("language", String(language));
      const headers = this.authHeaders();
      delete headers["Content-Type"];
      const response = await fetchJson(endpoint, { method: "POST", headers, body: form, signal: options.signal });
      const text = response.text ?? response.transcription ?? response.data ?? "";
      return { provider: PROVIDER, model: String(model), text: String(text || ""), raw: response };
    }
    const response = await fetchJson(endpoint, {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify({ model: String(model), ...(url ? { url } : {}), ...(audio ? { audio } : {}), ...(language ? { language } : {}) }),
      signal: options.signal,
    });
    const text = response.text ?? response.transcription ?? response.data ?? "";
    return { provider: PROVIDER, model: String(model), text: String(text || ""), raw: response };
  }

  async speak(payload = {}, options = {}) {
    // OpenAI-compatible TTS: POST /v1/audio/speech -> binary audio body.
    const { model = POLLINATIONS.MODELS.TTS_MODEL_DEFAULT, input, voice = POLLINATIONS.MODELS.AUDIO_VOICE_DEFAULT, response_format = "mp3" } = payload;
    const cleanInput = String(input || "").trim();
    if (!cleanInput) throw new AppError("Speech input text is required.", 400, "POLLINATIONS_INVALID_SPEECH");
    const response = await fetch(this.baseUrl + "/v1/audio/speech", {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json", Accept: "audio/*" }),
      body: JSON.stringify({ model: String(model), input: cleanInput, voice: String(voice), response_format }),
      signal: options.signal,
    });
    if (!response.ok) throw publicPollinationsError(new Error("Speech request failed: " + response.status));
    const arrayBuffer = await response.arrayBuffer();
    return { provider: PROVIDER, model: String(model), voice: String(voice), format: response.headers.get("content-type") || "audio/mpeg", data: Buffer.from(arrayBuffer).toString("base64") };
  }

  async video(payload = {}, options = {}) {
    const { prompt, model = POLLINATIONS.MODELS.VIDEO_DEFAULT, duration = null, image = null, seed = null } = payload;
    const cleanPrompt = String(prompt || "").trim();
    if (!cleanPrompt) throw new AppError("Video prompt is required.", 400, "POLLINATIONS_INVALID_VIDEO");
    let url = this.baseUrl + POLLINATIONS.VIDEO + "/" + encodeURIComponent(cleanPrompt);
    const params = new URLSearchParams();
    if (model) params.set("model", String(model));
    if (duration !== null && duration !== undefined && String(duration) !== "") params.set("duration", String(duration));
    if (seed !== null && seed !== undefined && String(seed) !== "") params.set("seed", String(seed));
    if (Array.isArray(image)) image.filter(Boolean).forEach((u) => params.append("image", String(u)));
    else if (image) params.set("image", String(image));
    if (env.pollinations.apiKey) params.set("key", env.pollinations.apiKey);
    url += "?" + params.toString();
    const response = await fetch(url, { headers: { ...this.authHeaders(), Accept: "video/*" }, signal: options.signal });
    if (!response.ok) throw publicPollinationsError(new Error("Video request failed: " + response.status));
    const arrayBuffer = await response.arrayBuffer();
    return { provider: PROVIDER, model: String(model), format: response.headers.get("content-type") || "video/mp4", data: Buffer.from(arrayBuffer).toString("base64"), url };
  }

  async _3d(payload = {}, options = {}) {
    // GET /3d/{prompt}?model=&image=&resolution= — Trellis family uses the image, not the text.
    const { prompt = "no_prompt_for_trellis_needed", model = POLLINATIONS.MODELS.THREE_D_MODEL_DEFAULT, image = null, resolution = "low" } = payload;
    const cleanPrompt = String(prompt || "no_prompt_for_trellis_needed").trim() || "no_prompt_for_trellis_needed";
    let url = this.baseUrl + POLLINATIONS.THREE_D + "/" + encodeURIComponent(cleanPrompt);
    const params = new URLSearchParams();
    if (model) params.set("model", String(model));
    if (resolution) params.set("resolution", String(resolution));
    if (image) params.set("image", String(image));
    if (env.pollinations.apiKey) params.set("key", env.pollinations.apiKey);
    url += "?" + params.toString();
    const response = await fetch(url, { headers: { ...this.authHeaders(), Accept: "model/gltf-binary,model/*" }, signal: options.signal });
    if (!response.ok) throw publicPollinationsError(new Error("3D request failed: " + response.status));
    const arrayBuffer = await response.arrayBuffer();
    return { provider: PROVIDER, model: String(model), format: response.headers.get("content-type") || "model/gltf-binary", data: Buffer.from(arrayBuffer).toString("base64"), url };
  }

  async embeddings(payload = {}, options = {}) {
    const { model = POLLINATIONS.MODELS.EMBEDDING_DEFAULT, input, dimensions = null, encoding_format = "float" } = payload;
    if (input === undefined || input === null || (typeof input === "string" && !input.trim() && !Array.isArray(input))) {
      throw new AppError("Embedding input is required.", 400, "POLLINATIONS_INVALID_EMBEDDING");
    }
    const items = Array.isArray(input) ? input : [input];
    if (items.length > 32) throw new AppError("Embedding batch input supports up to 32 items.", 400, "POLLINATIONS_INVALID_EMBEDDING");
    const body = { model: String(model), input: items };
    if (dimensions !== null && dimensions !== undefined && String(dimensions) !== "") body.dimensions = Number(dimensions);
    if (encoding_format) body.encoding_format = encoding_format;
    const url = this.baseUrl + POLLINATIONS.EMBEDDINGS;
    const response = await fetchJson(url, {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify(body),
      signal: options.signal,
    });
    const data = response.data || response.embeddings || [];
    return { provider: PROVIDER, model: String(model), count: Array.isArray(data) ? data.length : 0, data, usage: response.usage || null };
  }

  async listModels(params = {}, options = {}) {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && String(v) !== "") search.set(k, String(v));
    }
    const url = this.baseUrl + POLLINATIONS.MODELS_LIST + (search.toString() ? "?" + search.toString() : "");
    return fetchJson(url, { headers: this.authHeaders({ Accept: "application/json" }), signal: options.signal });
  }

  fallbackPageFragment(spec, lead, hero, gallery, isHome) {
    const name = String(lead?.name || "Your Business");
    const type = String(lead?.businessType || lead?.category || "Local Business");
    const address = String(lead?.address || "");
    const phone = String(lead?.phone || "");
    const email = String(lead?.email || "");
    const card = (h, p) => "<div style=\"background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px\"><h3 style=\"margin:.1em 0 .3em\">" + h + "</h3><p style=\"margin:0;color:#475569\">" + p + "</p></div>";
    if (isHome) {
      return "<img src=\"" + hero + "\" alt=\"" + name + "\" style=\"width:100%;max-height:420px;object-fit:cover;display:block\"><h1>" + name + " — " + type + "</h1><p>" + address + "</p><p>Phone: " + phone + "</p><p>Email: " + email + "</p><button>Get a Free Quote</button>" + card("Services", "What we do");
    }
    return "<h1>" + spec.title + "</h1><p>" + spec.focus + "</p>";
  }

  assembleMultiPage(pages, business, accent) {
    const e = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const navLinks = pages.map((p, i) => "<a href=\"#\" class=\"nav-a" + (i === 0 ? " active" : "") + "\" onclick=\"return showPage(" + i + ")\">" + e(p.title) + "</a>").join("");
    const sections = pages.map((p, i) => "<section class=\"pg\" id=\"pg-" + i + "\"" + (i === 0 ? "" : " style=\"display:none\"") + ">" + p.body + "</section>").join("");
    return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + e(business) + "</title><meta name=\"description\" content=\"" + e(business) + " — a professional website built to turn visitors into customers.\"><style>*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,Arial,sans-serif;color:#0f172a;background:#f8fafc;line-height:1.55}.nav{position:sticky;top:0;z-index:50;background:#0b1220;display:flex;gap:4px;align-items:center;padding:10px 16px;flex-wrap:wrap;box-shadow:0 2px 10px rgba(0,0,0,.15)}.nav .brand{color:#fff;font-weight:800;margin-right:auto;font-size:1.05rem}.nav-a{color:#cbd5e1;text-decoration:none;padding:8px 13px;border-radius:8px;font-weight:600;cursor:pointer;font-size:.95rem}.nav-a:hover{background:rgba(255,255,255,.1);color:#fff}.nav-a.active{background:" + accent + ";color:#06281a}img{max-width:100%;height:auto}.wrap{max-width:1080px;margin:0 auto;padding:30px 20px}input,textarea{font:inherit}footer{background:#0b1220;color:#cbd5e1;text-align:center;padding:20px;font-size:.9rem}</style></head><body><nav class=\"nav\"><span class=\"brand\">" + e(business) + "</span>" + navLinks + "</nav>" + sections + "<footer>© " + new Date().getFullYear() + " " + e(business) + ". All rights reserved.</footer><script>function showPage(i){document.querySelectorAll('.pg').forEach(function(s,idx){s.style.display=idx===i?'block':'none'});document.querySelectorAll('.nav-a').forEach(function(a,idx){a.classList.toggle('active',idx===i)});window.scrollTo(0,0);return false;}</script></body></html>";
  }

  async buildWebsite(lead = {}, options = {}) {
    const imgs = options.images || {};
    const heroImg = String(imgs.hero || "").trim();
    const galleryImgs = Array.isArray(imgs.gallery) ? imgs.gallery.map((g) => String(g || "").trim()).filter(Boolean).slice(0, 6) : [];
    const seedWord = String(lead.businessType || lead.category || options.businessName || "business").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) || "business";
    const autoHero = "https://picsum.photos/seed/" + encodeURIComponent(seedWord) + "/1600/900";
    const autoGallery = [1, 2, 3].map((n) => "https://picsum.photos/seed/" + encodeURIComponent(seedWord + "-" + n) + "/800/600");
    const hero = heroImg || autoHero;
    const gallery = galleryImgs.length ? galleryImgs : autoGallery;
    const accentMap = { emerald: "#22c55e", blue: "#2563eb", gold: "#d4af37", rose: "#e11d48", teal: "#14b8a6", purple: "#7c3aed", orange: "#f97316" };
    const accent = accentMap[options.palette] || "#22c55e";
    const pageCount = Math.min(4, Math.max(1, parseInt(options.pages, 10) || 1));
    const allSpecs = [
      { id: "home", title: "Home", focus: "a full-width hero image + headline + call button, a short intro, a 3-item highlights row, and the gallery images in one responsive row" },
      { id: "about", title: "About", focus: "our story, why choose us, trust points and a values/team section" },
      { id: "services", title: "Services", focus: "a detailed services grid (4-6 services with short descriptions) plus a packages/pricing row" },
      { id: "contact", title: "Contact", focus: "a contact form (name, email, message), a click-to-call button, address and hours" }
    ];
    const pageSpecs = allSpecs.slice(0, pageCount);
    const business = String(lead.name || options.businessName || "Your Business");
    const brief = JSON.stringify({ business, type: lead.businessType || lead.category, address: lead.address, phone: lead.phone, email: lead.email, style: options.style || "modern", colors: options.palette || "emerald", images: { hero, gallery } }).slice(0, 1500);
    const request = (maxTokens, note) => {
      const system = "You are an elite website builder. Output ONLY the inner content for a " + pageCount + "-page business website. RULES: (1) Separate each page with the exact marker <!--PAGE--> on its own line, and emit exactly " + pageCount + " page(s) in this order: " + pageSpecs.map((p) => p.title).join(", ") + ". (2) Do NOT output <!doctype>, <html>, <head>, <body> or <nav> — only the page content. (3) You MAY put ONE compact single-line <style> block at the very top. (4) Use the exact image URLs from the brief in real <img> tags; never leave src empty. (5) Be CONCISE: the ENTIRE output under ~1500 tokens. (6) No markdown, no explanations, no code fences.";
      const user = "Build the " + pageCount + " page section(s) for: " + brief + ". Page focuses: " + pageSpecs.map((p) => p.title + " = " + p.focus).join("; ") + ". Hero uses images.hero; put images.gallery URLs in an <img> row on the Home page. Separate every page with <!--PAGE-->. " + (note || "");
      return this.text([{ role: "system", content: system }, { role: "user", content: user }], { temperature: 0.3, maxTokens, timeoutMs: Math.max(30000, 50000) });
    };
    let result = await request(1500);
    let content = String(result.content || "");
    if (content.replace(/<!--PAGE-->/gi, "").trim().length < 300) {
      try {
        const retry = await request(2200, "Remember to separate each page with <!--PAGE--> and end cleanly.");
        if (String(retry.content || "").length > content.length) {
          result = retry;
          content = String(retry.content || "");
        }
      } catch {
        /* keep first attempt */
      }
    }
    const fragments = content.split(/<!--PAGE-->/i).map((s) => s.trim()).filter(Boolean);
    const pages = pageSpecs.map((spec, i) => ({ ...spec, body: fragments[i] && fragments[i].length > 40 ? fragments[i] : this.fallbackPageFragment(spec, lead, hero, gallery, i === 0) }));
    return { ...result, html: this.assembleMultiPage(pages, business, accent), pageCount: pages.length };
  }

  refineWebsite(currentHtml, instruction, meta = {}) {
    const instructions = [
      { role: "system", content: "You are an elite website editor AI. Return ONLY the complete updated HTML file with inline CSS/JS." },
      { role: "user", content: "Current site for " + (meta.businessName || meta.leadName || "business") + ":\n" + String(currentHtml || "").slice(0, 6000) + "\n\nRequested change: " + String(instruction || "").slice(0, 800) + "\n\nReturn only the full updated HTML." }
    ];
    return this.text(instructions, { temperature: 0.3, maxTokens: 1100, timeoutMs: 18000 })
      .then((r) => ({ ...r, html: r.content }))
      .catch((error) => {
        throw publicPollinationsError(error);
      });
  }
}
