const TOKEN_KEY = "mat_access_token";
const REFRESH_KEY = "mat_refresh_token";
const USER_KEY = "mat_user";
const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/refresh",
  "/api/health"
]);
const PROTECTED_API_PREFIXES = [
  "/api/auth/me",
  "/api/auth/profile",
  "/api/auth/settings",
  "/api/dashboard/",
  "/api/leads/",
  "/api/crm/",
  "/api/admin/",
  "/api/ai/",
  "/api/billing/"
];

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
}

export function setRefreshToken(token) {
  if (token) localStorage.setItem(REFRESH_KEY, token);
}

export function setCurrentUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function setSession(session = {}) {
  setToken(session.accessToken || session.idToken);
  setRefreshToken(session.refreshToken);
  setCurrentUser(session.user);
}

export function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export function hasUsableToken(bufferSeconds = 30) {
  const token = getToken();
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) {
    localStorage.removeItem(TOKEN_KEY);
    return false;
  }
  const expiresAt = Number(payload.exp) * 1000;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + bufferSeconds * 1000) {
    localStorage.removeItem(TOKEN_KEY);
    return false;
  }
  return true;
}

export function hasStoredSession() {
  return hasUsableToken() || Boolean(getRefreshToken());
}

function isProtectedApiPath(path) {
  const pathname = String(path || "").split("?")[0];
  if (PUBLIC_API_PATHS.has(pathname)) return false;
  return PROTECTED_API_PREFIXES.some((prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix));
}

export function redirectToLogin() {
  const current = `${window.location.pathname}${window.location.search}`;
  if (window.location.pathname === "/login.html") return;
  window.location.replace(`/login.html?next=${encodeURIComponent(current || "/dashboard.html")}`);
}

export function requireAuth() {
  if (hasStoredSession()) return true;
  redirectToLogin();
  return false;
}

async function refreshSession() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error("Login required.");

  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken })
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    clearToken();
    const message = typeof payload === "object" && payload?.error ? payload.error.message : "Login required.";
    throw new Error(message);
  }

  setSession(payload);
  return payload.accessToken || payload.idToken;
}

export async function apiFetch(path, options = {}) {
  const requiresAuth = isProtectedApiPath(path);
  if (requiresAuth && !hasUsableToken()) {
    try {
      await refreshSession();
    } catch (error) {
      redirectToLogin();
      throw error;
    }
  }

  const headers = {
    "Content-Type": "application/json",
    ...options.headers
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, {
    ...options,
    headers
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    if (response.status === 401) {
      if (requiresAuth && getRefreshToken() && !options.__retriedAfterRefresh) {
        try {
          await refreshSession();
          return apiFetch(path, { ...options, __retriedAfterRefresh: true });
        } catch {
          clearToken();
          redirectToLogin();
        }
      } else {
        clearToken();
        if (requiresAuth) redirectToLogin();
      }
    }
    const fieldErrors = payload?.error?.details?.fieldErrors || payload?.error?.details;
    const fieldMessage = fieldErrors && typeof fieldErrors === "object"
      ? Object.entries(fieldErrors)
        .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(", ") : errors}`)
        .join(" | ")
      : "";
    const baseMessage = typeof payload === "object" && payload?.error ? payload.error.message : "Request failed";
    const message = fieldMessage ? `${baseMessage} (${fieldMessage})` : baseMessage;
    throw new Error(message);
  }

  return payload;
}

export function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value || 0);
}

export function scoreClass(score) {
  if (score >= 80) return "hot";
  if (score >= 55) return "high";
  if (score >= 30) return "warning";
  return "low";
}

export function byId(id) {
  return document.getElementById(id);
}
