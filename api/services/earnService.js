import { randomUUID } from "node:crypto";
import { clientOfferCatalog, referralCommissionForPlan } from "../config/plans.js";
import { FirestoreRepository } from "../repositories/firestoreRepository.js";
import { AppError } from "../utils/errors.js";

const memReferrals = new Map();
const memInvoices = new Map();
const memPayouts = [];

function codeFor(emailOrUid) {
  return String(emailOrUid || "ref").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 10).padEnd(4, "x");
}

export class EarnService {
  constructor() {
    this.users = new FirestoreRepository("users");
    this.referrals = new FirestoreRepository("referrals");
    this.invoices = new FirestoreRepository("invoices");
    this.payouts = new FirestoreRepository("payouts");
  }
  referralCodeFor(user) {
    const base = codeFor(user?.uid || user?.email);
    return `MAT-${base.toUpperCase()}-30`;
  }
  offers() {
    return clientOfferCatalog;
  }
  async myReferral(user) {
    const code = this.referralCodeFor(user);
    let rows = [];
    try {
      rows = await this.referrals.list({ limit: 200, where: [{ field: "referrerUid", op: "==", value: user.uid }] });
    } catch {
      rows = [...memReferrals.values()].filter((r) => r.referrerUid === user.uid);
    }
    const codeRows = [...memReferrals.values()].filter((r) => r.referrerCode === code);
    const all = [...rows, ...codeRows.filter((r) => !rows.find((x) => x.id === r.id))];
    const paidCents = all.filter((r) => r.status === "paid").reduce((s, r) => s + Number(r.commissionCents || 0), 0);
    const pendingCents = all.filter((r) => r.status !== "paid").reduce((s, r) => s + Number(r.commissionCents || 0), 0);
    return { code, linkPath: `/signup.html?ref=${encodeURIComponent(code)}`, rows: all, paidCents, pendingCents };
  }
  async trackSignup(referredUser, refCode) {
    if (!refCode || !referredUser?.uid) return null;
    const record = { id: randomUUID(), referrerUid: "", referrerCode: String(refCode).toUpperCase(), referredUid: referredUser.uid, referredEmail: referredUser.email || "", plan: "trial", amountCents: 0, commissionCents: 0, status: "signup", createdAt: new Date().toISOString() };
    try { await this.referrals.create(record); } catch {}
    memReferrals.set(record.id, record);
    return record;
  }
  async rewardForPaidUser(paidUser) {
    let rows = [];
    try {
      rows = await this.referrals.list({ limit: 50, where: [{ field: "referredUid", op: "==", value: paidUser.uid }] });
    } catch {
      rows = [...memReferrals.values()].filter((r) => r.referredUid === paidUser.uid);
    }
    const open = rows.find((r) => r.status === "signup");
    if (!open) return null;
    const planKey = paidUser.subscription || paidUser?.entitlements?.activePlan || "professional";
    const pct = referralCommissionForPlan(planKey);
    const planPrice = { starter: 29, professional: 99, growth_plus: 149, agency: 249 }[planKey] || 99;
    const updated = { ...open, plan: planKey, amountCents: Math.round(planPrice * 100), commissionCents: Math.round(planPrice * 100 * (pct / 100)), status: "pending", updatedAt: new Date().toISOString() };
    try { await this.referrals.upsert(open.id, updated); } catch {}
    memReferrals.set(open.id, updated);
    return updated;
  }
  async createInvoice(user, input = {}) {
    const offer = clientOfferCatalog.find((o) => o.key === input.offerKey);
    const amount = Number(input.amountUsd || offer?.priceUsd || 0);
    if (!amount || amount <= 0) { const e = new Error("Set a valid invoice amount."); e.status = 422; e.code = "INVALID_AMOUNT"; throw e; }
    const invoice = { id: randomUUID(), ownerUid: user.uid, ownerEmail: user.email || "", leadId: input.leadId || "", leadName: input.leadName || "", offerKey: offer?.key || "custom", offerName: offer?.name || "Custom client work", amountCents: Math.round(amount * 100), clientName: input.clientName || "", clientEmail: input.clientEmail || "", notes: String(input.notes || "").slice(0, 1000), status: "open", createdAt: new Date().toISOString() };
    invoice.payLink = `/pay.html?invoice=${encodeURIComponent(invoice.id)}`;
    try { await this.invoices.upsert(invoice.id, invoice); } catch {}
    memInvoices.set(invoice.id, invoice);
    return { invoice };
  }
  async myInvoices(user) {
    try {
      return await this.invoices.list({ limit: 100, where: [{ field: "ownerUid", op: "==", value: user.uid }] });
    } catch {
      return [...memInvoices.values()].filter((i) => i.ownerUid === user.uid);
    }
  }
  async getInvoice(id) {
    try {
      const found = await this.invoices.findById(id);
      if (found) return found;
    } catch {}
    return memInvoices.get(id) || null;
  }
  async markInvoicePaid(id, user, input = {}) {
    const inv = await this.getInvoice(id);
    if (!inv) { const e = new Error("Invoice not found."); e.status = 404; e.code = "INVOICE_NOT_FOUND"; throw e; }
    const updated = { ...inv, status: "paid", transactionId: input.transactionId || "", paidAt: new Date().toISOString() };
    try { await this.invoices.upsert(id, updated); } catch {}
    memInvoices.set(id, updated);
    return { invoice: updated };
  }
  async requestPayout(user, input = {}) {
    const amountCents = Math.round(Number(input.amountUsd || 0) * 100);
    if (!amountCents || amountCents < 1000) { const e = new Error("Minimum payout is $10."); e.status = 422; e.code = "PAYOUT_MINIMUM"; throw e; }
    const payout = { id: randomUUID(), ownerUid: user.uid, ownerEmail: user.email || "", amountCents, destination: String(input.destination || "").slice(0, 200), status: "requested", createdAt: new Date().toISOString() };
    try { await this.payouts.create(payout); } catch {}
    memPayouts.push(payout);
    return { payout };
  }
  async myPayouts(user) {
    try {
      return await this.payouts.list({ limit: 100, where: [{ field: "ownerUid", op: "==", value: user.uid }] });
    } catch {
      return memPayouts.filter((p) => p.ownerUid === user.uid);
    }
  }
}
