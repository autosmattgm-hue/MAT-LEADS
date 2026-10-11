import { apiFetch, byId, getCurrentUser, isProUser, requireAuth } from "./api.js";

let websiteId = "";
let shareToken = "";
let shareUrl = "";
let currentHtml = "";
// Uploaded images are stored client-side as data URLs and injected into the
// final HTML after generation (too large to send through the AI prompt).
const uploaded = { hero: "", gallery: [] };

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.readAsDataURL(file);
  });
}

// Guarantee the user's uploaded photos appear on the built site even if the AI
// used placeholder images: swap the hero and gallery <img> srcs to the uploads.
function injectUploadedImages(html) {
  let out = String(html || "");
  const esc = (u) => u.replace(/"/g, "&quot;");
  if (uploaded.hero) {
    const imgs = [...out.matchAll(/<img\b[^>]*?\ssrc=(["'])(.*?)\1[^>]*>/gi)];
    if (imgs.length) {
      const first = imgs[0];
      const swapped = first[0].replace(/src=(["'])(.*?)\1/i, `src="${esc(uploaded.hero)}"`);
      out = out.replace(first[0], swapped);
    } else if (/<body[^>]*>/i.test(out)) {
      out = out.replace(/(<body[^>]*>)/i, `$1<img src="${esc(uploaded.hero)}" alt="Hero image" style="width:100%;max-height:420px;object-fit:cover;display:block">`);
    }
  }
  if (uploaded.gallery.length) {
    const imgs = [...out.matchAll(/<img\b[^>]*?\ssrc=(["'])(.*?)\1[^>]*>/gi)];
    // Replace the 2nd..Nth images (after the hero) with the gallery uploads.
    imgs.slice(1).forEach((match, i) => {
      if (i < uploaded.gallery.length) {
        out = out.replace(match[0], match[0].replace(/src=(["'])(.*?)\1/i, `src="${esc(uploaded.gallery[i])}"`));
      }
    });
  }
  return out;
}

function abs(url) {
  try { return new URL(url, window.location.origin).href; } catch { return url; }
}

function setPreview(html) {
  currentHtml = html || "";
  const frame = byId("studioPreview");
  if (!frame) return;
  frame.srcdoc = currentHtml;
  frame.onload = () => {
    try {
      const text = frame.contentDocument?.body?.innerText?.trim() || "";
      if (currentHtml && !text) {
        byId("studioStatus").textContent = "Inline preview was blocked by the browser — click Open Preview to view the full site in a new tab.";
      }
    } catch {
      // Cross-document access blocked; the site itself is still fine.
    }
  };
}

function replaceOnce(html, pattern, replacement) {
  return html.replace(pattern, replacement);
}

function applyManualEdits() {
  if (!currentHtml) { byId("editMsg").textContent = "Generate a website first."; return; }
  let html = currentHtml;
  const biz = byId("editBiz").value.trim();
  const head = byId("editHead").value.trim();
  const phone = byId("editPhone").value.trim();
  const email = byId("editEmail").value.trim();
  const cta = byId("editCta").value.trim();
  const accent = byId("editAccent").value;

  if (biz) {
    html = replaceOnce(html, /<title[^>]*>[\s\S]*?<\/title>/i, `<title>${biz}</title>`);
    if (!head) html = replaceOnce(html, /(<h1[^>]*>)([\s\S]*?)(<\/h1>)/i, `$1${biz}$3`);
  }
  if (head) html = replaceOnce(html, /(<h1[^>]*>)([\s\S]*?)(<\/h1>)/i, `$1${head}$3`);
  if (phone) {
    html = html.replace(/tel:[^"'\s)]*/gi, `tel:${phone.replace(/[^\d+]/g, "")}`);
    html = replaceOnce(html, /(\+?\d[\d\s().-]{6,}\d)/, phone);
  }
  if (email) {
    html = html.replace(/mailto:[^"'\s?)]*/gi, `mailto:${email}`);
    html = replaceOnce(html, /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i, email);
  }
  if (cta) html = replaceOnce(html, /(<a[^>]*class="[^"]*btn[^"]*"[^>]*>)([\s\S]*?)(<\/a>)/i, `$1${cta}$3`);
  const accentCss = `<style id="manualAccent">a.btn,.btn,button[type="submit"],a.btn-p{background:${accent}!important}</style>`;
  html = html.includes("</head>") ? html.replace("</head>", `${accentCss}</head>`) : accentCss + html;

  currentHtml = html;
  setPreview(currentHtml);
  byId("editMsg").textContent = "Changes applied to the preview. Click Save to Server so the share link matches, then Download if you want the file.";
}

function addManualImage() {
  if (!currentHtml) { byId("editMsg").textContent = "Generate a website first, then add images."; return; }
  const url = byId("editImageUrl").value.trim();
  if (!/^https?:\/\//i.test(url)) { byId("editMsg").textContent = "Paste a valid image URL (starting with https://)."; return; }
  const safeUrl = url.replace(/["'<>]/g, "");
  const imgTag = `<figure style="margin:20px 0;text-align:center"><img src="${safeUrl}" alt="Website image" style="max-width:100%;height:auto;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.12)"></figure>`;
  let html = currentHtml;
  if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${imgTag}</body>`);
  else if (/<\/main>/i.test(html)) html = html.replace(/<\/main>/i, `${imgTag}</main>`);
  else html = imgTag + html;
  currentHtml = html;
  setPreview(currentHtml);
  byId("editImageUrl").value = "";
  byId("editMsg").textContent = "Image added to the preview. Click Save to Server so your share link shows it, then Download if you want the file.";
}

function toggleEditOnPage() {
  const frame = byId("studioPreview");
  if (!frame?.contentDocument) { byId("editMsg").textContent = "Preview not ready — click Open Preview to edit in a tab instead."; return; }
  try {
    const body = frame.contentDocument.body;
    const on = body.getAttribute("contenteditable") === "true";
    body.setAttribute("contenteditable", on ? "false" : "true");
    body.style.outline = on ? "" : "3px dashed #22c55e";
    byId("editMsg").textContent = on
      ? "Edit mode off. Click Save to Server to keep your typing."
      : "Edit mode ON — click any text on the preview and type. Then click Save to Server.";
    if (!on) {
      body.addEventListener("blur", () => {
        try { currentHtml = "<!doctype html>" + frame.contentDocument.documentElement.outerHTML; } catch {}
      }, true);
    }
  } catch {
    byId("editMsg").textContent = "Could not enable click-to-edit — use Open Preview + Apply Changes instead.";
  }
}

async function saveManualHtml() {
  if (!websiteId) { byId("editMsg").textContent = "Generate the website first, then edit."; return; }
  const frame = byId("studioPreview");
  try {
    if (frame?.contentDocument?.documentElement) {
      currentHtml = "<!doctype html>" + frame.contentDocument.documentElement.outerHTML;
      setPreview(currentHtml);
    }
  } catch {}
  byId("editMsg").textContent = "Saving your manual edits...";
  try {
    const r = await apiFetch(`/api/ai/websites/${encodeURIComponent(websiteId)}/html`, { method: "POST", body: JSON.stringify({ html: currentHtml }) });
    byId("studioMeta").textContent = `${r.website.businessName || r.website.leadName} • saved manual edit • rev ${r.website.revisions || ""}`;
    byId("editMsg").textContent = "Saved. Share link and Live Link now show your manual edits.";
    updateShare();
  } catch (err) { byId("editMsg").textContent = err.message; }
}

function openPreviewWindow() {
  if (!currentHtml) return;
  const w = window.open("", "_blank");
  if (!w) {
    byId("studioStatus").textContent = "Pop-up blocked — allow pop-ups for this site, then click Open Preview again.";
    return;
  }
  w.document.open();
  w.document.write(currentHtml);
  w.document.close();
}

async function loadFromQuery() {
  const q = new URLSearchParams(window.location.search);
  websiteId = q.get("id") || "";
  const leadId = q.get("leadId") || "";
  const business = q.get("business") || "";
  if (leadId && byId("studioLeadId")) byId("studioLeadId").value = leadId;
  if (business && byId("studioBusiness")) byId("studioBusiness").value = business;
  const leadRaw = q.get("lead");
  if (leadRaw && byId("studioBusiness")) {
    try {
      const lead = JSON.parse(decodeURIComponent(escape(atob(leadRaw))));
      if (lead?.name) byId("studioBusiness").value = lead.name;
      sessionStorage.setItem("mat_studio_lead", JSON.stringify(lead));
    } catch {}
  }
  if (websiteId) {
    byId("studioStatus").textContent = "Loading website...";
    try {
      const r = await apiFetch(`/api/ai/websites/${encodeURIComponent(websiteId)}`);
      websiteId = r.website.id; shareToken = r.website.shareToken; shareUrl = r.shareUrl;
      setPreview(r.website.html);
      byId("studioMeta").textContent = `${r.website.businessName || r.website.leadName} • rev ${r.website.revisions} • ${r.website.model}`;
      byId("studioStatus").textContent = "Loaded. Tell AI what to change.";
      updateShare();
    } catch (e) { byId("studioStatus").textContent = e.message; }
  }
}

function updateShare() {
  const full = abs(shareUrl || (shareToken ? `/s/${shareToken}` : "#"));
  const open = byId("studioOpenLive");
  if (open && shareToken) open.href = full;
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireAuth()) return;
  const user = getCurrentUser();
  if (!isProUser(user)) {
    byId("studioStatus").textContent = "Website Studio needs Pro or higher. Redirecting to Pricing...";
    setTimeout(() => { window.location.href = "/pricing.html?upgrade=pro"; }, 1200);
    return;
  }
  loadFromQuery();

  // Image uploads: read files as data URLs, keep them client-side, and inject
  // them into the built site after generation (see injectUploadedImages).
  byId("studioHeroFile")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      uploaded.hero = await readFileAsDataUrl(file);
      byId("studioHeroImg").value = "";
      byId("studioUploadMsg").textContent = `Hero image ready: ${file.name}. It will be placed on your site when you Generate.`;
    } catch (err) { byId("studioUploadMsg").textContent = err.message; }
    e.target.value = "";
  });
  byId("studioGalleryFiles")?.addEventListener("change", async (e) => {
    const files = [...(e.target.files || [])].slice(0, 6);
    if (!files.length) return;
    try {
      uploaded.gallery = [];
      for (const file of files) uploaded.gallery.push(await readFileAsDataUrl(file));
      byId("studioUploadMsg").textContent = `${uploaded.gallery.length} gallery image(s) ready. They will appear on your site when you Generate.`;
    } catch (err) { byId("studioUploadMsg").textContent = err.message; }
    e.target.value = "";
  });

  byId("studioBuildForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = byId("studioBuildBtn");
    btn.disabled = true; btn.textContent = "Building professional site...";
    byId("studioStatus").innerHTML = `<div class="loading-row"><div class="spinner" role="status" aria-label="Loading"></div><span class="muted-value">AI is designing your premium website (fast mode: max ~20s; if it's busy you instantly get a premium template you can retry)...</span></div>`;
    try {
      let lead = null;
      try { lead = JSON.parse(sessionStorage.getItem("mat_studio_lead") || "null"); } catch {}
      const leadId = byId("studioLeadId").value.trim();
      if (!lead && leadId) { try { const r = await apiFetch(`/api/leads/${encodeURIComponent(leadId)}/report`); lead = r.lead; } catch {} }
      const payload = { leadId, lead: lead || {}, businessName: byId("studioBusiness").value.trim() || lead?.name || "Business", style: byId("studioStyle").value, palette: byId("studioPalette").value, pages: parseInt(byId("studioPages")?.value, 10) || 1, images: { hero: byId("studioHeroImg")?.value.trim() || "", gallery: (byId("studioGallery")?.value || "").split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 6) } };
      const r = await apiFetch("/api/ai/websites", { method: "POST", body: JSON.stringify(payload) });
      websiteId = r.websiteId; shareToken = r.shareToken; shareUrl = r.shareUrl;
      const withUploads = (uploaded.hero || uploaded.gallery.length) ? injectUploadedImages(r.website.html) : r.website.html;
      setPreview(withUploads);
      const pageLabel = r.website.pageCount && r.website.pageCount > 1 ? ` • ${r.website.pageCount} pages` : "";
      byId("studioMeta").textContent = `${r.website.businessName} • built with ${r.website.model}${pageLabel}${r.website.aiError ? ` • Note: ${r.website.aiError}` : ""}`;
      byId("studioStatus").textContent = r.website.provider === "nvidia" ? `Done. Real AI ${r.website.pageCount || 1}-page site built. Use the site's top menu to switch pages; chat to refine, download, or share.` : `Done with premium template. ${r.website.aiError || "AI unavailable."}`;
      updateShare();
      history.replaceState(null, "", `/website-studio.html?id=${encodeURIComponent(websiteId)}`);
    } catch (err) {
      const msg = String(err?.message || "Request failed");
      byId("studioStatus").innerHTML = `${msg} ${/pro plan|402|PRO_REQUIRED/i.test(msg) ? `<a href="/pricing.html?upgrade=pro"><strong>Upgrade to Pro</strong></a>` : ""}`;
    }
    finally { btn.disabled = false; btn.textContent = "Generate Website"; }
  });

  byId("studioRefineForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!websiteId) { byId("studioStatus").textContent = "Generate a website first."; return; }
    const instruction = byId("studioInstruction").value.trim();
    if (!instruction) return;
    byId("studioStatus").innerHTML = `<div class="loading-row"><div class="spinner" role="status" aria-label="Loading"></div><span class="muted-value">Applying your change...</span></div>`;
    try {
      const r = await apiFetch(`/api/ai/websites/${encodeURIComponent(websiteId)}`, { method: "PATCH", body: JSON.stringify({ instruction }) });
      setPreview(r.website.html);
      byId("studioMeta").textContent = `Updated • rev ${r.website.revisions}`;
      byId("studioStatus").textContent = "Change applied.";
      byId("studioInstruction").value = "";
    } catch (err) {
      const msg = String(err?.message || "Request failed");
      byId("studioStatus").innerHTML = `${msg} ${/pro plan|402|PRO_REQUIRED/i.test(msg) ? `<a href="/pricing.html?upgrade=pro"><strong>Upgrade to Pro</strong></a>` : ""}`;
    }
  });

  byId("studioOpenPreview").addEventListener("click", openPreviewWindow);
  byId("editApply").addEventListener("click", applyManualEdits);
  byId("editAddImage").addEventListener("click", addManualImage);
  byId("editMode").addEventListener("click", toggleEditOnPage);
  byId("editSave").addEventListener("click", saveManualHtml);
  byId("studioDownload").addEventListener("click", () => {
    if (!currentHtml) return;
    const blob = new Blob([currentHtml], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `website-${websiteId.slice(0, 8)}.html`;
    document.body.append(a); a.click(); a.remove();
  });
  byId("studioCopyLink").addEventListener("click", async () => {
    if (!shareToken) return;
    await navigator.clipboard.writeText(abs(shareUrl));
    byId("studioStatus").textContent = "Share link copied.";
  });
});
