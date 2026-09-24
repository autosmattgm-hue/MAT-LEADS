import { apiFetch, hasStoredSession } from "../js/api.js";

const navItems = [
  { href: "/dashboard.html", label: "Dashboard", icon: "D" },
  { href: "/crm.html", label: "CRM", icon: "C" },
  { href: "/lead-details.html", label: "Lead Details", icon: "L" },
  { href: "/reports.html", label: "Reports", icon: "R" },
  { href: "/analytics.html", label: "Analytics", icon: "A" },
  { href: "/pricing.html", label: "Pricing", icon: "$" },
  { href: "/profile.html", label: "Profile", icon: "P" },
  { href: "/settings.html", label: "Settings", icon: "S" },
  { href: "/admin.html", label: "Admin", icon: "M" }
];

function brandMarkup() {
  return `
    <a class="brand" href="/index.html" aria-label="MAT Leads AI Pro X home">
      <img src="/assets/logo-mark.svg" alt="" width="34" height="34">
      <span>MAT LEADS AI PRO X</span>
    </a>
  `;
}

function injectPwaMeta() {
  if (document.querySelector('link[rel="manifest"]')) return;
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = '/manifest.webmanifest';
  document.head.appendChild(link);

  const appleIcon = document.createElement('link');
  appleIcon.rel = 'apple-touch-icon';
  appleIcon.href = '/assets/logo-mark.svg';
  document.head.appendChild(appleIcon);

  const appleTitle = document.createElement('meta');
  appleTitle.name = 'apple-mobile-web-app-title';
  appleTitle.content = 'MAT Leads';
  document.head.appendChild(appleTitle);

  const appleCapable = document.createElement('meta');
  appleCapable.name = 'apple-mobile-web-app-capable';
  appleCapable.content = 'yes';
  document.head.appendChild(appleCapable);

  const themeColor = document.createElement('meta');
  themeColor.name = 'theme-color';
  themeColor.content = '#101828';
  document.head.appendChild(themeColor);
}

function initTheme() {
  const savedTheme = localStorage.getItem("mat-theme") || "light";
  document.documentElement.dataset.theme = savedTheme;
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("mat-theme", next);
}

function initPublicNav() {
  const target = document.querySelector("[data-public-nav]");
  if (!target) return;

  target.innerHTML = `
    ${brandMarkup()}
    <nav class="public-nav__links" aria-label="Primary">
      <a href="/index.html#lead-engine">Lead Engine</a>
      <a href="/index.html#ai">AI Analyzer</a>
      <a href="/pricing.html">Pricing</a>
      <a href="/login.html">Login</a>
    </nav>
    <div class="public-nav__actions">
      <button class="icon-button" type="button" data-theme-toggle aria-label="Toggle theme">T</button>
      <a class="btn btn-secondary" href="/login.html">Login</a>
      <a class="btn btn-primary" href="/signup.html">Start Free Trial</a>
    </div>
  `;
}

function initAppShell() {
  const shell = document.querySelector("[data-app-shell]");
  if (!shell) return;

  const active = document.body.dataset.page || "";
  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.id = "sidebar";
  sidebar.innerHTML = `
    ${brandMarkup()}
    <nav aria-label="Application">
      ${navItems.map((item) => `
        <a href="${item.href}" class="${active === item.label.toLowerCase().replaceAll(" ", "-") ? "active" : ""}">
          <span aria-hidden="true">${item.icon}</span>
          <span>${item.label}</span>
        </a>
      `).join("")}
    </nav>
  `;

  const workspace = shell.querySelector(".workspace");
  const topbar = document.createElement("header");
  topbar.className = "topbar";
  topbar.innerHTML = `
    <button class="icon-button mobile-menu hamburger-button" type="button" data-menu-toggle aria-controls="sidebar" aria-label="Open navigation" aria-expanded="false">
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
    </button>
    <div class="notice" role="status" data-session-badge>NVIDIA-only AI pipeline connected through secure server endpoints.</div>
    <div class="topbar-actions">
      <button class="icon-button" type="button" data-theme-toggle aria-label="Toggle theme">T</button>
      <a class="btn btn-secondary" href="/reports.html">Reports</a>
      <a class="btn btn-primary" href="/dashboard.html">Search Leads</a>
    </div>
  `;

  shell.prepend(sidebar);
  workspace.prepend(topbar);
}

function sessionText(user) {
  if (user?.role === "admin" || user?.entitlements?.unlimitedAccess) {
    return "Admin Unlimited Access: every feature is unlocked with no billing required.";
  }
  if (user?.subscription === "trial" || user?.billingStatus === "trial" || user?.entitlements?.trial) {
    const used = Number(user.trialSearchesUsed || user.entitlements?.trialSearchesUsed || 0);
    const limit = Number(user.trialSearchLimit || user.entitlements?.trialSearchLimit || 2);
    const leadLimit = Number(user.trialLeadLimit || user.entitlements?.trialLeadLimit || 5);
    return `Free Trial active: ${Math.max(0, limit - used)} of ${limit} searches left, ${leadLimit} leads per search.`;
  }
  return `${user?.planName || user?.subscription || "Starter"} workspace active.`;
}

function consumeSessionNotice() {
  const notice = localStorage.getItem("mat_session_notice") || "";
  if (notice) localStorage.removeItem("mat_session_notice");
  return notice;
}

async function initSessionBadge() {
  const target = document.querySelector("[data-session-badge]");
  if (!target) return;
  const sessionNotice = consumeSessionNotice();

  const cached = localStorage.getItem("mat_user");
  if (cached) {
    try {
      const user = JSON.parse(cached);
      target.textContent = sessionText(user);
    } catch {
      target.textContent = "Workspace session active.";
    }
  }
  if (sessionNotice) target.textContent = sessionNotice;

  if (!hasStoredSession()) {
    target.textContent = "Login required to access the workspace.";
    return;
  }

  try {
    const result = await apiFetch("/api/auth/me");
    const user = result.user;
    localStorage.setItem("mat_user", JSON.stringify(user));
    if (sessionNotice) {
      window.setTimeout(() => {
        target.textContent = sessionText(user);
      }, 5000);
    } else {
      target.textContent = sessionText(user);
    }
  } catch {
    target.textContent = "Workspace session active.";
  }
}

function initMenu() {
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-menu-toggle]");
    const sidebar = document.getElementById("sidebar");
    if (toggle && sidebar) {
      sidebar.classList.toggle("open");
      const isOpen = sidebar.classList.contains("open");
      document.body.classList.toggle("locked", isOpen);
      toggle.setAttribute("aria-expanded", String(isOpen));
      toggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
      return;
    }

    if (sidebar?.classList.contains("open") && !event.target.closest(".sidebar")) {
      sidebar.classList.remove("open");
      document.body.classList.remove("locked");
      document.querySelector("[data-menu-toggle]")?.setAttribute("aria-expanded", "false");
    }
  });
}

function initThemeButtons() {
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-theme-toggle]")) {
      toggleTheme();
    }
  });
}

initTheme();
injectPwaMeta();
document.addEventListener("DOMContentLoaded", () => {
  initPublicNav();
  initAppShell();
  initMenu();
  initThemeButtons();
  initSessionBadge();

  // Load PWA registration script
  if (!document.querySelector('script[src="/js/pwa.js"]')) {
    const pwaScript = document.createElement('script');
    pwaScript.src = '/js/pwa.js';
    document.body.appendChild(pwaScript);
  }
});
