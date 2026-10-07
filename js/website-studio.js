import { apiFetch, byId, getCurrentUser, isProUser, requireAuth } from "./api.js";

let websiteId = "";
let shareToken = "";
let shareUrl = "";
let currentHtml = "";

function abs(url) {
  try { return new URL(url, window.location.origin).href; } catch { return url; }
}

function setPreview(html) {
  currentHtml = html || "";
  const frame = byId("studioPreview");
  if (frame) frame.srcdoc = currentHtml;
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

  byId("studioBuildForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = byId("studioBuildBtn");
    btn.disabled = true; btn.textContent = "Building professional site...";
    byId("studioStatus").textContent = "AI is designing your premium website (usually 15-45s, cached rebuilds are instant)...";
    try {
      let lead = null;
      try { lead = JSON.parse(sessionStorage.getItem("mat_studio_lead") || "null"); } catch {}
      const leadId = byId("studioLeadId").value.trim();
      if (!lead && leadId) { try { const r = await apiFetch(`/api/leads/${encodeURIComponent(leadId)}/report`); lead = r.lead; } catch {} }
      const payload = { leadId, lead: lead || {}, businessName: byId("studioBusiness").value.trim() || lead?.name || "Business", style: byId("studioStyle").value, palette: byId("studioPalette").value };
      const r = await apiFetch("/api/ai/websites", { method: "POST", body: JSON.stringify(payload) });
      websiteId = r.websiteId; shareToken = r.shareToken; shareUrl = r.shareUrl;
      setPreview(r.website.html);
      byId("studioMeta").textContent = `${r.website.businessName} • built with ${r.website.model}${r.website.aiError ? ` • Note: ${r.website.aiError}` : ""}`;
      byId("studioStatus").textContent = r.website.provider === "nvidia" ? "Done. Real AI site built. Chat refinements, download, or share." : `Done with premium template (${r.website.aiError || "AI unavailable"}). Check Vercel NVIDIA_API_KEY, then rebuild.`;
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
    byId("studioStatus").textContent = "Applying your change...";
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
