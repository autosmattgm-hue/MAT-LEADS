import { apiFetch, byId, isProUser, requireAuth } from "./api.js";

let lastAnswer = "";

document.addEventListener("DOMContentLoaded", async () => {
  if (!requireAuth()) return;
  const gate = byId("tycoonGate");
  try {
    const me = await apiFetch("/api/auth/me");
    const user = me.user;
    try { localStorage.setItem("mat_user", JSON.stringify(user)); } catch {}
    if (!isProUser(user)) {
      gate.innerHTML = `Business AI Tycoon is Pro/Admin only. <a href="/pricing.html?upgrade=pro"><strong>Upgrade to Pro</strong></a> to unlock scripts, pricing and WhatsApp closing.`;
      return;
    }
    gate.textContent = `Tycoon unlocked for ${user.planName || user.subscription || "Pro"}. Ask anything.`;
  } catch (e) { gate.textContent = e.message; }

  byId("tycoonForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const prompt = byId("tycoonPrompt").value.trim();
    if (!prompt) return;
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true; btn.textContent = "Tycoon thinking...";
    byId("tycoonOut").textContent = "Tycoon is crafting your winning script (usually 5-15s)...";
    try {
      const status = await apiFetch("/api/ai/status").catch(() => null);
      if (status && !status.configured) {
        byId("tycoonOut").textContent = "AI key missing. Add NVIDIA_API_KEY in Vercel env vars, then redeploy.";
        return;
      }
      const leadId = byId("tycoonLead").value.trim();
      let lead = null;
      if (leadId) { try { const r = await apiFetch(`/api/leads/${encodeURIComponent(leadId)}/report`); lead = r.lead; } catch {} }
      const r = await apiFetch("/api/ai/tycoon", { method: "POST", body: JSON.stringify({ prompt, leadId, lead: lead || {} }) });
      lastAnswer = r.content || "";
      byId("tycoonOut").textContent = lastAnswer + (r.fallback ? "\n\n(Note: live AI was busy, showing instant playbook.)" : "");
    } catch (err) {
      const msg = String(err?.message || "Request failed");
      byId("tycoonOut").innerHTML = `${msg} ${/pro plan|402|PRO_REQUIRED/i.test(msg) ? `<br><a href="/pricing.html?upgrade=pro"><strong>Upgrade to Pro to unlock Tycoon</strong></a>` : `<br><span class="muted-value">Try again — cached answers reply instantly.</span>`}`;
    }
    finally { btn.disabled = false; btn.textContent = "Ask Tycoon"; }
  });

  byId("tycoonCopy").addEventListener("click", async () => {
    if (!lastAnswer) return;
    await navigator.clipboard.writeText(lastAnswer);
    byId("tycoonOut").textContent = lastAnswer + "\n\n(Copied - paste into WhatsApp)";
  });
  byId("tycoonWhats").addEventListener("click", () => {
    if (!lastAnswer) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(lastAnswer.slice(0, 1500))}`, "_blank");
  });
});
