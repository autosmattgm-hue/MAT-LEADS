import crypto from "node:crypto";
import { env } from "../config/env.js";
import { FirestoreRepository } from "../repositories/firestoreRepository.js";
import { NvidiaService } from "./nvidiaService.js";
import { AppError } from "../utils/errors.js";

const memoryWebsites = new Map();
const memoryByToken = new Map();

export function fallbackWebsiteHtml(lead = {}, plan = {}) {
  const name = String(lead.name || plan.businessName || "Your Business");
  const category = String(lead.businessType || lead.category || "Local Business");
  const address = String(lead.address || "");
  const phone = String(lead.phone || "");
  const email = String(lead.email || "");
  const e = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const accent = "#22c55e";
  const seed = String(lead.businessType || lead.category || name || "business").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) || "business";
  const heroImg = String(plan.images?.hero || "").trim() || `https://picsum.photos/seed/${encodeURIComponent(seed)}/1600/900`;
  const galRaw = Array.isArray(plan.images?.gallery) ? plan.images.gallery.map((g) => String(g || "").trim()).filter(Boolean).slice(0, 3) : [];
  const gallery = galRaw.length ? galRaw : [1, 2, 3].map((n) => `https://picsum.photos/seed/${encodeURIComponent(seed + "-" + n)}/800/600`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(name)} | ${e(category)}</title><meta name="description" content="${e(name)} - ${e(category)}. Call, book and get a quote today."><style>*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,Arial,sans-serif;color:#0f172a;background:#f8fafc}header{background:#0b1220;color:#fff;padding:56px 24px;text-align:center}header h1{margin:0 0 8px;font-size:clamp(2rem,5vw,3.4rem)}.btn{display:inline-block;padding:13px 22px;border-radius:10px;font-weight:700;text-decoration:none}.btn-p{background:${accent};color:#06281a}.btn-g{border:1px solid rgba(255,255,255,.4);color:#fff;margin-left:10px}.wrap{max-width:1080px;margin:0 auto;padding:28px 20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px}footer{background:#0b1220;color:#cbd5e1;text-align:center;padding:22px}form{display:grid;gap:10px;max-width:520px}input,textarea{padding:12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit}</style></head><body><header><img src="${heroImg}" alt="${e(name)}" style="width:100%;max-height:420px;object-fit:cover;display:block"><div style="padding:0 24px"><p style="letter-spacing:2px;text-transform:uppercase;font-size:12px">${e(category)}</p><h1>${e(name)}</h1><p>Professional mobile-first website built to turn local searches into calls and bookings.${address ? ` Visit us at ${e(address)}.` : ""}</p><div>${phone ? `<a class="btn btn-p" href="tel:${e(phone)}">Call ${e(phone)}</a>` : `<a class="btn btn-p" href="#quote">Get a Free Quote</a>`}<a class="btn btn-g" href="#quote">Book Online</a></div></div></header><div class="wrap"><div class="grid"><div class="card"><h3>Why choose us</h3><p>Trusted local ${e(category.toLowerCase())} with fast response and transparent pricing.</p></div><div class="card"><h3>Services</h3><p>Consultation, premium service, bookings and priority support.</p></div><div class="card"><h3>Reviews</h3><p>Loved by local customers for quality and friendly support.</p></div></div><div class="card" id="quote" style="margin-top:20px"><h2>Get a free quote</h2><form onsubmit="alert('Thanks! We will contact you shortly.');return false"><input required placeholder="Your name"><input placeholder="Phone or email"><textarea rows="4" placeholder="What do you need?"></textarea><button class="btn btn-p" type="submit">Request Quote</button></form><p>${e(phone)} ${e(email)}</p></div></div><div class="wrap" style="padding-top:0"><h2 style="text-align:center">Our Work</h2><div class="grid">${gallery.map((g) => `<img src="${g}" alt="${e(name)} photo" style="width:100%;height:200px;object-fit:cover;border-radius:12px">`).join("")}</div></div><footer>${e(name)} - ${e(category)} - Built with MAT LEADS AI PRO X</footer></body></html>`;
}

export class WebsiteService {
  constructor() {
    this.websites = new FirestoreRepository("aiWebsites");
    this.nvidia = new NvidiaService();
  }
  websiteKey(user, leadId) {
    return `${user?.uid || "anon"}:${leadId || "lead"}`;
  }
  async build({ lead, options = {}, user }) {
    const { randomUUID } = await import("node:crypto");
    const id = randomUUID();
    const shareToken = randomUUID().replace(/-/g, "").slice(0, 24);
    const createdAt = new Date().toISOString();
    let html = "";
    let provider = "template";
    let model = "builtin-template-v1";
    let aiError = "";
    let pageCount = parseInt(options.pages, 10) || 1;
    try {
      const result = await this.nvidia.buildWebsite(lead, options);
      if (result.pageCount) pageCount = result.pageCount;
      if (result.html && /<\/html>/i.test(result.html) && result.html.length > 800) { html = result.html; provider = result.provider || "nvidia"; model = result.model; }
      else { html = fallbackWebsiteHtml(lead, options); aiError = "AI build was incomplete — used premium template. Click Generate again; the builder now retries until the full file ends with </html>."; }
    } catch (e) {
      html = fallbackWebsiteHtml(lead, options);
      // Give the REAL, actionable reason — never a misleading "check API key" for a timeout.
      const code = String(e?.code || "");
      const raw = String(e?.message || "AI request failed");
      let reason;
      if (code === "NVIDIA_TIMEOUT" || /timed out/i.test(raw)) {
        reason = "The AI model was slow to answer this time (a reasoning model occasionally needs a retry). This is NOT an API key problem — your key is valid. Click Generate again to retry.";
      } else if (code === "NVIDIA_MODEL_NOT_ACTIVE" || /authorization failed|403/i.test(raw)) {
        reason = "Your NVIDIA key is valid but that specific model isn't activated for it. The app already auto-rotates to a live model — just click Generate again.";
      } else {
        reason = `${raw.slice(0, 200)}. Click Generate again to retry; if it repeats, check NVIDIA_API_KEY and the configured models.`;
      }
      aiError = `${reason} Used premium template so you still have a working site.`;
    }
    const record = { id, shareToken, ownerId: user?.uid || "anon", leadId: lead?.id || "", leadName: lead?.name || options.businessName || "Business", businessType: lead?.businessType || lead?.category || "", address: lead?.address || "", phone: lead?.phone || "", email: lead?.email || "", businessName: options.businessName || lead?.name || "Business", style: options.style || "modern", html, provider, model, pageCount: pageCount, aiError, revisions: 1, history: [{ at: createdAt, instruction: "Initial AI website build" }], createdAt, updatedAt: createdAt };
    try { await this.websites.upsert(id, record); } catch {}
    memoryWebsites.set(id, record);
    memoryByToken.set(shareToken, id);
    return { website: record };
  }
  async refine({ id, instruction, user }) {
    let record = null;
    try { record = await this.websites.findById(id); } catch {}
    record = record || memoryWebsites.get(id);
    if (!record) { const err = new Error("Website not found. Generate it first."); err.status = 404; err.code = "WEBSITE_NOT_FOUND"; throw err; }
    const result = await this.nvidia.refineWebsite(record.html, instruction, record);
    if (!result.html || result.html.length <= 500) {
      throw new AppError("NVIDIA AI returned an incomplete website update. Your current site was not changed; please try again.", 503, "NVIDIA_EMPTY");
    }
    const html = result.html;
    const updated = { ...record, html, revisions: Number(record.revisions || 1) + 1, history: [...(record.history || []), { at: new Date().toISOString(), instruction }], updatedAt: new Date().toISOString() };
    try { await this.websites.upsert(id, updated); } catch {}
    memoryWebsites.set(id, updated);
    return { website: updated };
  }
  async getById(id) {
    try { const f = await this.websites.findById(id); if (f) return f; } catch {}
    return memoryWebsites.get(id) || null;
  }
  async saveHtml(id, html, user) {
    let record = await this.getById(id);
    if (!record) { const e = new Error("Website not found."); e.status = 404; e.code = "WEBSITE_NOT_FOUND"; throw e; }
    if (String(record.ownerId || "") !== String(user?.uid || "") && String(user?.role || "") !== "admin") {
      const e = new Error("You can only edit your own websites."); e.status = 403; e.code = "FORBIDDEN"; throw e;
    }
    const updated = { ...record, html, updatedAt: new Date().toISOString(), history: [...(record.history || []), { at: new Date().toISOString(), instruction: "Manual visual edit (no code)" }] };
    try { await this.websites.upsert(id, updated); } catch {}
    memoryWebsites.set(id, updated);
    return { website: updated, shareUrl: `/s/${updated.shareToken}` };
  }
  async getByToken(token) {
    const id = memoryByToken.get(token);
    if (id && memoryWebsites.get(id)) return memoryWebsites.get(id);
    try { const all = await this.websites.list({ limit: 200 }); const f = all.find((w) => w.shareToken === token); if (f) return f; } catch {}
    return null;
  }
}

