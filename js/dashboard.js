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

async function initDashboard() {
  const target = byId("dashboardMetrics");
  if (!target) return;
  if (!requireAuth()) return;
  renderAccessState();
  target.innerHTML = `<div class="skeleton">Loading revenue metrics...</div>`;

  try {
    const result = await apiFetch("/api/dashboard/metrics");
    renderMetrics(result.metrics || { totalLeads: 0, savedLeads: 0, contactedLeads: 0, wonDeals: 0, estimatedRevenue: 0, conversionRate: 0, monthlyGrowth: [] });
    renderChart(result.metrics || { monthlyGrowth: [] });
  } catch (error) {
    const msg = String(error?.message || "Metrics unavailable");
    target.innerHTML = `<div class="error-state">${msg}. Check Vercel env vars (Firebase/NVIDIA/JWT) and redeploy.</div>`;
  }
}

document.addEventListener("DOMContentLoaded", initDashboard);
