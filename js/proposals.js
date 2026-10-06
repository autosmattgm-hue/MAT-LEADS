import { apiFetch, byId, requireAuth } from "./api.js";
document.addEventListener("DOMContentLoaded", async () => {
  if (!requireAuth()) return;
  try {
    const r = await apiFetch("/api/earn/offers");
    byId("propOffer").innerHTML = r.offers.map((o) => `<option value="${o.key}">${o.name} — $${o.priceUsd}</option>`).join("");
    byId("propAmount").value = r.offers[2]?.priceUsd || 1499;
  } catch {}
  const q = new URLSearchParams(window.location.search);
  if (q.get("leadId")) byId("propLead").value = q.get("leadId");
  byId("propForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const leadId = byId("propLead").value.trim();
    if (!leadId) { byId("propOut").textContent = "Paste a lead id."; return; }
    byId("propOut").textContent = "Writing proposal...";
    try {
      const [prop, inv] = await Promise.all([
        apiFetch("/api/ai/proposal", { method: "POST", body: JSON.stringify({ leadId, offerKey: byId("propOffer").value }) }),
        apiFetch("/api/earn/invoices", { method: "POST", body: JSON.stringify({ leadId, offerKey: byId("propOffer").value, amountUsd: Number(byId("propAmount").value), clientName: byId("propClient").value, clientEmail: byId("propEmail").value }) })
      ]);
      byId("propOut").textContent = `${prop.content}\n\nPay here: ${new URL(inv.invoice.payLink, window.location.origin).href}`;
    } catch (err) { byId("propOut").textContent = err.message; }
  });
  byId("propCopy").addEventListener("click", async () => { await navigator.clipboard.writeText(byId("propOut").textContent); });
  byId("propWa").addEventListener("click", () => { window.open(`https://wa.me/?text=${encodeURIComponent(byId("propOut").textContent.slice(0, 1500))}`, "_blank"); });
});
