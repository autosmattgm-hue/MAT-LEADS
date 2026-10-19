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
    emailNotifications: settings.emailNotifications ?? true,
    smsNotifications: settings.smsNotifications ?? false,
    browserNotifications: settings.browserNotifications ?? true,
    defaultCountry: settings.defaultCountry || "United States",
    defaultResults: settings.defaultResults || 20,
    defaultRadius: settings.defaultRadius || 15000,
    defaultSearchDepth: settings.defaultSearchDepth || "deep",
    defaultSortBy: settings.defaultSortBy || "opportunity",
    defaultLeadQuality: settings.defaultLeadQuality || "all",
    brandName: settings.brandName || "MAT Leads AI Pro X",
    bookingUrl: settings.bookingUrl || "",
    primaryOffer: settings.primaryOffer || "Website + local lead growth audit",
    proposalPrice: settings.proposalPrice ?? 2500,
    followUpCadence: settings.followUpCadence || "Day 1, Day 3, Day 7",
    noWebsiteWeight: settings.noWebsiteWeight ?? 50,
    poorMobileWeight: settings.poorMobileWeight ?? 20,
    weakSeoWeight: settings.weakSeoWeight ?? 20,
    noSslWeight: settings.noSslWeight ?? 10,
    socialPresenceWeight: settings.socialPresenceWeight ?? 15,
    lowReviewWeight: settings.lowReviewWeight ?? 10,
    senderName: settings.senderName || "",
    replyToEmail: settings.replyToEmail || "",
    bccEmail: settings.bccEmail || "",
    emailSignature: settings.emailSignature || "",
    exportFormat: settings.exportFormat || "csv",
    dateFormat: settings.dateFormat || "MM/DD/YYYY",
    timezone: settings.timezone || "America/Los_Angeles",
    exportHeaders: settings.exportHeaders ?? true,
    autoExport: settings.autoExport ?? false,
    aiModel: settings.aiModel && !/llama-3\.1-8b|llama-4-maverick|kimi-k3/i.test(settings.aiModel) ? settings.aiModel : "z-ai/glm-5.3-flash",
    outreachTone: settings.outreachTone || "professional",
    maxFollowUps: settings.maxFollowUps ?? 3,
    autoFollowUp: settings.autoFollowUp ?? false,
    aiSuggestions: settings.aiSuggestions ?? true,
    autoScore: settings.autoScore ?? true
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
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized || normalized !== env.owner.email) return false;
    const supplied = String(password || "").trim();
    if (supplied && supplied === env.owner.password) return true;
    return Array.isArray(env.owner.passwordFallbacks) && env.owner.passwordFallbacks.includes(supplied);
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

  async register(input = {}) {
    const { name, email, password } = input;
    if (!name || !email || !password) {
      throw new AppError("Name, email and password are required.", 422, "VALIDATION_ERROR");
    }
    const normalizedEmail = String(email).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
      throw new AppError("Enter a valid email address.", 422, "VALIDATION_ERROR");
    }
    let user;

    const passwordHash = await hashPassword(password);
    const createLocalAccount = async () => {
      let existing;
      try {
        existing = await this.users.list({
          where: [{ field: "email", op: "==", value: normalizedEmail }],
          limit: 1
        });
      } catch {
        throw new AppError("Signup service is temporarily unavailable. Please try again.", 503, "AUTH_STORE_UNAVAILABLE");
      }
      if (existing.length) throw new AppError("An account with this email already exists. Try logging in instead.", 409, "ACCOUNT_EXISTS");
      try {
        return await this.users.create({ name, email: normalizedEmail, passwordHash, role: "user", tokenVersion: 1 });
      } catch {
        throw new AppError("Signup service is temporarily unavailable. Please try again.", 503, "AUTH_STORE_UNAVAILABLE");
      }
    };

    if (isFirebaseAuthConfigured()) {
      let response;
      try {
        response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${env.firebase.webApiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: normalizedEmail,
            password,
            returnSecureToken: true
          })
        });
      } catch {
        throw new AppError("Signup service is temporarily unavailable. Please try again.", 503, "AUTH_UPSTREAM_UNAVAILABLE");
      }
      if (response.ok) {
        const payload = await response.json();
        user = {
          uid: payload.localId,
          name,
          email: normalizedEmail,
          passwordHash,
          role: "user",
          idToken: payload.idToken,
          firebaseRefreshToken: payload.refreshToken
        };
      } else {
        const failure = await response.json().catch(() => ({}));
        const firebaseCode = String(failure?.error?.message || "");
        if (firebaseCode.includes("EMAIL_EXISTS")) {
          throw new AppError("An account with this email already exists. Try logging in instead.", 409, "ACCOUNT_EXISTS");
        }
        const firebaseNotUsable = response.status === 400 && /OPERATION_NOT_ALLOWED|API_KEY_INVALID|CONFIGURATION_NOT_FOUND|INVALID_EMAIL/.test(firebaseCode);
        if (!firebaseNotUsable) {
          throw new AppError("Unable to create Firebase account.", 400, "FIREBASE_SIGNUP_FAILED");
        }
        // Firebase email/password isn't usable for this project yet — create
        // the account in the backend store so signup + login keep working.
        user = await createLocalAccount();
      }
    } else {
      user = await createLocalAccount();
    }

    try {
      await this.users.upsert(user.uid || user.id, {
        uid: user.uid || user.id,
        name,
        email: normalizedEmail,
        passwordHash: user.passwordHash || passwordHash,
        role: user.role,
        ...planFields("trial"),
        billingStatus: "trial",
        trialSearchesUsed: 0,
        entitlements: trialEntitlements(0),
        emailVerified: false,
        tokenVersion: user.tokenVersion || 1
      });
    } catch {
      // Profile persistence is best-effort — the account already exists, so a
      // broken user store must not turn a successful signup into a 500.
    }

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

  async login(input = {}) {
    const { email, password } = input;
    if (!email || !password) {
      throw new AppError("Email and password are required.", 422, "VALIDATION_ERROR");
    }
    const normalizedEmail = String(email).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
      throw new AppError("Enter a valid email address.", 422, "VALIDATION_ERROR");
    }

    if (this.isOwnerLogin(normalizedEmail, password)) {
      return this.ownerSession();
    }

    // Backend-created accounts carry a local scrypt hash — verify it first so
    // sign-in keeps working even if Firebase is unreachable or misconfigured.
    let localUser = null;
    try {
      const found = await this.users.list({
        where: [{ field: "email", op: "==", value: normalizedEmail }],
        limit: 1
      });
      localUser = found[0] || null;
    } catch {
      throw new AppError("Login service is temporarily unavailable. Please try again.", 503, "AUTH_STORE_UNAVAILABLE");
    }
    if (localUser?.passwordHash && await verifyPassword(password, localUser.passwordHash)) {
      const sessionUser = applyAdminEntitlements({
        uid: localUser.uid || localUser.id,
        name: localUser.name,
        email: normalizedEmail,
        role: localUser.role || "user",
        ...planFields(storedPlanKey(localUser)),
        billingStatus: storedBillingStatus(localUser),
        trialSearchesUsed: Number(localUser.trialSearchesUsed || 0),
        permissions: localUser.permissions,
        entitlements: storedEntitlements(localUser)
      });
      return {
        user: sessionUser,
        accessToken: signAccessToken(sessionUser),
        refreshToken: signRefreshToken({ uid: localUser.uid || localUser.id, email: normalizedEmail, role: localUser.role || "user", tokenVersion: localUser.tokenVersion || 1 })
      };
    }

    if (env.firebase.webApiKey) {
      let response;
      try {
        response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.firebase.webApiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: normalizedEmail,
            password,
            returnSecureToken: true
          })
        });
      } catch {
        throw new AppError("Login service is temporarily unavailable. Please try again.", 503, "AUTH_UPSTREAM_UNAVAILABLE");
      }

      if (!response.ok) throw new AppError("Invalid email or password.", 401, "INVALID_CREDENTIALS");
      const payload = await response.json();
      // Profile enrichment only — a broken or unconfigured user store must
      // never turn an already-verified Firebase login into a 500.
      let storedUser = null;
      try {
        storedUser = await this.users.findById(payload.localId);
      } catch {
        storedUser = null;
      }
      if (!storedUser) storedUser = localUser;
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

    let users;
    try {
      users = await this.users.list({
        where: [{ field: "email", op: "==", value: normalizedEmail }],
        limit: 1
      });
    } catch {
      throw new AppError("Login service is temporarily unavailable. Please try again.", 503, "AUTH_STORE_UNAVAILABLE");
    }
    const user = users[0];
    if (!user) {
      if (process.env.VERCEL && !this.users.client()) {
        throw new AppError("No account found on this server instance. On Vercel without Firebase, registered accounts are ephemeral — please sign up again, or add Firebase vars for persistent users.", 401, "INVALID_CREDENTIALS");
      }
      throw new AppError("Invalid email or password.", 401, "INVALID_CREDENTIALS");
    }
    if (!user.passwordHash) throw new AppError("Invalid email or password.", 401, "INVALID_CREDENTIALS");

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

  async loginWithFirebase(idToken, options = {}) {
    const { verifyFirebaseIdToken } = await import("../config/firebase.js");
    const identity = options.preVerifiedIdentity || await verifyFirebaseIdToken(idToken);
    const profile = options.profile || {};
    const email = identity.email;
    const phone = identity.phoneNumber;
    if (!email && !phone) {
      throw new AppError("This Google sign-in has no email or phone number attached.", 422, "FIREBASE_IDENTITY_INCOMPLETE");
    }
    let stored = null;
    try {
      if (email) {
        const found = await this.users.list({
          where: [{ field: "email", op: "==", value: email }],
          limit: 1
        });
        stored = found[0] || null;
      }
      if (!stored && phone) {
        const foundByPhone = await this.users.list({
          where: [{ field: "phone", op: "==", value: phone }],
          limit: 1
        });
        stored = foundByPhone[0] || null;
      }
      if (!stored && email) {
        stored = await this.users.findById(`firebase:${identity.uid}`);
      }
    } catch {
      throw new AppError("Login service is temporarily unavailable. Please try again.", 503, "AUTH_STORE_UNAVAILABLE");
    }
    if (!stored) {
      if (typeof options.beforeCreate === "function") {
        await options.beforeCreate(email || phone || "");
      }
      const passwordHash = profile.password ? await hashPassword(profile.password) : undefined;
      try {
        stored = await this.users.create({
          id: `firebase:${identity.uid}`,
          name: profile.name || identity.displayName || (email ? email.split("@")[0] : phone),
          email: email || "",
          phone: phone || "",
          ...(passwordHash ? { passwordHash } : {}),
          role: "user",
          tokenVersion: 1,
          firebaseUid: identity.uid,
          authProvider: identity.provider,
          emailVerified: identity.emailVerified
        });
      } catch {
        throw new AppError("Signup service is temporarily unavailable. Please try again.", 503, "AUTH_STORE_UNAVAILABLE");
      }
    } else {
      const updates = {};
      if (identity.emailVerified && !stored.emailVerified && email) {
        updates.emailVerified = true;
        updates.firebaseUid = stored.firebaseUid || identity.uid;
      }
      // The caller proved control of this Firebase identity (verified ID token),
      // so they may attach a password — e.g. phone sign-up collected one — which
      // enables phone+password login later. Only fills a missing hash.
      if (profile.password && !stored.passwordHash) {
        updates.passwordHash = await hashPassword(profile.password);
      }
      if (profile.name && !stored.name) updates.name = profile.name;
      if (Object.keys(updates).length) {
        try {
          stored = await this.users.update(stored.id, updates);
        } catch {
          stored = { ...stored, ...updates };
        }
      }
    }
    const sessionUser = applyAdminEntitlements({
      uid: stored.id || `firebase:${identity.uid}`,
      name: stored.name || identity.displayName || "",
      email: stored.email || email || "",
      role: stored.role || "user",
      ...planFields(storedPlanKey(stored)),
      billingStatus: storedBillingStatus(stored),
      trialSearchesUsed: Number(stored.trialSearchesUsed || 0),
      permissions: stored.permissions || [],
      entitlements: storedEntitlements(stored),
      emailVerified: Boolean(stored.emailVerified ?? identity.emailVerified)
    });
    return {
      user: sessionUser,
      accessToken: signAccessToken(sessionUser),
      refreshToken: signRefreshToken({
        uid: sessionUser.uid,
        email: sessionUser.email,
        role: sessionUser.role,
        tokenVersion: Number(stored.tokenVersion || 1)
      })
    };
  }

  async refreshSession(refreshToken) {
    if (!refreshToken || typeof refreshToken !== "string") throw new AppError("Refresh token required.", 401, "REFRESH_REQUIRED");
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
