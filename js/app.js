import { apiFetch, setSession, clearToken } from "./api.js";

function loadFirebaseAuth() {
  return import("./firebase-auth.js");
}

function redirectAfterAuth() {
  const next = new URLSearchParams(window.location.search).get("next");
  window.location.href = next && next.startsWith("/") ? next : "/dashboard.html";
}

function initAuthForm() {
  const form = document.querySelector("[data-auth-form]");
  if (!form) return;

  const mode = form.dataset.authForm;
  const status = document.querySelector("[data-form-status]");

  const googleBtn = document.querySelector("[data-google-auth]");
  if (googleBtn) {
    googleBtn.addEventListener("click", async () => {
      if (googleBtn.disabled) return;
      googleBtn.disabled = true;
      try {
        const { signInWithGoogle } = await loadFirebaseAuth();
        await signInWithGoogle(status);
      } catch (error) {
        if (status && !String(status.textContent).includes("Redirecting")) {
          status.textContent = error?.message || "Google sign-in failed. Please try again.";
        }
      } finally {
        googleBtn.disabled = false;
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (status) status.textContent = "Submitting...";

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    if (mode === "register") {
      // Backend-owned signup: the account is created unverified and a
      // verification link is emailed. No session is issued until confirmed.
      try {
        const ref = new URLSearchParams(window.location.search).get("ref") || localStorage.getItem("mat_referral_code") || "";
        const result = await apiFetch("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ ...payload, ...(ref ? { ref } : "") })
        });
        if (ref) {
          try { localStorage.removeItem("mat_referral_code"); } catch {}
        }
        if (result.verificationRequired) {
          try {
            localStorage.setItem("mat_pending_verification", JSON.stringify({
              email: payload.email || "",
              url: result.verificationUrl || "",
              token: result.verificationToken || "",
              sent: Boolean(result.verificationSent),
              at: Date.now()
            }));
          } catch {}
          if (status) status.textContent = result.message || "Check your inbox for the verification link.";
          setTimeout(() => {
            window.location.href = `/verify-email.html?sent=1&email=${encodeURIComponent(payload.email || "")}`;
          }, 900);
          return;
        }
        setSession(result);
        if (status) status.textContent = "Success. Redirecting...";
        redirectAfterAuth();
      } catch (error) {
        if (status) status.textContent = error.message;
      }
      return;
    }

    try {
      const result = await apiFetch(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setSession(result);
      if (status) status.textContent = "Success. Redirecting...";
      redirectAfterAuth();
    } catch (error) {
      if (status && error.code === "ACCOUNT_NOT_VERIFIED") {
        status.textContent = "";
        const line = document.createElement("span");
        line.textContent = `${error.message} `;
        const resend = document.createElement("a");
        resend.href = `/verify-email.html?resend=1&email=${encodeURIComponent(payload.email || "")}`;
        resend.textContent = "Resend verification link";
        resend.style.textDecoration = "underline";
        status.append(line, resend);
      } else if (status) {
        status.textContent = error.message;
      }
    }
  });
}

function initForgotPassword() {
  const form = document.querySelector("[data-forgot-form]");
  if (!form) return;
  const status = document.querySelector("[data-form-status]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(new FormData(form).get("email") || "").trim();
    if (!email || !status) return;
    try {
      const { sendPasswordReset } = await loadFirebaseAuth();
      await sendPasswordReset(email, status);
    } catch (error) {
      status.textContent = error?.message || "Could not send the reset email.";
    }
  });
}

function initVerifyBanner() {
  if (!document.querySelector("[data-verify-banner]")) return;
  loadFirebaseAuth()
    .then((m) => m.watchVerificationBanner())
    .catch(() => {});
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
  initForgotPassword();
  initVerifyBanner();
  initLogout();
});
