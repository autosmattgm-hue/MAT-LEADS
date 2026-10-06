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
      try {
        const ref = new URLSearchParams(window.location.search).get("ref") || localStorage.getItem("mat_referral_code");
        if (mode === "register" && ref) {
          localStorage.removeItem("mat_referral_code");
          await apiFetch("/api/earn/track-signup", { method: "POST", body: JSON.stringify({ ref }) }).catch(() => {});
        }
      } catch {}
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
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initAuthForm();
  initLogout();
});
