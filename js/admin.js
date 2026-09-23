import { apiFetch, byId, formatCurrency, requireAuth } from "./api.js";

function renderAdmin(data) {
  const metrics = byId("adminMetrics");
  const logs = byId("auditLogs");
  if (metrics) {
    metrics.innerHTML = `
      <article class="metric"><span>Users</span><strong>${data.users}</strong></article>
      <article class="metric"><span>MRR</span><strong>${formatCurrency(data.mrr)}</strong></article>
      <article class="metric"><span>API Calls</span><strong>${data.apiCalls}</strong></article>
      <article class="metric"><span>Errors</span><strong>${data.errors}</strong></article>
      <article class="metric"><span>Admin Access</span><strong>${data.access?.unlimitedAccess ? "Unlimited" : "Limited"}</strong></article>
      <article class="metric"><span>Lead Limit</span><strong>${data.access?.monthlyLeadLimit === null ? "Unlimited" : data.access?.monthlyLeadLimit || "Plan"}</strong></article>
    `;
  }
  if (logs) {
    logs.innerHTML = data.auditLogs.map((log) => `
      <tr>
        <td>${log.time}</td>
        <td>${log.actor}</td>
        <td>${log.action}</td>
        <td>${log.ip}</td>
      </tr>
    `).join("");
  }
}

async function initAdmin() {
  const metrics = byId("adminMetrics");
  if (!metrics) return;
  if (!requireAuth()) return;
  metrics.innerHTML = `<div class="skeleton">Loading system controls...</div>`;

  try {
    const result = await apiFetch("/api/admin/overview");
    renderAdmin(result);
  } catch (error) {
    metrics.innerHTML = `<div class="error-state">${error.message}</div>`;
  }
}

document.addEventListener("DOMContentLoaded", initAdmin);
