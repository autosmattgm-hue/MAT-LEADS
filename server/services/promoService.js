import { randomUUID } from "node:crypto";
import { FirestoreRepository } from "../repositories/firestoreRepository.js";
import { AppError } from "../utils/errors.js";

const PROMOS = Object.freeze({
  FREEUSERS2026: Object.freeze({
    code: "freeusers2026",
    mode: "unlimited",
    title: "Free Users 2026",
    description: "Unlimited feature access. This never grants admin access."
  }),
  GETFREECREDIT2026: Object.freeze({
    code: "getfreecredit2026",
    mode: "credits",
    credits: 25,
    cooldownHours: 72,
    title: "Free Credits 2026",
    description: "25 credits for lead search, AI, and Website Studio actions."
  })
});

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

export class PromoService {
  constructor() {
    this.users = new FirestoreRepository("users");
    this.redemptions = new FirestoreRepository("promoRedemptions");
  }

  catalog() {
    return Object.values(PROMOS).map(({ code, mode, credits, cooldownHours, title, description }) => ({ code, mode, credits: credits || null, cooldownHours: cooldownHours || null, title, description }));
  }

  async redeem(user, rawCode) {
    const uid = String(user?.uid || "").trim();
    if (!uid) throw new AppError("Authentication required.", 401, "AUTH_REQUIRED");
    const promo = PROMOS[normalizeCode(rawCode)];
    if (!promo) throw new AppError("That promo code is not valid. Check it and try again.", 422, "INVALID_PROMO_CODE");
    const existing = await this.users.findById(uid);
    const currentCode = String(existing?.promoCode || existing?.entitlements?.promoCode || "").toLowerCase();
    const currentMode = String(existing?.promoMode || existing?.entitlements?.promoMode || "").toLowerCase();
    if (promo.mode === "unlimited" && currentCode === promo.code) {
      throw new AppError("This unlimited promo code has already been applied to this account.", 409, "PROMO_ALREADY_REDEEMED");
    }
    if (promo.mode === "credits" && currentMode === "unlimited") {
      throw new AppError("This account already has unlimited promo access.", 409, "PROMO_ALREADY_REDEEMED");
    }
    if (promo.mode === "credits") {
      const lastRedeemedAt = existing?.promoCreditLastRedeemedAt || existing?.entitlements?.promoCreditLastRedeemedAt || "";
      const lastRedeemedMs = Date.parse(lastRedeemedAt);
      const cooldownMs = Number(promo.cooldownHours || 72) * 60 * 60 * 1000;
      const nextEligibleAt = Number.isFinite(lastRedeemedMs) ? lastRedeemedMs + cooldownMs : 0;
      if (nextEligibleAt > Date.now()) {
        throw new AppError("This credit promo can be used once every 72 hours. Please try again after the cooldown ends.", 429, "PROMO_COOLDOWN", { nextEligibleAt: new Date(nextEligibleAt).toISOString() });
      }
    } else if (currentCode) {
      throw new AppError("A promo code has already been applied to this account.", 409, "PROMO_ALREADY_REDEEMED");
    }

    const now = new Date().toISOString();
    const credits = Number(promo.credits || 0);
    const carriedCredits = promo.mode === "credits" && currentMode === "credits"
      ? Math.max(0, Number(existing?.promoCreditsRemaining ?? existing?.entitlements?.promoCreditsRemaining ?? 0))
      : 0;
    const totalCredits = promo.mode === "credits" ? carriedCredits + credits : 0;
    const entitlements = {
      ...(existing?.entitlements || {}),
      promoCode: promo.code,
      promoMode: promo.mode,
      promoRedeemedAt: now,
      promoCredits: totalCredits,
      promoCreditsUsed: 0,
      promoCreditsRemaining: totalCredits,
      ...(promo.mode === "credits" ? { promoCreditLastRedeemedAt: now } : {}),
      unlimitedAccess: promo.mode === "unlimited",
      unlimitedLeads: promo.mode === "unlimited",
      allFeatures: true,
      billingRequired: false,
      trial: false,
      upgradeRequiredAfterTrial: false
    };
    const updated = await this.users.upsert(uid, {
      ...(existing || {}),
      id: existing?.id || uid,
      uid: existing?.uid || uid,
      promoCode: promo.code,
      promoMode: promo.mode,
      promoRedeemedAt: now,
      promoCredits: totalCredits,
      promoCreditsUsed: 0,
      promoCreditsRemaining: totalCredits,
      ...(promo.mode === "credits" ? { promoCreditLastRedeemedAt: now } : {}),
      entitlements
    });
    await this.redemptions.create({ id: `${uid}:${promo.code}:${randomUUID()}`, uid, code: promo.code, mode: promo.mode, credits, creditsRemaining: totalCredits, redeemedAt: now });
    return { code: promo.code, mode: promo.mode, credits, creditsRemaining: totalCredits, cooldownHours: promo.cooldownHours || null, title: promo.title, user: updated };
  }
}

export { normalizeCode };
