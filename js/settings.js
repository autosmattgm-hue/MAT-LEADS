import { apiFetch, byId, requireAuth, setCurrentUser, setToken } from "./api.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function statusPill(enabled) {
  return `<span class="status-pill ${enabled ? "success" : "danger"}">${enabled ? "Connected" : "Required"}</span>`;
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function setSettingsStatus(message, state = "info") {
  const target = document.querySelector("[data-settings-status]");
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("success", state === "success");
  target.classList.toggle("error", state === "error");
}

function settingsPayload() {
  return {
    leadAlerts: byId("leadAlerts")?.checked,
    weeklyDigest: byId("weeklyDigest")?.checked,
    defaultCountry: byId("defaultCountry")?.value || "",
    defaultResults: byId("defaultResults")?.value || 20,
    brandName: byId("brandName")?.value || "",
    bookingUrl: byId("bookingUrl")?.value || "",
    primaryOffer: byId("primaryOffer")?.value || "",
    proposalPrice: byId("proposalPrice")?.value || 2500,
    followUpCadence: byId("followUpCadence")?.value || "",
    noWebsiteWeight: byId("noWebsiteWeight")?.value || 50,
    poorMobileWeight: byId("poorMobileWeight")?.value || 20,
    weakSeoWeight: byId("weakSeoWeight")?.value || 20,
    noSslWeight: byId("noSslWeight")?.value || 10
  };
}

function populateSettings(settings = {}) {
  byId("leadAlerts").checked = settings.leadAlerts ?? true;
  byId("weeklyDigest").checked = settings.weeklyDigest ?? true;
  byId("defaultCountry").value = settings.defaultCountry || "United States";
  byId("defaultResults").value = settings.defaultResults || 20;
  byId("brandName").value = settings.brandName || "MAT Leads AI Pro X";
  byId("bookingUrl").value = settings.bookingUrl || "";
  byId("primaryOffer").value = settings.primaryOffer || "Website + local lead growth audit";
  byId("proposalPrice").value = settings.proposalPrice ?? 2500;
  byId("followUpCadence").value = settings.followUpCadence || "Day 1, Day 3, Day 7";
  byId("noWebsiteWeight").value = settings.noWebsiteWeight ?? 50;
  byId("poorMobileWeight").value = settings.poorMobileWeight ?? 20;
  byId("weakSeoWeight").value = settings.weakSeoWeight ?? 20;
  byId("noSslWeight").value = settings.noSslWeight ?? 10;
}

function renderSettingsSummary(user = {}, settings = {}) {
  const target = document.querySelector("[data-settings-summary]");
  if (!target) return;
  const plan = user.role === "admin" || user.entitlements?.unlimitedAccess
    ? "Admin Unlimited"
    : user.planName || user.subscription || "Workspace";
  const bookingUrl = safeExternalUrl(settings.bookingUrl);
  target.innerHTML = `
    <div class="audit-item"><span>Current plan</span><strong>${escapeHtml(plan)}</strong></div>
    <div class="audit-item"><span>Report brand</span><strong>${escapeHtml(settings.brandName || "MAT Leads AI Pro X")}</strong></div>
    <div class="audit-item"><span>Primary offer</span><strong>${escapeHtml(settings.primaryOffer || "Website + local lead growth audit")}</strong></div>
    <div class="audit-item"><span>Booking URL</span><strong>${bookingUrl ? `<a href="${escapeHtml(bookingUrl)}" target="_blank" rel="noreferrer">${escapeHtml(bookingUrl)}</a>` : "Not set"}</strong></div>
    <div class="audit-item"><span>Default proposal</span><strong>$${escapeHtml(settings.proposalPrice ?? 2500)}</strong></div>
    <div class="audit-item"><span>Default scan</span><strong>${escapeHtml(settings.defaultCountry || "United States")}</strong></div>
    <div class="audit-item"><span>Default results</span><strong>${escapeHtml(settings.defaultResults || 20)}</strong></div>
    <div class="audit-item"><span>Follow-up cadence</span><strong>${escapeHtml(settings.followUpCadence || "Day 1, Day 3, Day 7")}</strong></div>
    <div class="audit-item"><span>Lead alerts</span><span class="status-pill ${settings.leadAlerts ? "success" : "warning"}">${settings.leadAlerts ? "On" : "Off"}</span></div>
  `;
}

async function initIntegrationStatus() {
  const target = byId("integrationStatus");
  const missing = byId("missingConfig");
  if (!target) return;

  try {
    const health = await apiFetch("/api/health");
    const integrations = health.integrations || {};
    target.innerHTML = `
      <div class="audit-item"><span>Google Places API</span>${statusPill(integrations.googlePlaces)}</div>
      <div class="audit-item"><span>OpenStreetMap Overpass</span>${statusPill(integrations.openStreetMap)}</div>
      <div class="audit-item"><span>Firebase Firestore</span>${statusPill(integrations.firebase)}</div>
      <div class="audit-item"><span>NVIDIA API</span>${statusPill(integrations.nvidia)}</div>
      <div class="audit-item"><span>Stripe Billing</span>${statusPill(integrations.stripe)}</div>
      <div class="audit-item"><span>PayPal Billing</span>${statusPill(integrations.paypal)}</div>
    `;

    if (missing) {
      const items = health.missingRequiredForLiveOperation || [];
      missing.textContent = items.length
        ? `live operation: ${items.join(", ")}.`
        : "All live provider credentials are configured.";
    }
  } catch (error) {
    target.innerHTML = `<div class="error-state">${error.message}</div>`;
  }
}

async function loadSettings() {
  if (!requireAuth()) return;
  try {
    const result = await apiFetch("/api/auth/settings");
    const settings = result.settings || {};
    populateSettings(settings);
    if (result.user) setCurrentUser(result.user);
    renderSettingsSummary(result.user || {}, settings);
    setSettingsStatus("Settings loaded.");
  } catch (error) {
    setSettingsStatus(error.message, "error");
  }
}

function initSettingsForm() {
  const form = document.querySelector("[data-settings-form]");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!requireAuth()) return;

    const submit = document.querySelector("[form='workspaceSettingsForm']");
    const original = submit?.textContent || "Save Settings";
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Saving...";
    }
    setSettingsStatus("Saving settings...");

    try {
      const result = await apiFetch("/api/auth/settings", {
        method: "PATCH",
        body: JSON.stringify(settingsPayload())
      });
      if (result.accessToken) setToken(result.accessToken);
      if (result.user) setCurrentUser(result.user);
      populateSettings(result.settings || {});
      renderSettingsSummary(result.user || {}, result.settings || {});
      setSettingsStatus("Settings saved.", "success");
    } catch (error) {
      setSettingsStatus(error.message, "error");
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = original;
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initSettingsForm();
  initIntegrationStatus();
  loadSettings();
});
