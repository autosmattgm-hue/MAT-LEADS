import { apiFetch, setSession, clearToken } from "./api.js";

function initAuthForm() {
  const form = document.querySelector("[data-auth-form]");
  if (!form) return;

  const mode = form.dataset.authForm;
  const status = document.querySelector("[data-form-status]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "Submitting...";

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    try {
      const result = await apiFetch(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setSession(result);
      status.textContent = "Success. Redirecting...";
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") ? next : "/dashboard.html";
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

function initLogout() {
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-logout]")) {
      clearToken();
      window.location.href = "/login.html";
    }
    const ownerBtn = event.target.closest("[data-owner-login]");
    if (ownerBtn) {
      const status = document.querySelector("[data-form-status]");
      ownerBtn.disabled = true;
      const original = ownerBtn.textContent;
      ownerBtn.textContent = "Logging in as Owner...";
      if (status) status.textContent = "Trying owner@matleads.local ...";
      const tries = [
        { email: "owner@matleads.local", password: "admin2026" },
        { email: "owner@matleads.local", password: "freeusers2026" }
      ];
      (async () => {
        let lastErr = "";
        for (const payload of tries) {
          try {
            const result = await apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
            setSession(result);
            if (status) status.textContent = "Success. Redirecting...";
            window.location.href = "/dashboard.html";
            return;
          } catch (e) { lastErr = e.message; }
        }
        if (status) status.textContent = `Owner login failed: ${lastErr}. Make sure 'node api/server.js' is running, then type email owner@matleads.local manually.`;
        ownerBtn.disabled = false;
        ownerBtn.textContent = original;
      })();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initAuthForm();
  initLogout();
});
