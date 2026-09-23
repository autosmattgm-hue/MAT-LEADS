import { FirestoreRepository } from "../repositories/firestoreRepository.js";
import { env } from "../config/env.js";
import { getPlan } from "../config/plans.js";
import { GooglePlacesService } from "./googlePlacesService.js";
import { WebsiteAuditService } from "./websiteAuditService.js";
import { AppError } from "../utils/errors.js";
import { isAdminUser } from "../utils/entitlements.js";

const searchCache = new Map();
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SEARCH_CACHE_ENTRIES = 80;

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => {
    if (value === undefined || value === null || value === "") return false;
    if (Array.isArray(value) && value.length === 0) return false;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return false;
    return true;
  }));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function cacheKeyForSearch(search, userOrAdmin) {
  const isAdmin = typeof userOrAdmin === "boolean"
    ? userOrAdmin
    : isAdminUser(userOrAdmin) || userOrAdmin?.entitlements?.unlimitedAccess || userOrAdmin?.permissions?.includes?.("unlimited");
  const accessTier = typeof userOrAdmin === "object" && isTrialUser(userOrAdmin) ? "trial" : "standard";
  return stableJson({ search, isAdmin, accessTier });
}

function getCachedSearch(cacheKey) {
  const cached = searchCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    searchCache.delete(cacheKey);
    return null;
  }
  return { ...cached.result, cached: true };
}

function setCachedSearch(cacheKey, result) {
  searchCache.set(cacheKey, {
    result,
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS
  });
  while (searchCache.size > MAX_SEARCH_CACHE_ENTRIES) {
    searchCache.delete(searchCache.keys().next().value);
  }
}

function hasContact(lead) {
  return Boolean(lead.phone || lead.email || lead.details?.contact?.mobile || lead.social || Object.keys(lead.details?.social || {}).length);
}

function hasOwnerData(lead) {
  const owner = lead.details?.ownerContact || {};
  return Boolean(owner.ownerName || owner.operator || owner.contactPerson);
}

function contactScore(lead) {
  return [
    lead.phone,
    lead.email,
    lead.details?.contact?.mobile,
    lead.websiteUrl,
    lead.social || Object.keys(lead.details?.social || {}).length
  ].filter(Boolean).length;
}

function isPaidUser(user = {}) {
  return Boolean(user.entitlements?.activePlan || user.planActivatedAt || user.paypalCheckoutSessionId);
}

function isTrialUser(user = {}) {
  if (isAdminUser(user) || user?.entitlements?.unlimitedAccess || user?.permissions?.includes?.("unlimited")) return false;
  if (isPaidUser(user)) return false;
  return !user.subscription || user.subscription === "trial" || user.billingStatus === "trial" || user.subscription === "starter";
}

function trialUsage(user = {}) {
  const trialPlan = getPlan("trial");
  const used = Math.max(0, Number(user.trialSearchesUsed || user.entitlements?.trialSearchesUsed || 0));
  return {
    used,
    remaining: Math.max(0, trialPlan.trialSearchLimit - used),
    searchLimit: trialPlan.trialSearchLimit,
    leadLimit: trialPlan.trialLeadLimit
  };
}

function normalizeSearchForUser(search, user) {
  const admin = isAdminUser(user) || user?.entitlements?.unlimitedAccess || user?.permissions?.includes?.("unlimited");
  const trial = isTrialUser(user);
  return {
    ...search,
    limit: Math.min(Math.max(Number(search.limit) || 20, 1), admin ? 200 : 50),
    searchDepth: admin ? search.searchDepth : (search.searchDepth === "maximum" || trial ? "deep" : search.searchDepth)
  };
}

function returnLimitForUser(search, user) {
  return isTrialUser(user) ? getPlan("trial").trialLeadLimit : search.limit;
}

function candidateLimitForSearch(search, admin) {
  const multiplier = {
    quick: 1.2,
    standard: 1.8,
    deep: 2.6,
    maximum: 4
  }[search.searchDepth] || 2.6;
  return Math.min(Math.ceil(search.limit * multiplier), admin ? 300 : 120);
}

function applyLeadFilters(leads, search) {
  const minScore = Number(search.minOpportunityScore || 0);
  const filtered = leads.filter((lead) => {
    const score = lead.opportunityScore ?? lead.audit?.score ?? 0;
    if (score < minScore) return false;
    if (search.requireContact && !hasContact(lead)) return false;
    if (search.missingWebsiteOnly && lead.websiteUrl) return false;
    if (search.leadQuality === "contact_ready" && !hasContact(lead)) return false;
    if (search.leadQuality === "needs_website" && lead.websiteUrl) return false;
    if (search.leadQuality === "high_opportunity" && score < 70) return false;
    if (search.leadQuality === "owner_data" && !hasOwnerData(lead)) return false;
    return true;
  });

  const sorters = {
    opportunity: (left, right) => (right.opportunityScore ?? right.audit?.score ?? 0) - (left.opportunityScore ?? left.audit?.score ?? 0),
    contact: (left, right) => contactScore(right) - contactScore(left),
    website_missing: (left, right) => Number(!right.websiteUrl) - Number(!left.websiteUrl),
    name: (left, right) => String(left.name || "").localeCompare(String(right.name || ""))
  };
  const sorter = sorters[search.sortBy] || sorters.opportunity;
  return filtered.sort((left, right) => sorter(left, right) || String(left.name || "").localeCompare(String(right.name || "")));
}

function fallbackLeadPool(leads) {
  return [...leads].sort((left, right) => (
    (right.opportunityScore ?? right.audit?.score ?? 0) - (left.opportunityScore ?? left.audit?.score ?? 0)
  ) || contactScore(right) - contactScore(left) || String(left.name || "").localeCompare(String(right.name || "")));
}

function freshLeadOrder(leads, refreshSeed) {
  if (!refreshSeed) return leads;
  return [...leads]
    .map((lead, index) => ({
      lead,
      rank: hashString(`${refreshSeed}:${lead.id || lead.name || "lead"}:${lead.address || ""}:${index}`)
    }))
    .sort((left, right) => left.rank - right.rank)
    .map(({ lead }) => lead);
}

function mergePublicWebsiteProfile(lead, audit) {
  const profile = audit?.publicProfile;
  if (!profile) return lead;

  const details = lead.details || {};
  const contact = compactObject({
    ...(details.contact || {}),
    phone: lead.phone || details.contact?.phone || profile.phones?.[0],
    email: lead.email || details.contact?.email || profile.emails?.[0],
    website: lead.websiteUrl || details.contact?.website || profile.finalUrl
  });
  const social = compactObject({
    ...(details.social || {}),
    ...(profile.socialLinks || {})
  });
  const business = compactObject({
    ...(details.business || {}),
    websiteTitle: profile.metadata?.title,
    websiteDescription: profile.metadata?.description
  });
  const source = compactObject({
    ...(details.source || {}),
    websiteScanUrl: profile.finalUrl,
    websiteScanSource: profile.source,
    websiteExtractedAt: new Date().toISOString()
  });

  return {
    ...lead,
    phone: lead.phone || contact.phone || "",
    email: lead.email || contact.email || "",
    websiteUrl: lead.websiteUrl || contact.website || "",
    social: lead.social || Object.values(social)[0] || "",
    details: {
      ...details,
      contact,
      social,
      business,
      source,
      publicWebsiteProfile: compactObject({
        finalUrl: profile.finalUrl,
        emails: profile.emails || [],
        phones: profile.phones || [],
        socialLinks: profile.socialLinks || {},
        metadata: profile.metadata || {},
        source: profile.source
      })
    }
  };
}

function valueOrNotFound(value) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Not found in public data";
  if (value === undefined || value === null || value === "") return "Not found in public data";
  if (typeof value === "object") return Object.keys(value).length ? JSON.stringify(value) : "Not found in public data";
  return String(value);
}

function searchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function hostnameFromWebsite(website) {
  if (!website) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    return url.hostname;
  } catch {
    return "";
  }
}

const countryCallingCodesByIso = {
  US: "1",
  CA: "1",
  GB: "44",
  IE: "353",
  DE: "49",
  FR: "33",
  ES: "34",
  IT: "39",
  PT: "351",
  NL: "31",
  BE: "32",
  CH: "41",
  AT: "43",
  PL: "48",
  CZ: "420",
  FI: "358",
  SE: "46",
  NO: "47",
  DK: "45",
  AU: "61",
  NZ: "64",
  SG: "65",
  HK: "852",
  TW: "886",
  JP: "81",
  KR: "82",
  IN: "91",
  MX: "52",
  BR: "55",
  AR: "54",
  CL: "56",
  CO: "57",
  PE: "51",
  PA: "507",
  CR: "506",
  ZA: "27",
  NG: "234",
  GH: "233",
  KE: "254",
  EG: "20",
  MA: "212",
  TR: "90",
  IL: "972",
  MY: "60",
  PH: "63",
  TH: "66",
  VN: "84",
  ID: "62",
  SN: "221",
  GM: "220",
  KW: "965",
  QA: "974",
  BH: "973",
  OM: "968",
  JO: "962",
  AE: "971",
  SA: "966"
};

const countryCallingCodesByName = {
  "united states": "1",
  canada: "1",
  "united kingdom": "44",
  ireland: "353",
  germany: "49",
  france: "33",
  spain: "34",
  italy: "39",
  portugal: "351",
  netherlands: "31",
  belgium: "32",
  switzerland: "41",
  austria: "43",
  poland: "48",
  "czech republic": "420",
  finland: "358",
  sweden: "46",
  norway: "47",
  denmark: "45",
  australia: "61",
  "new zealand": "64",
  singapore: "65",
  "hong kong": "852",
  taiwan: "886",
  japan: "81",
  "south korea": "82",
  india: "91",
  mexico: "52",
  brazil: "55",
  argentina: "54",
  chile: "56",
  colombia: "57",
  peru: "51",
  panama: "507",
  "costa rica": "506",
  "south africa": "27",
  nigeria: "234",
  ghana: "233",
  kenya: "254",
  egypt: "20",
  morocco: "212",
  turkey: "90",
  israel: "972",
  malaysia: "60",
  philippines: "63",
  thailand: "66",
  vietnam: "84",
  indonesia: "62",
  senegal: "221",
  "the gambia": "220",
  gambia: "220",
  kuwait: "965",
  qatar: "974",
  bahrain: "973",
  oman: "968",
  jordan: "962",
  "united arab emirates": "971",
  "saudi arabia": "966"
};

function normalizedName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function isWhatsappUrl(value) {
  const url = safeHttpUrl(value);
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "wa.me" || host === "whatsapp.com" || host.endsWith(".whatsapp.com");
  } catch {
    return false;
  }
}

function socialLinksForLead(lead = {}, audit = {}) {
  return {
    ...(lead.details?.social || {}),
    ...(lead.details?.publicWebsiteProfile?.socialLinks || {}),
    ...(audit?.publicProfile?.socialLinks || {})
  };
}

function countryCallingCodeForLead(lead = {}, location = {}) {
  const iso = String(
    lead.countryCode ||
    lead.details?.location?.countryCode ||
    location.countryCode ||
    ""
  ).toUpperCase();
  if (countryCallingCodesByIso[iso]) return countryCallingCodesByIso[iso];

  const names = [
    lead.country,
    lead.countryName,
    lead.details?.location?.country,
    lead.details?.location?.countryName,
    location.country,
    location.countryName
  ].map(normalizedName);

  return names.map((name) => countryCallingCodesByName[name]).find(Boolean) || "";
}

function normalizePhoneForWhatsapp(phone, lead = {}, location = {}) {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  const firstNumber = raw.split(/[\/|;]/)[0].replace(/\s*(?:ext\.?|extension|x)\s*\d+$/i, "").trim();
  let digits = firstNumber.replace(/\D/g, "");
  if (!digits) return "";

  if (firstNumber.startsWith("+")) {
    // Already includes an international prefix.
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else {
    const callingCode = countryCallingCodeForLead(lead, location);
    if (!callingCode) return "";
    const nationalNumber = digits.replace(/^0+/, "");
    digits = digits.startsWith(callingCode) && digits.length > callingCode.length + 5
      ? digits
      : `${callingCode}${nationalNumber}`;
  }

  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

function whatsappLinkFromPhone(phone, lead = {}, location = {}) {
  const normalized = normalizePhoneForWhatsapp(phone, lead, location);
  return normalized ? `https://wa.me/${normalized}` : "";
}

function whatsappContactForLead(lead = {}, contact = {}, location = {}, audit = {}) {
  const socialLinks = socialLinksForLead(lead, audit);
  const explicitWhatsapp = safeHttpUrl(socialLinks.whatsapp || contact.whatsapp || "");
  if (explicitWhatsapp && isWhatsappUrl(explicitWhatsapp)) {
    return {
      url: explicitWhatsapp,
      source: "public_whatsapp_link",
      note: "A public WhatsApp link was found in map or website data."
    };
  }

  const leadSocial = safeHttpUrl(lead.social || "");
  if (leadSocial && isWhatsappUrl(leadSocial)) {
    return {
      url: leadSocial,
      source: "public_whatsapp_link",
      note: "A public WhatsApp link was found in map or website data."
    };
  }

  const phone = [
    contact.mobile,
    contact.phone,
    lead.details?.contact?.mobile,
    lead.details?.contact?.phone,
    lead.phone,
    lead.details?.publicWebsiteProfile?.phones?.[0],
    audit?.publicProfile?.phones?.[0]
  ].find(Boolean);
  const phoneLink = whatsappLinkFromPhone(phone, lead, location);
  if (!phoneLink) return {};

  return {
    url: phoneLink,
    source: "business_phone_number",
    note: "Opens WhatsApp with the real business phone number; WhatsApp confirms whether the number is registered."
  };
}

function buildVerificationLinks(lead, dossier) {
  const businessName = lead.name || "business";
  const address = dossier.location?.address || lead.address || "";
  const website = dossier.contact?.website || lead.websiteUrl || "";
  const hostname = hostnameFromWebsite(website);
  const baseQuery = [businessName, address].filter(Boolean).join(" ");

  return compactObject({
    googleBusinessSearch: searchUrl(baseQuery),
    ownerSearch: searchUrl(`${baseQuery} owner manager founder`),
    phoneEmailSearch: searchUrl(`${baseQuery} phone email contact`),
    facebookSearch: searchUrl(`${baseQuery} Facebook`),
    instagramSearch: searchUrl(`${baseQuery} Instagram`),
    linkedinSearch: searchUrl(`${baseQuery} LinkedIn owner manager`),
    tiktokSearch: searchUrl(`${baseQuery} TikTok`),
    youtubeSearch: searchUrl(`${baseQuery} YouTube`),
    xSearch: searchUrl(`${baseQuery} X Twitter`),
    whatsappContact: dossier.contact?.whatsappLink || "",
    websiteContactSearch: hostname ? searchUrl(`site:${hostname} contact email phone owner`) : ""
  });
}

function formatWebsiteBuildBrief(lead, dossier) {
  const missing = dossier.salesUse?.missingData?.length
    ? dossier.salesUse.missingData.join(", ")
    : "No critical missing public fields detected";
  const auditChecks = Object.entries(dossier.audit?.checks || {})
    .map(([key, value]) => `${key}: ${value ? "found" : "missing"}`)
    .join("; ");

  return [
    "WEBSITE BUILD BRIEF",
    "",
    `Business name: ${valueOrNotFound(lead.name)}`,
    `Business type: ${valueOrNotFound(lead.businessType || lead.category)}`,
    `Owner name: ${valueOrNotFound(dossier.ownerContact?.ownerName)}`,
    `Operator/manager: ${valueOrNotFound(dossier.ownerContact?.operator || dossier.ownerContact?.contactPerson)}`,
    `Contact role: ${valueOrNotFound(dossier.ownerContact?.contactRole)}`,
    `Phone: ${valueOrNotFound(dossier.contact?.phone || dossier.contact?.mobile)}`,
    `WhatsApp contact: ${valueOrNotFound(dossier.contact?.whatsappLink)}`,
    `WhatsApp source note: ${valueOrNotFound(dossier.contact?.whatsappVerificationNote)}`,
    `Email: ${valueOrNotFound(dossier.contact?.email)}`,
    `Current website: ${valueOrNotFound(dossier.contact?.website || lead.websiteUrl)}`,
    `Google Maps: ${valueOrNotFound(dossier.location?.googleMapsLink || lead.googleMapsLink)}`,
    `OpenStreetMap source: ${valueOrNotFound(dossier.source?.osmUrl)}`,
    `Address: ${valueOrNotFound(dossier.location?.address || lead.address)}`,
    `City: ${valueOrNotFound(dossier.location?.city)}`,
    `Country: ${valueOrNotFound(dossier.location?.country || dossier.location?.countryName)}`,
    `Latitude/longitude: ${valueOrNotFound(dossier.location?.latitude)}, ${valueOrNotFound(dossier.location?.longitude)}`,
    `Opening hours: ${valueOrNotFound(dossier.operations?.openingHours || lead.openingHours)}`,
    `Services/cuisine/category notes: ${valueOrNotFound(dossier.business?.cuisine || dossier.business?.description || dossier.business?.businessType)}`,
    `Social links: ${valueOrNotFound(dossier.social)}`,
    `Website-discovered social links: ${valueOrNotFound(dossier.websiteDiscovery?.socialLinks)}`,
    `Website-discovered emails: ${valueOrNotFound(dossier.websiteDiscovery?.emails)}`,
    `Payment info: ${valueOrNotFound(dossier.payments)}`,
    `Owner search link: ${valueOrNotFound(dossier.verificationLinks?.ownerSearch)}`,
    `Phone/email search link: ${valueOrNotFound(dossier.verificationLinks?.phoneEmailSearch)}`,
    "",
    "WEBSITE OPPORTUNITY",
    `Opportunity score: ${valueOrNotFound(dossier.audit?.score)}/100`,
    `Opportunity category: ${valueOrNotFound(dossier.audit?.category)}`,
    `Best offer: ${valueOrNotFound(dossier.salesUse?.bestOffer)}`,
    `Missing data to collect: ${missing}`,
    `Audit checks: ${auditChecks || "No audit checks available"}`,
    "",
    "RECOMMENDED WEBSITE STRUCTURE",
    "Home: clear offer, location, phone, primary CTA",
    "About: trust, owner/operator story if available",
    "Services/Menu/Inventory: based on business type",
    "Gallery: business photos and proof",
    "Reviews: Google/social proof",
    "Contact: map, phone, email, opening hours, form",
    "Booking/Quote CTA: appointment, reservation, or inquiry flow",
    "",
    "OWNER/CONTACT NOTE",
    dossier.ownerContact?.ownerName || dossier.ownerContact?.operator || dossier.ownerContact?.contactPerson
      ? "Owner/operator/contact information was found in the public source data."
      : "Owner or direct contact person was not publicly listed. Use the owner search link, business phone, email, website contact form, Google Maps link, Facebook, Instagram, or LinkedIn to verify the decision maker before outreach."
  ].join("\n");
}

function money(value) {
  return `$${Math.round(Number(value) || 0).toLocaleString("en-US")}`;
}

function businessLabel(lead, dossier) {
  return lead.businessType || lead.category || dossier.business?.businessType || dossier.business?.category || "local business";
}

function primaryContactValue(dossier) {
  return dossier.contact?.phone || dossier.contact?.mobile || dossier.contact?.email || dossier.contact?.whatsappLink || "";
}

function estimatedProjectValue(lead, dossier) {
  const score = Number(dossier.audit?.score ?? lead.opportunityScore ?? 50);
  const noWebsite = !lead.websiteUrl;
  const contactBonus = primaryContactValue(dossier) ? 450 : 0;
  const categoryBonus = score >= 80 ? 900 : score >= 55 ? 550 : 250;
  const websiteBonus = noWebsite ? 1800 : 650;
  const bookingBonus = dossier.audit?.checks?.bookingSystem === false ? 450 : 0;
  const seoBonus = dossier.audit?.checks?.seoMetadata === false ? 400 : 0;
  return websiteBonus + categoryBonus + contactBonus + bookingBonus + seoBonus + 1200;
}

function monthlyUpsideEstimate(lead, dossier) {
  const reviews = Math.max(0, Number(lead.reviewsCount || dossier.business?.reviewsCount || 0));
  const rating = Math.max(0, Number(lead.rating || dossier.business?.rating || 0));
  const baseline = lead.websiteUrl ? 750 : 1200;
  const trustMultiplier = rating >= 4.5 ? 1.35 : rating >= 4 ? 1.18 : 1;
  const demandLift = Math.min(1400, reviews * 3.5);
  return Math.round((baseline + demandLift) * trustMultiplier);
}

function buildLeadReasons(lead, dossier) {
  const checks = dossier.audit?.checks || {};
  const reasons = [
    !lead.websiteUrl && "No public website was found, making a new website build an obvious first offer.",
    checks.mobileFriendly === false && "The current website appears weak on mobile, which hurts calls, bookings, and form conversions.",
    checks.seoMetadata === false && "SEO metadata is missing or weak, so the business is likely underperforming in local search.",
    checks.https === false && "HTTPS is missing, which creates a trust and conversion issue.",
    checks.contactForm === false && "A contact form or conversion path was not detected.",
    checks.bookingSystem === false && "No booking or appointment system was detected.",
    primaryContactValue(dossier) && "Public contact data is available, so outreach can start without manual data hunting.",
    Object.keys(dossier.social || {}).length > 0 && "Social links were found, giving an extra verification and follow-up channel.",
    (Number(dossier.business?.rating || lead.rating || 0) >= 4) && "The business has enough reputation signal to benefit from a better conversion funnel."
  ].filter(Boolean);

  return reasons.length ? reasons.slice(0, 8) : [
    "The public profile has enough location and business data to support a targeted audit and proposal.",
    "A concise local SEO, conversion, and follow-up offer can be positioned around measurable revenue improvement."
  ];
}

function buildCompetitorGap(lead, dossier) {
  const label = businessLabel(lead, dossier);
  const city = dossier.location?.city || dossier.location?.marketName || lead.marketName || "the local market";
  const checks = dossier.audit?.checks || {};
  return {
    searchQuery: `${lead.name || label} competitors ${city}`,
    competitorSearchUrl: searchUrl(`${label} near ${city} best website booking reviews`),
    likelyGaps: [
      !lead.websiteUrl ? "Competitors with modern websites can capture customers before this business is considered." : "Competitors may be winning with clearer landing pages, faster mobile UX, and stronger calls to action.",
      checks.bookingSystem === false ? "Businesses with online booking can convert after-hours demand automatically." : "Booking is present or unknown, so focus on making the booking path shorter and more visible.",
      checks.seoMetadata === false ? "Competitors with better titles, descriptions, and local pages may outrank this profile." : "SEO metadata is present or unknown, so the next gap is content depth and local proof.",
      "Review proof, service pages, photo galleries, and map-ready contact sections should be benchmarked before outreach."
    ],
    positioningAngle: `Position the offer as a local ${label} conversion upgrade in ${city}, not just a generic website project.`
  };
}

function buildProposalPack(lead, dossier) {
  const noWebsite = !lead.websiteUrl;
  const projectValue = estimatedProjectValue(lead, dossier);
  const monthlyValue = Math.max(497, Math.round(projectValue * 0.18));
  const label = businessLabel(lead, dossier);
  return {
    title: noWebsite ? "Local Website Launch + Lead Capture System" : "Website Conversion + Local SEO Growth Sprint",
    targetBusiness: lead.name || "Local business",
    packagePrice: projectValue,
    monthlyRetainer: monthlyValue,
    closeRateTarget: "18% to 32% when contact data and decision maker are verified",
    timeline: noWebsite ? "7 to 14 days" : "5 to 10 days",
    deliverables: [
      noWebsite ? "Conversion-focused website with mobile-first pages" : "Website audit fixes for mobile, SEO, speed, and trust",
      "Google Maps conversion section with phone, directions, reviews, and service area",
      "Booking, quote, or contact form connected to email/CRM",
      "Local SEO title, description, schema, and service/category copy",
      "AI-assisted outreach follow-up sequence for missed calls and warm leads",
      "Monthly reporting dashboard with calls, leads, bookings, and next actions"
    ],
    upsells: [
      "AI chatbot or SMS assistant",
      "CRM pipeline automation",
      "Monthly SEO content pages",
      "Review generation campaign",
      "Paid ads landing page"
    ],
    firstPitch: `I found a few quick wins for ${lead.name || "your business"} that can help a ${label} turn more local searches into calls, bookings, and quote requests.`
  };
}

function buildRoiEstimate(lead, dossier) {
  const projectValue = estimatedProjectValue(lead, dossier);
  const monthlyUpside = monthlyUpsideEstimate(lead, dossier);
  const breakEvenMonths = Math.max(1, Math.ceil(projectValue / monthlyUpside));
  return {
    setupInvestment: projectValue,
    estimatedMonthlyUpside: monthlyUpside,
    breakEvenMonths,
    twelveMonthUpside: monthlyUpside * 12,
    assumptions: [
      "Assumes a modest lift in calls, form fills, bookings, and map-to-website conversions.",
      "Uses public reputation, website status, audit gaps, and contact completeness as directional signals.",
      "Final ROI should be refined after confirming average order value and close rate with the owner."
    ],
    roiStory: `${money(projectValue)} in setup can break even in about ${breakEvenMonths} month${breakEvenMonths === 1 ? "" : "s"} if the business captures roughly ${money(monthlyUpside)} in extra monthly revenue.`
  };
}

function buildCallScript(lead, dossier) {
  const name = lead.name || "your business";
  const label = businessLabel(lead, dossier);
  const issue = !lead.websiteUrl
    ? "I could not find a proper website connected to your map listing"
    : "I noticed a few conversion and local search gaps on your website";
  return {
    opener: `Hi, is this the best person to speak with about marketing or the website for ${name}?`,
    reason: `I was checking local ${label} businesses and ${issue}.`,
    valueHook: "The quick win is making it easier for people who already find you on Google Maps to call, book, or request a quote.",
    qualifyingQuestions: [
      "Do most new customers come from Google, referrals, or repeat business?",
      "Do you currently track calls, forms, bookings, or missed inquiries?",
      "If we could add a few more qualified leads each month, what would that be worth?",
      "Who usually approves website or marketing improvements?"
    ],
    close: "Would it be useful if I sent a one-page audit with the exact fixes and a simple price range?"
  };
}

function buildObjectionHandlers() {
  return [
    {
      objection: "We already have someone for the website.",
      response: "That is good. I am not trying to replace them. I can send a short revenue audit showing missed calls, bookings, SEO, and conversion gaps your current team can also use."
    },
    {
      objection: "We do not have budget right now.",
      response: "Totally fair. That is why I frame it around break-even. If one or two extra jobs can cover the work, it becomes a revenue decision instead of a design expense."
    },
    {
      objection: "Send me information.",
      response: "Absolutely. I will send the audit, but before I do, what matters most: more calls, more bookings, better Google visibility, or a more professional site?"
    }
  ];
}

function buildOutreachSequence(lead, dossier) {
  const name = lead.name || "your business";
  const noWebsite = !lead.websiteUrl;
  return [
    {
      day: 1,
      channel: "Email or contact form",
      subject: noWebsite ? `Website opportunity for ${name}` : `Quick website wins for ${name}`,
      message: `${name} looks like it could win more local customers with ${noWebsite ? "a simple website and lead capture setup" : "a few website conversion and local SEO fixes"}. I can send a one-page audit with the highest-value fixes.`
    },
    {
      day: 2,
      channel: "Phone or WhatsApp",
      subject: "Verify decision maker",
      message: "Call to confirm who handles website or marketing decisions, then ask whether calls, bookings, or quote requests are the highest priority."
    },
    {
      day: 4,
      channel: "Email follow-up",
      subject: "3 quick wins",
      message: "Send three bullets from the audit: conversion path, Google Maps trust signals, and booking/contact automation."
    },
    {
      day: 7,
      channel: "Final value follow-up",
      subject: "Should I close this out?",
      message: "Offer to close the loop unless they want the full proposal and ROI estimate."
    }
  ];
}

function buildSalesAgentPlan(lead, dossier) {
  const contact = primaryContactValue(dossier) || "Verify phone, email, or owner contact first";
  return {
    status: primaryContactValue(dossier) ? "Ready for outreach" : "Needs contact verification",
    nextBestAction: primaryContactValue(dossier)
      ? "Send the audit summary, then call within 24 hours."
      : "Use the owner and contact finder links before starting the outreach sequence.",
    contactTarget: contact,
    pipelineStage: "New",
    recommendedFollowUpDays: [1, 2, 4, 7, 14],
    automationTasks: [
      "Create CRM deal with proposal value and source link.",
      "Copy proposal pack into email or client report.",
      "Set follow-up reminder after the first call.",
      "Track reply, meeting booked, proposal sent, won, or lost."
    ]
  };
}

function buildContactFinder(lead, dossier) {
  return {
    status: primaryContactValue(dossier) ? "Public contact data found" : "Needs manual verification",
    bestContact: primaryContactValue(dossier) || "Not found in public data",
    ownerCandidate: dossier.ownerContact?.ownerName || dossier.ownerContact?.operator || dossier.ownerContact?.contactPerson || "Not found in public data",
    verifiedChannels: [
      dossier.contact?.phone && "phone",
      dossier.contact?.email && "email",
      dossier.contact?.whatsappLink && "whatsapp",
      lead.websiteUrl && "website",
      Object.keys(dossier.social || {}).length && "social"
    ].filter(Boolean),
    verificationSteps: [
      "Open Google Maps and confirm the business is active.",
      "Check the official website contact page if one exists.",
      "Search owner, manager, Facebook, Instagram, and LinkedIn links before claiming decision-maker data.",
      "Call or message using the public business contact channel."
    ]
  };
}

function buildClientReportMeta(lead, dossier, proposal, roi) {
  return {
    title: `${lead.name || "Business"} Growth Opportunity Report`,
    reportUrl: `/client-report.html?id=${encodeURIComponent(lead.id || "")}`,
    summary: `A proposal-ready audit for ${lead.name || "this business"} with website gaps, outreach plan, projected ROI, and next actions.`,
    primaryCta: "Book a strategy call",
    recommendedOffer: proposal.title,
    estimatedInvestment: proposal.packagePrice,
    estimatedMonthlyUpside: roi.estimatedMonthlyUpside,
    disclaimer: "Use this as a directional sales report. Confirm business revenue, margins, and decision-maker details before sending final pricing."
  };
}

function formatProposalBrief(lead, dossier, proposal, roi) {
  return [
    "PROPOSAL PACK",
    "",
    `Business: ${valueOrNotFound(lead.name)}`,
    `Offer: ${valueOrNotFound(proposal.title)}`,
    `Package price: ${money(proposal.packagePrice)}`,
    `Monthly retainer: ${money(proposal.monthlyRetainer)}`,
    `Timeline: ${proposal.timeline}`,
    `ROI story: ${roi.roiStory}`,
    "",
    "DELIVERABLES",
    ...proposal.deliverables.map((item) => `- ${item}`),
    "",
    "FIRST PITCH",
    proposal.firstPitch,
    "",
    "NEXT STEP",
    dossier.salesAgent?.nextBestAction || "Verify contact data, send audit, and request a short call."
  ].join("\n");
}

function formatOutreachSequence(sequence = []) {
  return sequence.map((step) => [
    `DAY ${step.day} - ${step.channel}`,
    `Subject: ${step.subject}`,
    step.message
  ].join("\n")).join("\n\n");
}

function buildRevenueAssets(lead, dossier) {
  const proposal = buildProposalPack(lead, dossier);
  const roi = buildRoiEstimate(lead, dossier);
  return {
    leadReasons: buildLeadReasons(lead, dossier),
    roi,
    competitorGap: buildCompetitorGap(lead, dossier),
    proposal,
    callScript: buildCallScript(lead, dossier),
    objectionHandlers: buildObjectionHandlers(),
    outreachSequence: buildOutreachSequence(lead, dossier),
    salesAgent: buildSalesAgentPlan(lead, dossier),
    contactFinder: buildContactFinder(lead, dossier),
    clientReport: buildClientReportMeta(lead, dossier, proposal, roi)
  };
}

function buildLeadDossier(lead, audit) {
  const details = lead.details || {};
  const rawTags = details.source?.rawTags || lead.raw?.tags || {};
  const ownerContact = compactObject({
    ownerName: details.ownerContact?.ownerName || rawTags.owner || rawTags["contact:owner"],
    operator: details.ownerContact?.operator || rawTags.operator || rawTags["operator:name"],
    contactPerson: details.ownerContact?.contactPerson || rawTags["contact:person"] || rawTags["contact:name"] || rawTags.manager,
    contactRole: details.ownerContact?.contactRole || rawTags["contact:role"],
    publicContactNote: details.ownerContact?.publicContactNote
  });
  let contact = compactObject({
    phone: lead.phone,
    email: lead.email,
    website: lead.websiteUrl,
    social: lead.social,
    ...(details.contact || {})
  });
  const location = compactObject({
    address: lead.address,
    latitude: lead.latitude,
    longitude: lead.longitude,
    googleMapsLink: lead.googleMapsLink,
    marketName: lead.marketName,
    countryName: lead.countryName,
    ...(details.location || {})
  });
  const whatsappContact = whatsappContactForLead(lead, contact, location, audit);
  contact = compactObject({
    ...contact,
    whatsappLink: whatsappContact.url,
    whatsappSource: whatsappContact.source,
    whatsappVerificationNote: whatsappContact.note
  });
  const business = compactObject({
    name: lead.name,
    category: lead.category,
    businessType: lead.businessType,
    rating: lead.rating,
    reviewsCount: lead.reviewsCount,
    opportunityScore: lead.opportunityScore,
    opportunityCategory: lead.opportunityCategory,
    ...(details.business || {})
  });

  const dossier = {
    summary: compactObject({
      name: lead.name,
      businessType: lead.businessType || lead.category,
      source: lead.source,
      score: audit?.score ?? lead.opportunityScore,
      opportunity: audit?.category || lead.opportunityCategory
    }),
    ownerContact,
    contact,
    social: details.social || {},
    location,
    business,
    operations: details.operations || {},
    payments: details.payments || {},
    websiteDiscovery: details.publicWebsiteProfile || audit?.publicProfile || {},
    onlinePresence: compactObject({
      website: lead.websiteUrl,
      googleMapsLink: lead.googleMapsLink,
      osmUrl: details.source?.osmUrl,
      hasWebsite: Boolean(lead.websiteUrl),
      hasPhone: Boolean(contact.phone || contact.mobile),
      hasEmail: Boolean(contact.email),
      hasWhatsapp: Boolean(contact.whatsappLink),
      whatsappLink: contact.whatsappLink,
      hasSocial: Boolean(Object.keys(details.social || {}).length || lead.social),
      socialLinks: details.social || {},
      websiteDiscoveredSocialLinks: details.publicWebsiteProfile?.socialLinks || audit?.publicProfile?.socialLinks || {},
      websiteDiscoveredEmails: details.publicWebsiteProfile?.emails || audit?.publicProfile?.emails || [],
      websiteDiscoveredPhones: details.publicWebsiteProfile?.phones || audit?.publicProfile?.phones || []
    }),
    audit: compactObject({
      score: audit?.score,
      category: audit?.category,
      elapsedMs: audit?.elapsedMs,
      status: audit?.status,
      checks: audit?.checks || {},
      error: audit?.error
    }),
    source: details.source || compactObject({
      provider: lead.source,
      raw: lead.raw
    }),
    salesUse: {
      bestOffer: lead.websiteUrl ? "Website audit, SEO improvement, booking/contact conversion, AI outreach automation" : "New website build, Google Maps conversion, local SEO, booking/contact setup",
      missingData: [
        !lead.websiteUrl && "website",
        !contact.phone && "phone",
        !contact.email && "email",
        !Object.keys(details.social || {}).length && !lead.social && "social links",
        !details.operations?.openingHours && !lead.openingHours && "opening hours"
      ].filter(Boolean)
    }
  };
  const verificationLinks = buildVerificationLinks(lead, dossier);
  const dossierWithLinks = { ...dossier, verificationLinks };
  const revenueAssets = buildRevenueAssets(lead, dossierWithLinks);
  const completeDossier = { ...dossierWithLinks, ...revenueAssets };

  return {
    ...completeDossier,
    copyReady: {
      websiteBuildBrief: formatWebsiteBuildBrief(lead, completeDossier),
      proposalBrief: formatProposalBrief(lead, completeDossier, revenueAssets.proposal, revenueAssets.roi),
      callScript: [
        revenueAssets.callScript.opener,
        revenueAssets.callScript.reason,
        revenueAssets.callScript.valueHook,
        "",
        "Questions:",
        ...revenueAssets.callScript.qualifyingQuestions.map((item) => `- ${item}`),
        "",
        `Close: ${revenueAssets.callScript.close}`
      ].join("\n"),
      outreachSequence: formatOutreachSequence(revenueAssets.outreachSequence)
    }
  };
}

export class LeadService {
  constructor() {
    this.googlePlaces = new GooglePlacesService();
    this.websiteAudit = new WebsiteAuditService();
    this.leads = new FirestoreRepository("leads");
    this.auditLogs = new FirestoreRepository("auditLogs");
    this.users = new FirestoreRepository("users");
  }

  async currentAccessUser(user) {
    if (!user?.uid || isAdminUser(user)) return user;
    const stored = await this.users.findById(user.uid);
    return { ...user, ...(stored || {}) };
  }

  async assertTrialAccess(user) {
    if (!isTrialUser(user)) return null;
    const usage = trialUsage(user);
    if (usage.remaining <= 0) {
      throw new AppError(
        "Your free trial includes 2 lead searches with up to 5 leads each. Subscribe to unlock more lead searches.",
        402,
        "TRIAL_LIMIT_REACHED",
        { trial: usage, upgradeUrl: "/pricing.html" }
      );
    }
    return usage;
  }

  async recordTrialSearch(user, usage) {
    if (!usage || !user?.uid) return null;
    const used = usage.used + 1;
    const nextUsage = {
      used,
      remaining: Math.max(0, usage.searchLimit - used),
      searchLimit: usage.searchLimit,
      leadLimit: usage.leadLimit
    };
    await this.users.upsert(user.uid, {
      trialSearchesUsed: used,
      subscription: "trial",
      planName: "Free Trial",
      billingStatus: "trial",
      monthlyLeadLimit: usage.leadLimit,
      entitlements: {
        billingRequired: true,
        trial: true,
        trialSearchesUsed: used,
        trialSearchLimit: usage.searchLimit,
        trialLeadLimit: usage.leadLimit,
        upgradeRequiredAfterTrial: true
      }
    });
    return nextUsage;
  }

  async search(search, user) {
    const accessUser = await this.currentAccessUser(user);
    const startingTrialUsage = await this.assertTrialAccess(accessUser);
    const admin = isAdminUser(accessUser) || accessUser?.entitlements?.unlimitedAccess || accessUser?.permissions?.includes?.("unlimited");
    const effectiveSearch = normalizeSearchForUser(search, accessUser);
    const bypassCache = Boolean(effectiveSearch.bypassCache || effectiveSearch.refreshSeed);
    const refreshSeed = effectiveSearch.refreshSeed || (bypassCache ? String(Date.now()) : "");
    const providerSearch = {
      ...effectiveSearch,
      refreshSeed,
      limit: candidateLimitForSearch(effectiveSearch, admin)
    };
    const resultLimit = returnLimitForUser(effectiveSearch, accessUser);
    const cacheKey = cacheKeyForSearch(providerSearch, accessUser);
    const cached = bypassCache ? null : getCachedSearch(cacheKey);
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
        trial: updatedTrialUsage ? {
          ...updatedTrialUsage,
          limited: true,
          upgradeUrl: "/pricing.html"
        } : cached.trial
      };
    }

    const result = await this.googlePlaces.search(providerSearch);
    const audited = await Promise.all(result.leads.map(async (lead) => {
      try {
        const audit = lead.audit?.publicProfile ? lead.audit : await this.websiteAudit.audit(lead);
        const enrichedLead = mergePublicWebsiteProfile(lead, audit);
        return { ...enrichedLead, audit, opportunityScore: audit.score, opportunityCategory: audit.category };
      } catch (error) {
        return {
          ...lead,
          audit: { score: 0, category: "Audit Pending", checks: {}, error: error.message },
          opportunityScore: 0,
          opportunityCategory: "Audit Pending"
        };
      }
    }));
    const filteredPool = applyLeadFilters(audited, effectiveSearch);
    const filtersRelaxed = filteredPool.length === 0 && audited.length > 0;
    const qualifiedPool = freshLeadOrder(filtersRelaxed ? fallbackLeadPool(audited) : filteredPool, refreshSeed);
    const qualified = qualifiedPool.slice(0, resultLimit);

    await Promise.all(qualified.map((lead) => this.leads.upsert(lead.id, {
      ...lead,
      source: result.source || "google_places",
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
      refreshSeed,
      adminUnlimited: admin,
      searchStats: {
        requestedLimit: effectiveSearch.limit,
        returnedLimit: resultLimit,
        providerCandidateLimit: providerSearch.limit,
        rawCount: result.leads.length,
        auditedCount: audited.length,
        qualifiedCount: qualified.length,
        qualifiedPoolCount: qualifiedPool.length,
        filtersRelaxed,
        bypassCache,
        searchDepth: effectiveSearch.searchDepth,
        leadQuality: effectiveSearch.leadQuality,
        sortBy: effectiveSearch.sortBy
      },
      trial: updatedTrialUsage ? {
        ...updatedTrialUsage,
        limited: true,
        upgradeUrl: "/pricing.html"
      } : undefined
    };
    if (!bypassCache) setCachedSearch(cacheKey, response);
    return response;
  }

  async save(leadId, user) {
    const existing = await this.getById(leadId);
    const lead = existing;
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
    const publicEnrichedLead = mergePublicWebsiteProfile(lead, audit);
    const enrichedLead = { ...publicEnrichedLead, audit, opportunityScore: audit.score, opportunityCategory: audit.category };
    return {
      lead: enrichedLead,
      dossier: buildLeadDossier(enrichedLead, audit),
      aiSummary: env.nvidia.apiKey
        ? "NVIDIA analysis is ready for this lead."
        : "Real NVIDIA analysis requires NVIDIA_API_KEY in .env."
    };
  }
}
