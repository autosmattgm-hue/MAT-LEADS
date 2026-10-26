import { apiFetch, setSession } from "./api.js";

const FALLBACK_CONFIG = {
  apiKey: "AIzaSyA0nRrFw0WGjwfrJb-mnzFreR62hw8iLNw",
  authDomain: "mat-lead-c0ca4.firebaseapp.com",
  databaseURL: "https://mat-lead-c0ca4-default-rtdb.firebaseio.com",
  projectId: "mat-lead-c0ca4",
  storageBucket: "mat-lead-c0ca4.firebasestorage.app",
  messagingSenderId: "826518752424",
  appId: "1:826518752424:web:dbb47dd6ea98a028a6069d"
};

let firebaseConfig = { ...FALLBACK_CONFIG };
try {
  const res = await fetch("/api/config", { headers: { Accept: "application/json" } });
  if (res.ok) {
    const data = await res.json();
    if (data?.firebase?.configured) {
      firebaseConfig = {
        apiKey: data.firebase.apiKey,
        authDomain: data.firebase.authDomain,
        databaseURL: data.firebase.databaseURL,
        projectId: data.firebase.projectId,
        storageBucket: data.firebase.storageBucket,
        messagingSenderId: data.firebase.messagingSenderId,
        appId: data.firebase.appId
      };
    }
  }
} catch {}

const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
const {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  onAuthStateChanged
} = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js");

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.useDeviceLanguage();

export async function sessionWithBackend(firebaseUser, extra = {}) {
  const idToken = await firebaseUser.getIdToken(true);
  const result = await apiFetch("/api/auth/firebase", {
    method: "POST",
    body: JSON.stringify({ idToken, ...extra })
  });
  setSession(result);
  return result;
}

export async function signInWithGoogle(status) {
  try {
    if (status) status.textContent = "Opening Google sign-in...";
    const provider = new GoogleAuthProvider();
    const credential = await signInWithPopup(auth, provider);
    if (status) status.textContent = "Verifying with MAT LEADS...";
    const result = await sessionWithBackend(credential.user);
    if (status) status.textContent = "Success. Redirecting...";
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = next && next.startsWith("/") ? next : "/dashboard.html";
    return result;
  } catch (error) {
    if (status) status.textContent = friendlyAuthError(error);
    throw error;
  }
}

export async function registerWithEmail(name, email, password, status) {
  try {
    if (status) status.textContent = "Creating your workspace...";
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    try {
      await sendEmailVerification(credential.user);
    } catch {}
    if (status) status.textContent = "Verification email sent — finalizing your workspace...";
    await sessionWithBackend(credential.user, { name: name || "", password });
    try {
      const ref = new URLSearchParams(window.location.search).get("ref") || localStorage.getItem("mat_referral_code");
      if (ref) {
        localStorage.removeItem("mat_referral_code");
        await apiFetch("/api/earn/track-signup", { method: "POST", body: JSON.stringify({ ref }) }).catch(() => {});
      }
    } catch {}
    if (status) status.textContent = "Success. Check your email to verify, redirecting...";
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = next && next.startsWith("/") ? next : "/dashboard.html";
  } catch (error) {
    if (status) status.textContent = friendlyAuthError(error);
    throw error;
  }
}

export async function sendVerificationEmail(status) {
  const user = auth.currentUser;
  if (!user) throw new Error("Log in first, then request a verification email.");
  await sendEmailVerification(user);
  if (status) status.textContent = "Verification email sent. Check your inbox and spam folder.";
}

export async function sendPasswordReset(email, status) {
  try {
    if (status) status.textContent = "Sending reset email...";
    await sendPasswordResetEmail(auth, email);
    if (status) status.textContent = "Password reset email sent. Check your inbox and spam folder.";
  } catch (error) {
    if (status) status.textContent = friendlyAuthError(error);
    throw error;
  }
}

export function watchVerificationBanner() {
  const banner = document.querySelector("[data-verify-banner]");
  if (!banner) return;
  onAuthStateChanged(auth, async (user) => {
    if (!user || user.emailVerified || !user.email) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    const resend = banner.querySelector("[data-resend-verification]");
    if (resend && !resend.dataset.bound) {
      resend.dataset.bound = "1";
      resend.addEventListener("click", async () => {
        resend.disabled = true;
        try {
          await sendEmailVerification(user);
          resend.textContent = "Verification email sent — check your inbox";
        } catch (error) {
          resend.textContent = friendlyAuthError(error);
        } finally {
          setTimeout(() => { resend.disabled = false; }, 15000);
        }
      });
    }
  });
}

function friendlyAuthError(error) {
  const code = String(error?.code || "").replace(/^auth\//, "");
  if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request")) return "Google sign-in was closed before finishing. Try again.";
  if (code.includes("too-many-requests")) return "Too many attempts. Wait a few minutes and try again.";
  if (code.includes("email-already-in-use")) return "An account with this email already exists. Try logging in instead.";
  if (code.includes("weak-password")) return "Password is too weak. Use at least 8 characters.";
  if (code.includes("user-not-found") || code.includes("wrong-password") || code.includes("invalid-credential")) return "Invalid email or password.";
  if (code.includes("operation-not-allowed")) return "Email and password sign-in is temporarily unavailable. Please try again in a moment.";
  if (code.includes("unauthorized-domain")) return "Sign-in from this site is not enabled yet. Please contact support.";
  if (code.includes("billing-not-enabled") || code.includes("payment")) return "Sign-in is temporarily unavailable. Please try again in a moment.";
  const raw = String(error?.message || "");
  // Never surface SDK-internal wording (vendor names, auth/ codes) to users.
  if (!raw || /firebase|auth\/[a-z-]+/i.test(raw)) return "Something went wrong. Please try again.";
  return raw;
}

