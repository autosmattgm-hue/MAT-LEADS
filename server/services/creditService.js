import { randomUUID } from "node:crypto";
import { FirestoreRepository } from "../repositories/firestoreRepository.js";
import { isAdminUser } from "../utils/entitlements.js";
import { AppError } from "../utils/errors.js";

export class CreditService {
  constructor() {
    this.users = new FirestoreRepository("users");
    this.usage = new FirestoreRepository("promoCreditUsage");
  }

  async source(user) {
    const stored = user?.uid ? await this.users.findById(user.uid) : null;
    return { ...(user || {}), ...(stored || {}) };
  }

  async status(user) {
    const source = await this.source(user);
    const mode = source.promoMode || source.entitlements?.promoMode || "";
    const total = Number(source.promoCredits ?? source.entitlements?.promoCredits ?? 0);
    const used = Number(source.promoCreditsUsed ?? source.entitlements?.promoCreditsUsed ?? 0);
    return { mode, total: mode === "credits" ? total : null, used: mode === "credits" ? used : 0, remaining: mode === "credits" ? Math.max(0, total - used) : null, unlimited: mode === "unlimited" || isAdminUser(source) };
  }

  async consume(user, feature, amount = 1) {
    const source = await this.source(user);
    const mode = source.promoMode || source.entitlements?.promoMode || "";
    if (isAdminUser(source) || mode === "unlimited") return { consumed: false, unlimited: true, remaining: null };
    if (mode !== "credits") return { consumed: false, unlimited: false, remaining: null };

    const total = Number(source.promoCredits ?? source.entitlements?.promoCredits ?? 0);
    const used = Number(source.promoCreditsUsed ?? source.entitlements?.promoCreditsUsed ?? 0);
    const requested = Math.max(1, Math.floor(Number(amount) || 1));
    const remaining = Math.max(0, total - used);
    if (remaining < requested) throw new AppError(`You have ${remaining} promo credit${remaining === 1 ? "" : "s"} left. Redeem another eligible code or upgrade to continue.`, 402, "PROMO_CREDITS_EXHAUSTED", { remaining, total, used });

    const nextUsed = used + requested;
    const entitlements = { ...(source.entitlements || {}), promoCredits: total, promoCreditsUsed: nextUsed, promoCreditsRemaining: total - nextUsed };
    await this.users.upsert(source.uid, { ...source, promoCredits: total, promoCreditsUsed: nextUsed, promoCreditsRemaining: total - nextUsed, entitlements });
    await this.usage.create({ id: randomUUID(), uid: source.uid, feature: String(feature || "feature").slice(0, 80), credits: requested, createdAt: new Date().toISOString() });
    return { consumed: true, unlimited: false, remaining: total - nextUsed, total, feature };
  }

  async refund(user, reservation) {
    if (!reservation?.consumed || !user?.uid) return;
    const source = await this.source(user);
    const total = Number(source.promoCredits ?? source.entitlements?.promoCredits ?? 0);
    const amount = Math.max(1, Number(reservation.total || 0) - Number(reservation.remaining || 0));
    const used = Math.max(0, Number(source.promoCreditsUsed ?? source.entitlements?.promoCreditsUsed ?? 0) - amount);
    const entitlements = { ...(source.entitlements || {}), promoCreditsUsed: used, promoCreditsRemaining: total - used };
    await this.users.upsert(source.uid, { ...source, promoCreditsUsed: used, promoCreditsRemaining: total - used, entitlements });
  }
}
