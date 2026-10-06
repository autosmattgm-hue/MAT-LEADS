import { apiFetch, byId, requireAuth } from "./api.js";

let referralLink = "";
function money(c) { return `$${(Number(c || 0) / 100).toFixed(2)}`; }
document.addEventListener("DOMContentLoaded", async () => {
  if (!requireAuth()) return;
  try {
    const [ref, offers, invoices, payouts] = await Promise.all([
      apiFetch("/api/earn/referral"),
      apiFetch("/api/earn/offers"),
      apiFetch("/api/earn/invoices"),
      apiFetch("/api/earn/payouts")
    ]);
    referralLink = new URL(ref.linkPath, window.location.origin).href;
    byId("refBox").innerHTML = `<strong>${ref.code}</strong><br>${referralLink}<br>Pending ${money(ref.pendingCents)} • Earned ${money(ref.paidCents)} • ${ref.rows.length} referral(s)`;
    byId("earnMetrics").innerHTML = [
      ["Referral pending", money(ref.pendingCents)],
      ["Referral earned", money(ref.paidCents)],
      ["Open invoices", String(invoices.invoices.filter((i) => i.status !== "paid").length)],
      ["Paid invoices", money(invoices.invoices.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.amountCents || 0), 0))]
    ].map(([k, v]) => `<article class="metric"><span>${k}</span><strong>${v}</strong></article>`).join("");
    byId("invOffer").innerHTML = offers.map((o) => `<option value="${o.key}">${o.name} — $${o.priceUsd}</option>`).join("");
    byId("invOffer").addEventListener("change", (e) => {
      const o = offers.find((x) => x.key === e.target.value);
      if (o) byId("invAmount").value = o.priceUsd;
    });
    if (offers[0]) byId("invAmount").value = offers[0].priceUsd;
    byId("invoiceList").innerHTML = invoices.invoices.map((i) => `<div class="audit-item"><span>${i.offerName} • ${i.clientName || i.leadName} • ${money(i.amountCents)} • ${i.status}</span><strong><a href="${i.payLink}">Pay link</a></strong></div>`).join("") || `<div class="empty-state">No invoices yet.</div>`;
    byId("payoutMsg").textContent = payouts.payouts.length ? `${payouts.payouts.length} payout request(s). Latest: ${payouts.payouts[0].status}` : "Payouts are reviewed by admin.";
  } catch (e) {
    if (byId("refBox")) byId("refBox").textContent = e.message;
  }
  byId("copyRef")?.addEventListener("click", async () => { if (referralLink) await navigator.clipboard.writeText(referralLink); });
  byId("shareRefWa")?.addEventListener("click", () => { if (referralLink) window.open(`https://wa.me/?text=${encodeURIComponent("Join me here: " + referralLink)}`, "_blank"); });
  byId("invoiceForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await apiFetch("/api/earn/invoices", { method: "POST", body: JSON.stringify({ offerKey: byId("invOffer").value, amountUsd: Number(byId("invAmount").value), leadName: byId("invLead").value, clientName: byId("invClient").value, clientEmail: byId("invEmail").value, notes: byId("invNotes").value }) });
      byId("invMsg").innerHTML = `Invoice created: <a href="${r.invoice.payLink}"><strong>${r.invoice.payLink}</strong></a>`;
    } catch (err) { byId("invMsg").textContent = err.message; }
  });
  byId("payoutForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiFetch("/api/earn/payouts", { method: "POST", body: JSON.stringify({ amountUsd: Number(byId("payoutAmount").value), destination: byId("payoutDest").value }) });
      byId("payoutMsg").textContent = "Payout requested.";
    } catch (err) { byId("payoutMsg").textContent = err.message; }
  });
});
