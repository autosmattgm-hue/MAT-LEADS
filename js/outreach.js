import { apiFetch, byId, requireAuth } from "./api.js";
let lastText = "";
let lastLead = "";
document.addEventListener("DOMContentLoaded", async () => {
  if (!requireAuth()) return;
  try {
    const r = await apiFetch("/api/earn/offers");
    byId("outOffer").innerHTML = `<option value="">No paid offer</option>` + r.offers.map((o) => `<option value="${o.key}">${o.name} — $${o.priceUsd}</option>`).join("");
  } catch {}
  const q = new URLSearchParams(window.location.search);
  if (q.get("leadId")) byId("outLead").value = q.get("leadId");
  byId("outForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const leadId = byId("outLead").value.trim();
    if (!leadId) { byId("outResult").textContent = "Paste a lead id first."; return; }
    byId("outResult").textContent = "Writing money script...";
    try {
      const r = await apiFetch("/api/ai/outreach", { method: "POST", body: JSON.stringify({ leadId, type: byId("outType").value }) });
      lastText = r.content || "";
      lastLead = leadId;
      const offer = byId("outOffer").value;
      byId("outResult").textContent = lastText + (offer ? `\n\nP.S. I can do this as a paid ${offer} — reply YES and I will send the invoice.` : "");
    } catch (err) { byId("outResult").textContent = err.message; }
  });
  byId("outCopy").addEventListener("click", async () => { if (lastText) await navigator.clipboard.writeText(byId("outResult").textContent); });
  byId("outWa").addEventListener("click", () => { if (lastText) window.open(`https://wa.me/?text=${encodeURIComponent(byId("outResult").textContent.slice(0, 1500))}`, "_blank"); });
  byId("outInvoice").addEventListener("click", async () => {
    if (!lastLead) return;
    const amount = Number(prompt("Invoice amount USD:", "149") || 0);
    if (!amount) return;
    const r = await apiFetch("/api/earn/invoices", { method: "POST", body: JSON.stringify({ leadId: lastLead, offerKey: byId("outOffer").value || "paid_audit", amountUsd: amount, notes: lastText.slice(0, 500) }) });
    byId("outResult").textContent += `\n\nInvoice + pay link: ${r.invoice.payLink}`;
  });
});
