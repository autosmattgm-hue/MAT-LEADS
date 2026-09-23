import crypto from "node:crypto";
import { promisify } from "node:util";
import { env } from "../config/env.js";
import { isFirebaseAuthConfigured } from "../config/firebase.js";
import { getPlan } from "../config/plans.js";
import { FirestoreRepository } from "../repositories/firestoreRepository.js";
import { AppError } from "../utils/errors.js";
import { applyAdminEntitlements } from "../utils/entitlements.js";
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
    let user;

    if (isFirebaseAuthConfigured()) {
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${env.firebase.webApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
          returnSecureToken: true
        })
      });
      if (!response.ok) throw new AppError("Unable to create Firebase account.", 400, "FIREBASE_SIGNUP_FAILED");
      const payload = await response.json();
      user = {
        uid: payload.localId,
        name,
        email: normalizedEmail,
        role: "user",
        idToken: payload.idToken,
        firebaseRefreshToken: payload.refreshToken
      };
    } else {
      const existing = await this.users.list({
        where: [{ field: "email", op: "==", value: normalizedEmail }],
        limit: 1
      });
      if (existing.length) throw new AppError("Account already exists.", 409, "ACCOUNT_EXISTS");
      const passwordHash = await hashPassword(password);
      user = await this.users.create({ name, email: normalizedEmail, passwordHash, role: "user", tokenVersion: 1 });
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

    if (env.firebase.webApiKey) {
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.firebase.webApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
          returnSecureToken: true
        })
      });

      if (!response.ok) throw new AppError("Invalid email or password.", 401, "INVALID_CREDENTIALS");
      const payload = await response.json();
      const storedUser = await this.users.findById(payload.localId);
      const user = applyAdminEntitlements({
        uid: payload.localId,
        name: storedUser?.name || "",
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
        idToken: payload.idToken,
        firebaseRefreshToken: payload.refreshToken,
        accessToken: signAccessToken(user),
        refreshToken: signRefreshToken(user)
      };
    }

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
      accessToken: signAccessToken(entitledUser),
      refreshToken: signRefreshToken({ uid: user.uid || user.id, email: normalizedEmail, role: user.role || "user", tokenVersion: user.tokenVersion || 1 })
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
