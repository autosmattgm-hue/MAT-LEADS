import { FirestoreRepository } from "../repositories/firestoreRepository.js";
import { env } from "../config/env.js";
import { getPlan } from "../config/plans.js";
import { GooglePlacesService } from "./googlePlacesService.js";
import { WebsiteAuditService } from "./websiteAuditService.js";
import { AppError } from "../utils/errors.js";
import { isAdminUser } from "../utils/entitlements.js";
import { enhanceSearchResult } from "./smartsearch.js";

const searchCache = new Map();
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SEARCH_CACHE_ENTRIES = 80;
const INTERACTIVE_PROVIDER_TIMEOUT_MS = 38000;
const MAX_INLINE_AUDITS = 24;
const INLINE_AUDIT_CONCURRENCY = 4;

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new AppError(message, 503, "LEAD_SEARCH_TIMEOUT")), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => {
    if (value === undefined || value === null || value === "") return false;
    if (Array.isArray(value) && value.length === 0) return false;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return false;
    return true;
  }));
}

function enrichLeadFromAudit(lead, audit) {
  const profile = audit?.publicProfile || {};
  const phone = lead.phone || profile.phones?.[0] || "";
  const email = lead.email || profile.emails?.[0] || "";
  return {
    ...lead,
    phone,
    email,
    details: {
      ...(lead.details || {}),
      contact: compactObject({ ...(lead.details?.contact || {}), phone, email }),
      social: compactObject({ ...(lead.details?.social || {}), ...(profile.socialLinks || {}) }),
      publicWebsiteProfile: profile.finalUrl ? profile : lead.details?.publicWebsiteProfile
    }
  };
}

function hasPublicContact(lead) {
  return Boolean(
    lead.phone || lead.email || lead.details?.contact?.phone || lead.details?.contact?.mobile
    || lead.audit?.publicProfile?.phones?.length || lead.audit?.publicProfile?.emails?.length
    || Object.keys(lead.details?.social || {}).length || Object.keys(lead.audit?.publicProfile?.socialLinks || {}).length
  );
}

function meetsSearchQuality(lead, search = {}) {
  const score = Number(lead.opportunityScore || lead.audit?.score || 0);
  const quality = search.leadQuality || "all";
  const requiresContact = search.requireContact || quality === "contact_ready" || quality === "owner_data";
  if (requiresContact && !hasPublicContact(lead)) return false;
  if (search.missingWebsiteOnly && lead.websiteUrl) return false;
  if (quality === "needs_website" && lead.websiteUrl) return false;
  if (quality === "high_opportunity" && score < Math.max(55, Number(search.minOpportunityScore || 0))) return false;
  if (score < Number(search.minOpportunityScore || 0)) return false;
  return true;
}

export class LeadService {
  constructor() {
    this.googlePlaces = new GooglePlacesService();
    this.websiteAudit = new WebsiteAuditService();
    this.leads = new FirestoreRepository("leads");
    this.users = new FirestoreRepository("users");
    this.auditLogs = new FirestoreRepository("auditLogs");
  }

  async currentAccessUser(user) {
    if (!user?.uid || isAdminUser(user)) return user;
    // Firebase password, popup, and legacy sessions can hold different
    // provider IDs for one verified email. Resolve the durable account before
    // enforcing a metered trial, so usage cannot split across login paths.
    let stored = await this.users.findById(user.uid);
    if (!stored && user.email) {
      const matches = await this.users.list({
        where: [{ field: "email", op: "==", value: String(user.email).trim().toLowerCase() }],
        limit: 1
      });
      stored = matches[0] || null;
    }
    if (!stored) return user;
    return {
      ...user,
      ...stored,
      uid: stored.uid || stored.id || user.uid,
      email: stored.email || user.email
    };
  }

  async assertTrialAccess(user) {
    if (isAdminUser(user) || user?.entitlements?.unlimitedAccess || user?.permissions?.includes?.("unlimited")) return null;
    const planKey = String(user?.subscription || user?.entitlements?.activePlan || "trial").toLowerCase();
    if (planKey !== "trial") return null;

    const plan = getPlan("trial");
    const searchLimit = Number(user?.trialSearchLimit || user?.entitlements?.trialSearchLimit || plan.trialSearchLimit);
    const leadLimit = Number(user?.trialLeadLimit || user?.entitlements?.trialLeadLimit || plan.trialLeadLimit);
    const used = Number(user?.trialSearchesUsed || user?.entitlements?.trialSearchesUsed || 0);
    if (used >= searchLimit) {
      throw new AppError("Your free trial searches are used. Upgrade to continue finding new leads.", 402, "TRIAL_SEARCH_LIMIT_REACHED");
    }
    return { used, searchLimit, leadLimit, remaining: Math.max(0, searchLimit - used) };
  }

  async recordTrialSearch(user, usage) {
    if (!usage || !user?.uid) return null;
    const used = usage.used + 1;
    await this.users.upsert(user.uid, {
      trialSearchesUsed: used,
      entitlements: {
        ...(user.entitlements || {}),
        billingRequired: true,
        trial: true,
        trialSearchesUsed: used,
        trialSearchLimit: usage.searchLimit,
        trialLeadLimit: usage.leadLimit,
        upgradeRequiredAfterTrial: true
      }
    });
    return { ...usage, used, remaining: Math.max(0, usage.searchLimit - used) };
  }

  async search(search, user) {
    const accessUser = await this.currentAccessUser(user);
    const startingTrialUsage = await this.assertTrialAccess(accessUser);
    const admin = isAdminUser(accessUser) || accessUser?.entitlements?.unlimitedAccess || accessUser?.permissions?.includes?.("unlimited");
    const effectiveSearch = search;
    const bypassCache = Boolean(effectiveSearch?.bypassCache || effectiveSearch?.refreshSeed);
    const providerSearch = {
      ...effectiveSearch,
      // Fetch enough candidates for ranking without delaying the first page by
      // crawling hundreds of businesses.
      limit: Math.min(200, Math.max(
        effectiveSearch?.limit || 20,
        Math.min((effectiveSearch?.limit || 20) * ((effectiveSearch?.requireContact || effectiveSearch?.missingWebsiteOnly) ? 6 : 2), 200)
      )),
      interactive: true
    };
    const requestedLimit = effectiveSearch?.limit || 50;
    const resultLimit = Math.min(requestedLimit, startingTrialUsage?.leadLimit || requestedLimit);
    const cacheKey = JSON.stringify(providerSearch) + "-" + (admin ? "admin" : "user");
    const cached = bypassCache ? null : searchCache.get(cacheKey);
    if (cached) {
      const updatedTrialUsage = await this.recordTrialSearch(accessUser, startingTrialUsage);
      await this.auditLogs.create({
        actor: accessUser?.email || "guest",
        action: "lead_search_cached",
        query: effectiveSearch,
        count: cached.leads?.length || 0
      });
      return {
        ...cached,
        leads: cached.leads,
        trial: updatedTrialUsage ? {
          ...updatedTrialUsage,
          limited: updatedTrialUsage.remaining <= 0,
          upgradeUrl: "/pricing.html"
        } : cached.trial
      };
    }

    let result = { leads: [] };
    try {
      result = await withTimeout(
        this.googlePlaces.search(providerSearch),
        INTERACTIVE_PROVIDER_TIMEOUT_MS,
        "Lead data providers are taking too long. Please retry in a moment."
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("Lead search could not reach a map data provider. Please retry.", 503, "LEAD_PROVIDER_UNAVAILABLE");
    }
    let audited = [];
    try {
      const targetedDataSearch = Boolean(effectiveSearch?.requireContact || effectiveSearch?.missingWebsiteOnly || effectiveSearch?.leadQuality === "contact_ready");
      const largeResultRequest = resultLimit > 50;
      const auditCandidateCount = Math.min(
        result.leads.length,
        // Large result requests prioritize fast discovery. Their records still
        // retain map contact fields and receive a complete audit when opened.
        largeResultRequest ? 0 : targetedDataSearch ? MAX_INLINE_AUDITS : Math.max(10, Math.min(resultLimit * 2, MAX_INLINE_AUDITS))
      );
      const auditCandidates = result.leads.slice(0, auditCandidateCount);
      const auditedCandidates = await mapWithConcurrency(auditCandidates, INLINE_AUDIT_CONCURRENCY, async (lead) => {
        try {
          const audit = lead.audit?.publicProfile
            ? lead.audit
            : await this.websiteAudit.audit(lead, {
              timeoutMs: 3500,
              discoverProfiles: !largeResultRequest && auditCandidates.indexOf(lead) < 5,
              profilePageLimit: 2,
              profilePageTimeoutMs: 2200
            });
          return { ...enrichLeadFromAudit(lead, audit), audit, opportunityScore: audit.score, opportunityCategory: audit.category };
        } catch (error) {
          return { ...lead, audit: { score: 0, category: "Audit Pending", checks: {} }, opportunityScore: 0, opportunityCategory: "Audit Pending" };
        }
      });
      audited = [
        ...auditedCandidates,
        ...result.leads.slice(auditCandidateCount).map((lead) => ({
          ...lead,
          audit: { score: lead.opportunityScore || 0, category: "Audit Pending", checks: {} },
          opportunityScore: lead.opportunityScore || 0,
          opportunityCategory: "Audit Pending"
        }))
      ];
    } catch {
      audited = (result.leads || []).map((lead) => ({
        ...lead,
        audit: { score: 0, category: "Audit Pending", checks: {} },
        opportunityScore: 0,
        opportunityCategory: "Audit Pending"
      }));
    }

    let filteredPool = audited.filter((lead) => meetsSearchQuality(lead, effectiveSearch));
    if (effectiveSearch && effectiveSearch.filters) {
      filteredPool = filteredPool.filter(lead => {
        let passes = true;
        for (const filter of effectiveSearch.filters) {
          const { field, op, value } = filter;
          if (op === "==") {
            if (String(lead[field] || "") !== String(value)) passes = false;
          } else if (op === "contains") {
            if (!String(lead[field] || "").toLowerCase().includes(String(value).toLowerCase())) passes = false;
          } else if (op === ">=") {
            if (Number(lead[field] || 0) < Number(value)) passes = false;
          } else if (op === "<=") {
            if (Number(lead[field] || 999999) > Number(value)) passes = false;
          } else if (op === "in") {
            if (!value.includes(String(lead[field] || ""))) passes = false;
          }
        }
        return passes;
      });
    }

    // Explicit data-quality requirements must never be silently relaxed: a
    // "contact details only" search should not return contactless businesses.
    const hasStrictQualityFilter = Boolean(effectiveSearch?.requireContact || effectiveSearch?.missingWebsiteOnly || effectiveSearch?.leadQuality !== "all" || Number(effectiveSearch?.minOpportunityScore || 0) > 0);
    const filtersRelaxed = !hasStrictQualityFilter && filteredPool.length === 0 && audited.length > 0;
    const qualifiedPool = await this.fallbackLeadOrder(
      filtersRelaxed ? await this.fallbackLeadPool(audited) : filteredPool,
      effectiveSearch?.refreshSeed || "",
      effectiveSearch?.sortBy
    );

    const qualified = qualifiedPool.slice(0, resultLimit);

    await Promise.all(qualified.map((lead) => this.leads.upsert(lead.id, {
      ...lead,
      source: lead.source || "enhanced_search",
      discoveredBy: accessUser?.uid,
      discoveredAt: new Date().toISOString()
    })));

    const updatedTrialUsage = await this.recordTrialSearch(accessUser, startingTrialUsage);

    await this.auditLogs.create({
      actor: accessUser?.email || "guest",
      action: "lead_search",
      query: effectiveSearch,
      count: qualified.length
    });

    const response = {
      ...result,
      leads: qualified,
      cached: false,
      refreshed: bypassCache,
      refreshSeed: effectiveSearch?.refreshSeed || "",
      adminUnlimited: admin,
      searchStats: {
        requestedLimit: effectiveSearch?.limit || 50,
        returnedLimit: qualified.length,
        providerCandidateLimit: providerSearch.limit,
        rawCount: result.leads?.length || 0,
        auditedCount: audited.length,
        qualifiedCount: qualified.length,
        qualifiedPoolCount: qualifiedPool.length,
        strictContactFilter: Boolean(effectiveSearch?.requireContact || effectiveSearch?.leadQuality === "contact_ready" || effectiveSearch?.leadQuality === "owner_data"),
        strictMissingWebsiteFilter: Boolean(effectiveSearch?.missingWebsiteOnly || effectiveSearch?.leadQuality === "needs_website"),
        contactCoverageLimited: Boolean(
          (effectiveSearch?.requireContact || effectiveSearch?.leadQuality === "contact_ready" || effectiveSearch?.leadQuality === "owner_data")
          && /^openstreetmap_(photon|nominatim)$/.test(String(result.source || ""))
        ),
        filtersRelaxed,
        bypassCache,
        searchDepth: effectiveSearch?.searchDepth,
        leadQuality: "enhanced",
        sortBy: effectiveSearch?.sortBy
      },
      trial: updatedTrialUsage ? {
        ...updatedTrialUsage,
        limited: updatedTrialUsage.remaining <= 0,
        upgradeUrl: "/pricing.html"
      } : undefined
    };

    if (!bypassCache) searchCache.set(cacheKey, response);
    return response;
  }

  async fallbackLeadPool(audited) {
    return audited.slice(0, 100);
  }

  async fallbackLeadOrder(leads, refreshSeed, sortBy = "opportunity") {
    const ordered = freshLeadOrder(leads, refreshSeed);
    if (sortBy === "contact") {
      return ordered.sort((a, b) => Number(hasPublicContact(b)) - Number(hasPublicContact(a)) || Number(b.opportunityScore || 0) - Number(a.opportunityScore || 0));
    }
    if (sortBy === "website_missing") {
      return ordered.sort((a, b) => Number(!b.websiteUrl) - Number(!a.websiteUrl) || Number(b.opportunityScore || 0) - Number(a.opportunityScore || 0));
    }
    if (sortBy === "name") return ordered.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    return ordered;
  }

  async save(leadId, user, fallbackLead = null) {
    let existing = null;
    try { existing = await this.getById(leadId); } catch { existing = null; }
    const lead = existing || fallbackLead;
    if (!lead) return null;
    return this.leads.upsert(lead.id, {
      ...lead,
      ownerId: user?.uid,
      stage: lead.stage || "New",
      savedAt: new Date().toISOString()
    });
  }

  async getById(id) {
    return await this.leads.findById(id) || null;
  }

  async getReport(id) {
    const lead = await this.getById(id);
    if (!lead) return null;
    const audit = lead.audit?.publicProfile ? lead.audit : await this.websiteAudit.audit(lead);
    const publicEnrichedLead = { ...lead };
    const enrichedLead = { ...publicEnrichedLead, audit, opportunityScore: audit.score, opportunityCategory: audit.category };
    return {
      lead: enrichedLead,
      dossier: { needs: [], bestOffer: "Contact info and website presence detected" },
      aiSummary: "Enhanced lead extraction ready"
    };
  }
}

function freshLeadOrder(leads, refreshSeed) {
  return leads.sort((a, b) => {
    const scoreA = Number(a.opportunityScore || 0) || 0;
    const scoreB = Number(b.opportunityScore || 0) || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}
