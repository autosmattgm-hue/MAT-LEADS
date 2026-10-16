import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";

const POLLINATIONS = {
  GEN_BASE: "https://gen.pollinations.ai",
  MODELS: {
    // Cheap, fast, non-reasoning flagship default for interactive workloads.
    // Overridable via POLLINATIONS_TEXT_MODEL so owners can pin a model their key allows.
    TEXT_DEFAULT: "openai/gpt-5.4-nano",
    TEXT_FALLBACKS: ["openai/gpt-5-nano", "openai/gpt-oss-20b", "google/gemini-3-flash-preview", "openai/gpt-4o-mini", "mistralai/mistral-small-3.2", "meta/llama-3.3-70b-instruct"],
    // Website builds want large, reliable instruction followers.
    // Overridable via POLLINATIONS_WEBSITE_MODEL.
    WEBSITE_DEFAULT: "openai/gpt-5.4",
    WEBSITE_FALLBACKS: ["qwen/qwen3-coder-30b-a3b-instruct", "openai/gpt-5.4-mini", "openai/gpt-5.5", "moonshotai/kimi-k2.6", "openai/gpt-5-nano", "google/gemini-3-flash-preview", "openai/gpt-4o-mini", "mistralai/mistral-small-3.2"],
    // Output budget for a COMPLETE professional multi-page site (fragments, not full docs).
    WEBSITE_TOKENS_FIRST: 4000,
    WEBSITE_TOKENS_RETRY: 5200,
    WEBSITE_TIMEOUT_MS: 120000,
    // Minimum body chars per page before we call the build incomplete.
    WEBSITE_MIN_PAGE_CHARS: 1200,
    // Minimum total fragment chars before we retry the build.
    WEBSITE_MIN_TOTAL_CHARS: 2600,
    DESIGN_ARCHETYPES: [
      { id: "luxe-dark", label: "Luxe dark", vibe: "deep charcoal plus gold accents, big serif headlines, generous whitespace", hero: "full-bleed image with dark overlay and centered serif headline", sections: "stats row first, then image plus text split, then process steps" },
      { id: "editorial", label: "Editorial", vibe: "off-white paper background, strong typographic hierarchy, thin rules", hero: "left-aligned oversized headline with small kickers and inline image", sections: "image plus text split first, then services grid, then testimonial band" },
      { id: "bold-agency", label: "Bold agency", vibe: "high-contrast blocks of brand color, chunky headings, badges", hero: "split-screen hero with headline left and image collage right", sections: "services grid first, then stats row, then process steps" },
      { id: "minimal-swiss", label: "Minimal Swiss", vibe: "white space, small uppercase labels, grid lines, one accent used sparingly", hero: "centered compact hero with thin divider and dual buttons", sections: "process steps first, then image plus text split, then services grid" },
      { id: "warm-artisan", label: "Warm artisan", vibe: "cream plus terracotta plus deep green, rounded cards, friendly voice", hero: "rounded image card hero with warm gradient wash", sections: "testimonial band first, then services grid, then image plus text split" },
      { id: "glass-modern", label: "Glass modern", vibe: "gradient mesh background, frosted-glass cards, soft glows", hero: "gradient mesh hero with glass CTA card overlay", sections: "stats row first, then services grid, then FAQ accordion" },
      { id: "split-story", label: "Split story", vibe: "alternating left right storytelling rows, photo-forward rhythm", hero: "asymmetric split hero with overlapping image", sections: "alternating image plus text rows first, then process steps, then stats row" },
      { id: "compact-local", label: "Compact local", vibe: "mobile-first, sticky call bar, click-to-call prominent, trust badges", hero: "compact hero with phone CTA primary and trust chips", sections: "trust strip first, then services grid, then FAQ accordion" },
    ],
    // Rotating professional design archetypes — one is picked per build so no two
    // sites share the same look unless the user repeats the same choices.
    DESIGN_ARCHETYPES: [
      { id: "luxe-dark", label: "Luxe dark", vibe: "deep charcoal + gold accents, big serif headlines, generous whitespace, premium feel", hero: "full-bleed image with dark overlay and centered serif headline", sections: "stats row first, then image+text split, then process steps" },
      { id: "editorial", label: "Editorial", vibe: "off-white paper background, strong typographic hierarchy, thin rules, magazine rhythm", hero: "left-aligned oversized headline with small kickers and an inline image", sections: "image+text split first, then services grid, then testimonial band" },
      { id: "bold-agency", label: "Bold agency", vibe: "high-contrast blocks of brand color, chunky headings, playful shapes and badges", hero: "split-screen hero with headline left and image collage right", sections: "services grid first, then stats row, then process steps" },
      { id: "minimal-swiss", label: "Minimal Swiss", vibe: "white space, small uppercase labels, grid lines, one accent color used sparingly", hero: "centered compact hero with thin divider and dual buttons", sections: "process steps first, then image+text split, then services grid" },
      { id: "warm-artisan", label: "Warm artisan", vibe: "cream + terracotta + deep green, rounded cards, friendly human voice", hero: "rounded image card hero with warm gradient wash", sections: "testimonial band first, then services grid, then image+text split" },
      { id: "glass-modern", label: "Glass modern", vibe: "gradient mesh background, frosted-glass cards, soft glows, tech-forward", hero: "gradient mesh hero with glass CTA card overlay", sections: "stats row first, then services grid, then FAQ accordion" },
      { id: "split-story", label: "Split story", vibe: "alternating left/right storytelling rows, sticky-feel rhythm, photo-forward", hero: "asymmetric split hero with overlapping image", sections: "alternating image+text rows first, then process steps, then stats row" },
      { id: "compact-local", label: "Compact local", vibe: "mobile-first, sticky call bar, click-to-call prominent, trust badges near CTAs", hero: "compact hero with phone CTA primary and review-style trust chips", sections: "trust strip first, then services grid, then FAQ accordion" },
    ],
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
  if (error instanceof AppError) return error;
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
    return [...new Set(models)].slice(0, 7);
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
      model = process.env.POLLINATIONS_TEXT_MODEL || POLLINATIONS.MODELS.TEXT_DEFAULT,
      fallbackModels = POLLINATIONS.MODELS.TEXT_FALLBACKS,
      timeoutMs = 60000,
      safe = undefined,
    } = options;
    const cleanMessages = Array.isArray(messages) ? messages : [{ role: "user", content: String(messages ?? "") }];
    const queue = this.resolveTextModels(model, fallbackModels);
    const safety = safe === undefined || safe === null || safe === false || safe === 0 ? {} : { safe: Array.isArray(safe) ? safe.join(",") : String(safe) };
    let lastError = null;
    const deniedModels = [];
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
        // Pollinations returns HTTP 200 with a block notice embedded in the message
        // content when the model allow-list of the key does not include the requested model.
        if (/isn.t allowed to use|is not allowed to use|allow it for this key/i.test(String(content))) {
          const grantMatch = String(content).match(/https:\/\/enter\.pollinations\.ai\/grant\?[^\s)\]">]+/);
          deniedModels.push({ model: attempt, grant: grantMatch ? grantMatch[0] : "https://enter.pollinations.ai/keys" });
          lastError = new AppError("Pollinations key cannot use " + attempt + "; its model allow-list does not include it.", 503, "POLLINATIONS_MODEL_DENIED");
          continue;
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
    if (deniedModels.length && deniedModels.length === queue.length) {
      throw new AppError("Pollinations key is not allowed to use any of: " + queue.join(", ") + " (its model allow-list covers none of them). Owner fix: open " + deniedModels[0].grant + " and allow the text category for this key - or set a full-access secret (sk_) key as POLLINATIONS_API_KEY. You can also pin one allowed model via POLLINATIONS_TEXT_MODEL / POLLINATIONS_WEBSITE_MODEL, then retry.", 503, "POLLINATIONS_MODEL_DENIED");
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

  pickDesignSystem(style, palette) {
    const s = String(style || "modern").toLowerCase();
    const systems = {
      modern: "MODERN PREMIUM: airy white canvas, huge confident headline left + hero image right in a rounded card, accent underline on one word, pill CTAs, 3 feature cards with soft shadows, stats row (numbers), generous whitespace.",
      luxury: "LUXURY DARK: near-black canvas (#0c0a09), gold serif headlines, thin dividers, hero image full-bleed with dark gradient overlay, letter-spaced eyebrow, minimal text, high contrast, elegant restraint.",
      medical: "CLEAN MEDICAL: clinical white + soft blue panels, trust badges row first, card grid with icons, opening-hours table, emergency call banner, calm blues, rounded friendly cards.",
      restaurant: "WARM RESTAURANT: cream/terracotta canvas, big appetizing hero image, menu-style price list section, opening hours card, reservation CTA, warm serif accents, cozy copy.",
      bold: "BOLD AGENCY: oversized display type, duotone color blocks, diagonal or offset section rhythm, marquee-style strip, giant numbers, confident punchy one-liners.",
      minimal: "MINIMAL ELEGANT: monochrome + one accent, single-column rhythm, huge whitespace, small caps labels, one hero image, quiet typography-led design."
    };
    return systems[s] || systems.modern;
  }

  fallbackPageFragment(spec, lead, hero, gallery, isHome) {
    const name = String(lead?.name || "Your Business");
    const type = String(lead?.businessType || lead?.category || "Local Business");
    const address = String(lead?.address || "");
    const phone = String(lead?.phone || "");
    const email = String(lead?.email || "");
    const card = (h, p) => "<div style=\"background:#fff;border:1px solid #e6ebf2;border-radius:16px;padding:22px;box-shadow:0 6px 20px rgba(15,23,42,.06)\"><h3 style=\"margin:.1em 0 .3em\">" + h + "</h3><p style=\"margin:0;color:#475569\">" + p + "</p></div>";
    if (isHome) {
      return "<div class=\"hero-band\"><span class=\"kick\">" + type + "</span><h1>" + name + " — quality service you can trust</h1><p class=\"lead\">" + address + " Call today for a free quote.</p><div class=\"cta-row\"><a class=\"btn btn-p\" href=\"tel:" + phone + "\">Call now</a><a class=\"btn btn-g\" href=\"#quote\">Get a free quote</a></div></div><img src=\"" + hero + "\" alt=\"" + name + "\" loading=\"lazy\" style=\"width:100%;max-height:420px;object-fit:cover;display:block;border-radius:16px\"><div class=\"trust\"><span><b>Local</b> & trusted</span><span><b>Fast</b> response</span><span><b>Fair</b> pricing</span></div><h1>" + name + " — " + type + "</h1><p>" + address + "</p><p>Phone: " + phone + "</p><p>Email: " + email + "</p><button>Get a Free Quote</button>" + card("Services", "What we do");
    }
    return "<h1>" + spec.title + "</h1><p>" + spec.focus + "</p>";
  }

  assembleMultiPage(pages, business, accent) {
    const e = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const navLinks = pages.map((p, i) => "<a href=\"#\" class=\"nav-a" + (i === 0 ? " active" : "") + "\" onclick=\"return showPage(" + i + ")\">" + e(p.title) + "</a>").join("");
    const sections = pages.map((p, i) => "<section class=\"pg\" id=\"pg-" + i + "\"" + (i === 0 ? "" : " style=\"display:none\"") + ">" + p.body + "</section>").join("");
    // Neutral frame only: nav + page switcher + footer. The AI's own classes
    // carry the design, so each style (modern/luxury/medical/restaurant/bold)
    // renders its own distinct look instead of one forced navy theme.
    return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + e(business) + "</title><meta name=\"description\" content=\"" + e(business) + " — a professional website built to turn visitors into customers.\"><style>*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,Arial,sans-serif;color:#0f172a;background:#f8fafc;line-height:1.55}img{max-width:100%;height:auto}.nav{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.94);display:flex;gap:6px;align-items:center;padding:10px 16px;flex-wrap:wrap;box-shadow:0 1px 8px rgba(15,23,42,.08);backdrop-filter:blur(8px)}.nav-a{color:#334155;text-decoration:none;font-weight:600;padding:8px 13px;border-radius:9px;font-size:.9rem}.nav-a.active,.nav-a:hover{background:#0f172a;color:#fff}.nav .brand{font-weight:800;margin-right:auto;font-size:1.02rem}.pg{max-width:1120px;margin:0 auto;padding:26px 20px 40px}.site-foot{background:#0f172a;color:#cbd5e1;text-align:center;padding:24px;font-size:.88rem}form.site-form{display:grid;gap:10px;max-width:520px}input,textarea,select{padding:12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit;width:100%}button{cursor:pointer}</style></head><body><nav class=\"nav\"><span class=\"brand\">" + e(business) + "</span>" + navLinks + "</nav>" + sections + "<footer>© " + new Date().getFullYear() + " " + e(business) + ". All rights reserved.<br><span style=\"opacity:.75;font-size:.82rem\">Website crafted with MAT LEADS AI Website Studio — created by Ebube John Okoye.</span></footer><script>function showPage(i){document.querySelectorAll('.pg').forEach(function(s,idx){s.style.display=idx===i?'block':'none'});document.querySelectorAll('.nav-a').forEach(function(a,idx){a.classList.toggle('active',idx===i)});window.scrollTo(0,0);return false;}</script></body></html>";
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
      { id: "home", title: "Home", focus: "hero band with headline + dual CTA, trust-signal strip, 3-4 card highlights grid, gallery image row, sample testimonial band, FAQ accordion, closing CTA band" },
      { id: "about", title: "About", focus: "brand story, why-choose-us cards, values list, process steps (contact > quote > work > support), commitment note" },
      { id: "services", title: "Services", focus: "4-6 service cards with benefit copy, simple packages/pricing row, FAQ, closing CTA band" },
      { id: "contact", title: "Contact", focus: "click-to-call + message CTA buttons, contact form (name, email, message), address, hours, map placeholder, FAQ" }
    ];
    const pageSpecs = allSpecs.slice(0, pageCount);
    const business = String(lead.name || options.businessName || "Your Business");
    const designDirection = this.pickDesignSystem(options.style, options.palette) + " Design archetype this build: " + archPick + ". Commit fully to that archetype's vibe — a returning customer must see a visibly different design, not the same template with new words.";
    const varietySeed = Math.floor(Math.random() * 9000) + 1000;
    const layoutVariants = ["split hero (text left, image right)", "full-bleed image hero with overlay headline", "centered type hero with image band below"];
    const layoutPick = layoutVariants[varietySeed % layoutVariants.length];
    const brief = JSON.stringify({ business, type: lead.businessType || lead.category, address: lead.address, phone: lead.phone, email: lead.email, style: options.style || "modern", colors: options.palette || "emerald", images: { hero, gallery } }).slice(0, 1500);
    const request = (maxTokens, note) => {
      const system = "You are an award-winning web design studio like Claude's best outputs. Output ONLY the inner content for a " + pageCount + "-page business website. DESIGN SYSTEM (follow exactly): " + designDirection + " HERO LAYOUT THIS TIME: " + layoutPick + " (variation #" + varietySeed + " - make this build feel different from any previous one). RULES: (1) Separate each page with the exact marker <!--PAGE--> on its own line, and emit exactly " + pageCount + " page(s) in this order: " + pageSpecs.map((p) => p.title).join(", ") + ". (2) Do NOT output <!doctype>, <html>, <head>, <body> or <nav> — only the page content. (3) You MAY put ONE compact single-line <style> block at the very top with your OWN classes - do not reuse generic .hero-band/.card styling, invent fresh class names and a fresh palette from the brief colors. (4) Use the exact image URLs from the brief in real <img> tags with loading=lazy and descriptive alt text; never leave src empty. (5) Every page opens with a HERO: eyebrow kicker, one bold benefit-led headline worded DIFFERENTLY from typical templates, one supporting sentence, TWO buttons. Then vary the middle: pick a DIFFERENT order and DIFFERENT emphasis each build (stats row, process steps, image+text split, pricing teasers, testimonial band on Home ONLY labelled sample with no fake names, FAQ accordion with <details>/<summary>), and a closing CTA band that does not copy previous closings. (6) Copy must feel customer-taste: warm, confident, benefit-led, short sentences, and NEVER repeat the same headline twice. NEVER invent awards, reviews, licenses, addresses or numbers not in the brief - use neutral placeholders or omit. (7) Be CONCISE: ENTIRE output under ~1800 tokens. (8) No markdown, no explanations, no code fences.";
      const user = "Build the " + pageCount + " page section(s) for: " + brief + ". Page focuses: " + pageSpecs.map((p) => p.title + " = " + p.focus).join("; ") + ". Hero uses images.hero; put images.gallery URLs in an <img> row on the Home page. Variation #" + varietySeed + " with " + layoutPick + ". Separate every page with <!--PAGE-->. " + (note || "");
      return this.text([{ role: "system", content: system }, { role: "user", content: user }], { temperature: 0.7, maxTokens, timeoutMs: Math.max(30000, 50000), model: process.env.POLLINATIONS_WEBSITE_MODEL || POLLINATIONS.MODELS.WEBSITE_DEFAULT, fallbackModels: POLLINATIONS.MODELS.WEBSITE_FALLBACKS });
    };
    let result = await request(1800);
    let content = String(result.content || "");
    if (content.replace(/<!--PAGE-->/gi, "").trim().length < 400) {
      try {
        const retry = await request(2400, "Remember: fresh headline wording, " + layoutPick + " hero, your own class names, varied section order. Separate each page with <!--PAGE--> and end cleanly.");
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
