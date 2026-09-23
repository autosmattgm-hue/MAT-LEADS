import crypto from "node:crypto";
import { promisify } from "node:util";
import { env } from "../config/env.js";
import { isFirebaseAuthConfigured } from "../config/firebase.js";
import { getPlan } from "../config/plans.js";
import { FirestoreRepository } from "../repositories/firestoreRepository.js";
import { AppError } from "../utils/errors.js";
import { applyAdminEntitlements } from "../utils/entitlements.js";
import { logger } from "../utils/logger.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../middleware/auth.js";

const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

async function verifyPassword(password, passwordHash) {
  const [scheme, salt, key] = String(passwordHash).split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(key, "hex");
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

const FIREBASE_AUTH_TIMEOUT_MS = 15000;

const firebaseAuthErrors = {
  EMAIL_EXISTS: ["An account with this email already exists. Log in instead.", 409, "ACCOUNT_EXISTS"],
  EMAIL_NOT_FOUND: ["Invalid email or password.", 401, "INVALID_CREDENTIALS"],
  INVALID_LOGIN_CREDENTIALS: ["Invalid email or password.", 401, "INVALID_CREDENTIALS"],
  INVALID_PASSWORD: ["Invalid email or password.", 401, "INVALID_CREDENTIALS"],
  USER_DISABLED: ["This account has been disabled in Firebase Authentication.", 403, "ACCOUNT_DISABLED"],
  INVALID_EMAIL: ["Enter a valid email address.", 422, "INVALID_EMAIL"],
  MISSING_EMAIL: ["Email is required.", 422, "MISSING_EMAIL"],
  MISSING_PASSWORD: ["Password is required.", 422, "MISSING_PASSWORD"],
  WEAK_PASSWORD: ["Password must be at least 8 characters long.", 422, "WEAK_PASSWORD"],
  TOO_MANY_ATTEMPTS_TRY_LATER: ["Too many attempts. Wait a moment and try again.", 429, "TOO_MANY_ATTEMPTS"],
  API_KEY_INVALID: ["The Firebase web API key in .env is not valid. Copy the real key from Firebase console > Project settings > Web API key.", 503, "FIREBASE_AUTH_NOT_CONFIGURED"],
  INVALID_API_KEY: ["The Firebase web API key in .env is not valid. Copy the real key from Firebase console > Project settings > Web API key.", 503, "FIREBASE_AUTH_NOT_CONFIGURED"],
  PERMISSION_DENIED: ["Firebase Authentication rejected this API key. Enable the Identity Toolkit API and allow the key in Google Cloud.", 503, "FIREBASE_AUTH_NOT_CONFIGURED"],
  OPERATION_NOT_ALLOWED: ["Email/password sign-in is disabled in Firebase. Enable it in Authentication > Sign-in method.", 503, "FIREBASE_AUTH_NOT_CONFIGURED"],
  CONFIGURATION_NOT_FOUND: ["Firebase Authentication is not configured for this project.", 503, "FIREBASE_AUTH_NOT_CONFIGURED"]
};

const firebaseUnavailableCodes = new Set([
  "API_KEY_INVALID",
  "INVALID_API_KEY",
  "PERMISSION_DENIED",
  "OPERATION_NOT_ALLOWED",
  "CONFIGURATION_NOT_FOUND",
  "FIREBASE_TIMEOUT",
  "FIREBASE_UNREACHABLE",
  "INTERNAL_ERROR"
]);

function firebaseErrorReason(payload, status) {
  const reason = payload?.error?.message || "";
  const normalized = String(reason || " : ").split(" : ")[0].trim();
  return normalized || `HTTP_${status}`;
}

async function firebaseAuthRequest(action, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FIREBASE_AUTH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${env.firebase.webApiKey}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, returnSecureToken: true })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, payload, code: "" };
    const code = firebaseErrorReason(payload, response.status);
    logger.warn("firebase_auth_rejected", { action, status: response.status, code });
    return { ok: false, payload, code, status: response.status };
  } catch (error) {
    const code = error?.name === "AbortError" ? "FIREBASE_TIMEOUT" : "FIREBASE_UNREACHABLE";
    logger.warn("firebase_auth_unreachable", { action, code, message: error.message });
    return { ok: false, payload: {}, code, status: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

function isFirebaseAuthUnavailable(code) {
  return firebaseUnavailableCodes.has(code);
}

function firebaseAuthError(code, fallbackMessage = "Authentication failed.", fallbackStatus = 400, fallbackCode = "AUTH_FAILED") {
  const [message, status, appCode] = firebaseAuthErrors[code] || [fallbackMessage, fallbackStatus, fallbackCode];
  return new AppError(message, status, appCode);
}

function displayNameFromFirebase(payload, email) {
  const fromToken = payload?.displayName;
  if (fromToken) return fromToken;
  const local = String(email || "").split("@")[0];
  return local || "Member";
}

function planFields(planKey = "trial") {
  const plan = getPlan(planKey) || getPlan("trial");
  return {
    subscription: plan.key,
    planName: plan.name,
    monthlyLeadLimit: plan.monthlyLeadLimit,
    trialSearchLimit: plan.trialSearchLimit,
    trialLeadLimit: plan.trialLeadLimit
  };
}

function trialEntitlements(trialSearchesUsed = 0) {
  const plan = getPlan("trial");
  return {
    billingRequired: true,
    trial: true,
    trialSearchesUsed,
    trialSearchLimit: plan.trialSearchLimit,
    trialLeadLimit: plan.trialLeadLimit,
    upgradeRequiredAfterTrial: true
  };
}

function isActivatedPaidUser(user = {}) {
  return Boolean(user.entitlements?.activePlan || user.planActivatedAt || user.paypalCheckoutSessionId);
}

function storedPlanKey(user = {}) {
  if (!user?.subscription || user.subscription === "trial") return "trial";
  return isActivatedPaidUser(user) ? user.subscription : "trial";
}

function storedBillingStatus(user = {}) {
  return storedPlanKey(user) === "trial" ? "trial" : user.billingStatus || "active";
}

function storedEntitlements(user = {}) {
  return storedPlanKey(user) === "trial"
    ? trialEntitlements(Number(user.trialSearchesUsed || 0))
    : user.entitlements || {};
}

function defaultSettings(settings = {}) {
  return {
    leadAlerts: settings.leadAlerts ?? true,
    weeklyDigest: settings.weeklyDigest ?? true,
    defaultCountry: settings.defaultCountry || "United States",
    defaultResults: settings.defaultResults || 20,
    brandName: settings.brandName || "MAT Leads AI Pro X",
    bookingUrl: settings.bookingUrl || "",
    primaryOffer: settings.primaryOffer || "Website + local lead growth audit",
    proposalPrice: settings.proposalPrice ?? 2500,
    followUpCadence: settings.followUpCadence || "Day 1, Day 3, Day 7",
    noWebsiteWeight: settings.noWebsiteWeight ?? 50,
    poorMobileWeight: settings.poorMobileWeight ?? 20,
    weakSeoWeight: settings.weakSeoWeight ?? 20,
    noSslWeight: settings.noSslWeight ?? 10
  };
}

function publicUser(user = {}) {
  const {
    passwordHash,
    firebaseRefreshToken,
    idToken,
    ...safeUser
  } = user;
  return safeUser;
}

export class AuthService {
  constructor() {
    this.users = new FirestoreRepository("users");
  }

  isOwnerLogin(email, password) {
    return email.toLowerCase() === env.owner.email && password === env.owner.password;
  }

  ownerSession() {
    const user = applyAdminEntitlements({
      uid: "owner",
      name: "Owner",
      email: env.owner.email,
      role: "admin",
      subscription: "enterprise",
      billingStatus: "owner_free",
      monthlyLeadLimit: null
    });

    return {
      user,
      accessToken: signAccessToken(user),
      refreshToken: signRefreshToken({ ...user, tokenVersion: 1 })
    };
  }

  async register({ name, email, password }) {
    const normalizedEmail = email.toLowerCase();
    let user = null;
    let authProvider = "local_store";
    let notice = "";

    if (isFirebaseAuthConfigured()) {
      const result = await firebaseAuthRequest("signUp", { email: normalizedEmail, password });
      if (result.ok) {
        authProvider = "firebase_auth";
        user = {
          uid: result.payload.localId,
          name,
          email: normalizedEmail,
          role: "user",
          idToken: result.payload.idToken,
          firebaseRefreshToken: result.payload.refreshToken
        };
      } else if (isFirebaseAuthUnavailable(result.code)) {
        notice = `Firebase Authentication is unavailable (${result.code}), so this account was created in the local store instead.`;
      } else {
        throw firebaseAuthError(result.code, "Unable to create the Firebase account.", 400, "FIREBASE_SIGNUP_FAILED");
      }
    }

    if (!user) {
      const existing = await this.users.list({
        where: [{ field: "email", op: "==", value: normalizedEmail }],
        limit: 1
      });
      if (existing.length) throw new AppError("An account with this email already exists. Log in instead.", 409, "ACCOUNT_EXISTS");
      const passwordHash = await hashPassword(password);
      const created = await this.users.create({ name, email: normalizedEmail, passwordHash, role: "user", tokenVersion: 1 });
      user = { uid: created.id, name, email: normalizedEmail, role: "user", tokenVersion: created.tokenVersion || 1 };
    }

    await this.users.upsert(user.uid || user.id, {
      uid: user.uid || user.id,
      name,
      email: normalizedEmail,
      role: user.role,
      ...planFields("trial"),
      billingStatus: "trial",
      trialSearchesUsed: 0,
      entitlements: trialEntitlements(0),
      emailVerified: false,
      tokenVersion: user.tokenVersion || 1
    });

    const sessionUser = applyAdminEntitlements({
      uid: user.uid || user.id,
      name,
      email: normalizedEmail,
      role: user.role,
      ...planFields("trial"),
      billingStatus: "trial",
      trialSearchesUsed: 0,
      entitlements: trialEntitlements(0)
    });

    return {
      user: sessionUser,
      authProvider,
      notice: notice || undefined,
      idToken: user.idToken,
      firebaseRefreshToken: user.firebaseRefreshToken,
      accessToken: signAccessToken(sessionUser),
      refreshToken: signRefreshToken({ uid: user.uid || user.id, email: normalizedEmail, role: user.role || "user", tokenVersion: user.tokenVersion || 1 })
    };
  }

  async login({ email, password }) {
    const normalizedEmail = email.toLowerCase();

    if (this.isOwnerLogin(normalizedEmail, password)) {
      return this.ownerSession();
    }

    if (isFirebaseAuthConfigured()) {
      const result = await firebaseAuthRequest("signInWithPassword", { email: normalizedEmail, password });

      if (result.ok) {
        return this.firebaseSession(result.payload, normalizedEmail);
      }

      try {
        return await this.localLogin(normalizedEmail, password);
      } catch (localError) {
        if (isFirebaseAuthUnavailable(result.code)) {
          throw firebaseAuthError(result.code, "Firebase Authentication is unavailable.", 503, "FIREBASE_AUTH_NOT_CONFIGURED");
        }
        throw localError;
      }
    }

    return this.localLogin(normalizedEmail, password);
  }

  async localLogin(normalizedEmail, password) {
    const users = await this.users.list({
      where: [{ field: "email", op: "==", value: normalizedEmail }],
      limit: 1
    });
    const user = users[0];
    if (!user || !user.passwordHash) throw new AppError("Invalid email or password.", 401, "INVALID_CREDENTIALS");

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) throw new AppError("Invalid email or password.", 401, "INVALID_CREDENTIALS");

    const entitledUser = applyAdminEntitlements({
      uid: user.uid || user.id,
      name: user.name,
      email: normalizedEmail,
      role: user.role || "user",
      ...planFields(storedPlanKey(user)),
      billingStatus: storedBillingStatus(user),
      trialSearchesUsed: Number(user.trialSearchesUsed || 0),
      permissions: user.permissions,
      entitlements: storedEntitlements(user)
    });

    return {
      user: entitledUser,
      authProvider: "local_store",
      accessToken: signAccessToken(entitledUser),
      refreshToken: signRefreshToken({ uid: user.uid || user.id, email: normalizedEmail, role: user.role || "user", tokenVersion: user.tokenVersion || 1 })
    };
  }

  async firebaseSession(payload, normalizedEmail) {
    const uid = payload.localId;
    let storedUser = await this.users.findById(uid);
    if (!storedUser) {
      storedUser = await this.users.upsert(uid, {
        uid,
        name: displayNameFromFirebase(payload, normalizedEmail),
        email: normalizedEmail,
        role: "user",
        ...planFields("trial"),
        billingStatus: "trial",
        trialSearchesUsed: 0,
        entitlements: trialEntitlements(0),
        emailVerified: Boolean(payload.registered),
        tokenVersion: 1
      });
    }

    const user = applyAdminEntitlements({
      uid,
      name: storedUser?.name || displayNameFromFirebase(payload, normalizedEmail),
      email: normalizedEmail,
      role: storedUser?.role || "user",
      ...planFields(storedPlanKey(storedUser)),
      billingStatus: storedBillingStatus(storedUser),
      trialSearchesUsed: Number(storedUser?.trialSearchesUsed || 0),
      permissions: storedUser?.permissions || [],
      entitlements: storedEntitlements(storedUser)
    });

    return {
      user,
      authProvider: "firebase_auth",
      idToken: payload.idToken,
      firebaseRefreshToken: payload.refreshToken,
      accessToken: signAccessToken(user),
      refreshToken: signRefreshToken(user)
    };
  }

  async refreshSession(refreshToken) {
    if (!refreshToken) throw new AppError("Refresh token required.", 401, "REFRESH_REQUIRED");
    let decoded;
    try {
      decoded = await verifyRefreshToken(refreshToken);
    } catch {
      throw new AppError("Invalid or expired refresh token.", 401, "INVALID_REFRESH_TOKEN");
    }

    if (decoded.uid === "owner") {
      return this.ownerSession();
    }

    const stored = await this.users.findById(decoded.uid);
    if (stored?.tokenVersion && Number(stored.tokenVersion) !== Number(decoded.tokenVersion || 1)) {
      throw new AppError("Session has been revoked. Please log in again.", 401, "SESSION_REVOKED");
    }

    const source = stored || decoded;
    const sessionUser = applyAdminEntitlements({
      uid: decoded.uid,
      name: source.name || "",
      email: source.email || decoded.email || "",
      role: source.role || decoded.role || "user",
      ...planFields(storedPlanKey(source)),
      billingStatus: storedBillingStatus(source),
      trialSearchesUsed: Number(source.trialSearchesUsed || 0),
      permissions: source.permissions || [],
      entitlements: storedEntitlements(source)
    });

    return {
      user: sessionUser,
      accessToken: signAccessToken(sessionUser),
      refreshToken: signRefreshToken({
        uid: sessionUser.uid,
        email: sessionUser.email,
        role: sessionUser.role,
        tokenVersion: source.tokenVersion || decoded.tokenVersion || 1
      })
    };
  }

  async currentUser(user) {
    if (!user?.uid) throw new AppError("Authentication required.", 401, "AUTH_REQUIRED");
    if (user.uid === "owner" || user.role === "admin") {
      const stored = await this.users.findById(user.uid);
      const source = { ...user, ...(stored || {}) };
      return publicUser(applyAdminEntitlements({
        ...source,
        settings: defaultSettings(source.settings),
        company: source.company || "MAT Leads AI Pro X",
        signature: source.signature || "Best regards, MAT Leads AI Pro X"
      }));
    }

    const stored = await this.users.findById(user.uid);
    const source = { ...user, ...(stored || {}) };
    return publicUser(applyAdminEntitlements({
      uid: user.uid,
      name: source.name || "",
      email: source.email || user.email || "",
      role: source.role || "user",
      ...planFields(storedPlanKey(source)),
      billingStatus: storedBillingStatus(source),
      trialSearchesUsed: Number(source.trialSearchesUsed || 0),
      permissions: source.permissions || [],
      entitlements: storedEntitlements(source),
      emailVerified: Boolean(source.emailVerified),
      company: source.company || "",
      signature: source.signature || "",
      settings: defaultSettings(source.settings)
    }));
  }

  async updateProfile(user, profile) {
    const current = await this.currentUser(user);
    const updated = await this.users.upsert(user.uid, {
      name: profile.name,
      company: profile.company,
      signature: profile.signature,
      email: current.email,
      role: current.role || "user"
    });
    const sessionUser = await this.currentUser({ ...current, ...updated });
    return {
      user: sessionUser,
      accessToken: signAccessToken(sessionUser)
    };
  }

  async updateSettings(user, settings) {
    const current = await this.currentUser(user);
    const nextSettings = defaultSettings(settings);
    await this.users.upsert(user.uid, {
      email: current.email,
      role: current.role || "user",
      settings: nextSettings
    });
    const sessionUser = await this.currentUser(user);
    return {
      settings: sessionUser.settings,
      user: sessionUser,
      accessToken: signAccessToken(sessionUser)
    };
  }
}
