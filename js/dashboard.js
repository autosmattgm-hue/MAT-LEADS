import { apiFetch, byId, formatCurrency, getCurrentUser, requireAuth } from "./api.js";

function renderMetrics(metrics) {
  const target = byId("dashboardMetrics");
  if (!target) return;

  const items = [
    ["Total Leads", metrics.totalLeads],
    ["Saved Leads", metrics.savedLeads],
    ["Contacted", metrics.contactedLeads],
    ["Won Deals", metrics.wonDeals],
    ["Estimated Revenue", formatCurrency(metrics.estimatedRevenue)],
    ["Conversion Rate", `${metrics.conversionRate}%`]
  ];

  target.innerHTML = items.map(([label, value]) => `
    <article class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `).join("");
}

function renderChart(metrics) {
  const target = byId("growthChart");
  if (!target) return;

  const series = metrics.monthlyGrowth || [];
  const max = Math.max(...series.map((item) => item.value), 1);
  target.innerHTML = series.map((item) => `
    <div class="bar-row">
      <span>${item.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(item.value / max) * 100}%"></div></div>
      <strong>${item.value}</strong>
    </div>
  `).join("");
}

function renderAccessState() {
  const user = getCurrentUser();
  const plan = document.querySelector("[data-plan-pill]");
  const usage = document.querySelector("[data-usage-pill]");
  if (!plan || !usage || !user) return;

  if (user.role === "admin" || user.entitlements?.unlimitedAccess) {
    plan.textContent = "Admin Unlimited";
    usage.textContent = "All features unlocked";
    return;
  }

  if (user.subscription === "trial" || user.billingStatus === "trial" || user.entitlements?.trial) {
    const used = Number(user.trialSearchesUsed || user.entitlements?.trialSearchesUsed || 0);
    const limit = Number(user.trialSearchLimit || user.entitlements?.trialSearchLimit || 2);
    const leadLimit = Number(user.trialLeadLimit || user.entitlements?.trialLeadLimit || 5);
    plan.textContent = "Free Trial";
    usage.textContent = `${Math.max(0, limit - used)} of ${limit} searches left, ${leadLimit} leads each`;
    return;
  }

  plan.textContent = user.planName || user.subscription || "Starter";
  usage.textContent = "Paid plan active";
}

function readVaultLeads() {
  try {
    const parsed = JSON.parse(localStorage.getItem("mat_local_saved_leads_v1") || "[]");
    return Array.isArray(parsed) ? parsed.filter((lead) => lead?.id || lead?.name) : [];
  } catch {
    return [];
  }
}

function vaultStageValue(lead) {
  return String(lead?.stage || "New");
}

function mergeVaultIntoMetrics(metrics) {
  const base = { ...metrics };
  const vault = readVaultLeads();
  if (!vault.length) return base;
  const seen = new Set();
  // Server ids unseen here — vault entries carry their own ids; count vault-only extras.
  const extra = vault.filter((lead) => {
    const key = String(lead?.id || `${lead?.name || ""}|${lead?.address || ""}`).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!extra.length) return base;
  const contactedStages = new Set(["Contacted", "Follow Up", "Proposal Sent", "Meeting Scheduled", "Negotiation", "Won"]);
  const extraContacted = extra.filter((lead) => contactedStages.has(vaultStageValue(lead))).length;
  const extraWon = extra.filter((lead) => vaultStageValue(lead) === "Won").length;
  const extraRevenue = extra.reduce((sum, lead) => sum + Number(lead?.estimatedValue || 0), 0);
  const savedLeads = Number(base.savedLeads || 0) + extra.length;
  const wonDeals = Number(base.wonDeals || 0) + extraWon;
  return {
    ...base,
    totalLeads: Number(base.totalLeads || 0) + extra.length,
    savedLeads,
    contactedLeads: Number(base.contactedLeads || 0) + extraContacted,
    wonDeals,
    estimatedRevenue: Number(base.estimatedRevenue || 0) + extraRevenue,
    conversionRate: savedLeads ? Math.round((wonDeals / savedLeads) * 100) : 0,
  };
}

async function initDashboard() {
  const target = byId("dashboardMetrics");
  if (!target) return;
  if (!requireAuth()) return;
  renderAccessState();
  target.innerHTML = `<div class="skeleton">Loading revenue metrics...</div>`;

  try {
    const result = await apiFetch("/api/dashboard/metrics");
    const serverMetrics = result.metrics || { totalLeads: 0, savedLeads: 0, contactedLeads: 0, wonDeals: 0, estimatedRevenue: 0, conversionRate: 0, monthlyGrowth: [] };
    const metrics = mergeVaultIntoMetrics(serverMetrics);
    renderMetrics(metrics);
    renderChart(metrics || { monthlyGrowth: [] });
    if (metrics.savedLeads > serverMetrics.savedLeads) {
      const note = document.createElement("p");
      note.className = "notice";
      note.textContent = `${metrics.savedLeads - serverMetrics.savedLeads} saved lead(s) counted from this browser's vault (server CRM unreachable or empty). They stay after logout until you delete them.`;
      target.after(note);
    }
  } catch (error) {
    const msg = String(error?.message || "Metrics unavailable");
    target.innerHTML = `<div class="error-state">${msg}. Check Vercel env vars (Firebase/NVIDIA/JWT) and redeploy.</div>`;
  }
}

document.addEventListener("DOMContentLoaded", initDashboard);
