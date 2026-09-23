import { paidPlanKeys } from "../config/plans.js";

function validationError(fieldErrors) {
  const error = new Error("Validation failed");
  error.fieldErrors = fieldErrors;
  return error;
}

function schema(validator) {
  return {
    safeParse(input) {
      try {
        return { success: true, data: validator(input || {}) };
      } catch (error) {
        return {
          success: false,
          error: {
            flatten: () => ({ fieldErrors: error.fieldErrors || { form: [error.message] } })
          }
        };
      }
    }
  };
}

function stringField(input, field, options = {}) {
  const value = input[field] === undefined || input[field] === null ? "" : String(input[field]).trim();
  const errors = [];

  if (options.required && !value) errors.push("Required");
  if (options.min && value.length < options.min) errors.push(`Must be at least ${options.min} characters`);
  if (options.max && value.length > options.max && !options.truncate) errors.push(`Must be at most ${options.max} characters`);
  if (options.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors.push("Must be a valid email");

  if (errors.length) throw validationError({ [field]: errors });
  const normalized = options.max && options.truncate ? value.slice(0, options.max) : value;
  return normalized || options.default || "";
}

function stringListField(input, field, options = {}) {
  const raw = input[field];
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,;\n|]/)
      : [];
  const cleaned = [...new Set(values
    .map((value) => String(value || "").trim())
    .filter(Boolean))]
    .slice(0, options.maxItems || 20);

  for (const value of cleaned) {
    if (options.max && value.length > options.max) {
      throw validationError({ [field]: [`Each value must be at most ${options.max} characters`] });
    }
  }

  return cleaned;
}

function numberField(input, field, options = {}) {
  const value = input[field] === undefined || input[field] === "" ? options.default : Number(input[field]);
  if (!Number.isFinite(value)) {
    if (options.defaultOnInvalid) return options.default;
    throw validationError({ [field]: ["Must be a number"] });
  }
  const normalized = options.int ? Math.round(value) : value;
  if (options.min !== undefined && normalized < options.min) {
    if (options.clamp) return options.min;
    throw validationError({ [field]: [`Must be at least ${options.min}`] });
  }
  if (options.max !== undefined && normalized > options.max) {
    if (options.clamp) return options.max;
    throw validationError({ [field]: [`Must be at most ${options.max}`] });
  }
  return normalized;
}

function booleanField(input, field, options = {}) {
  const value = input[field];
  if (value === undefined || value === null || value === "") return Boolean(options.default);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return Boolean(options.default);
}

function optionalCoordinate(input, field, min, max) {
  if (input[field] === undefined || input[field] === "") return null;
  const value = Number(input[field]);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw validationError({ [field]: [`Must be between ${min} and ${max}`] });
  }
  return value;
}

function enumField(input, field, allowed, options = {}) {
  const value = input[field] || options.default;
  if (!allowed.includes(value)) throw validationError({ [field]: [`Must be one of: ${allowed.join(", ")}`] });
  return value;
}

export const authSchemas = {
  register: schema((input) => ({
    name: stringField(input, "name", { required: true, min: 2, max: 120 }),
    email: stringField(input, "email", { required: true, email: true, max: 255 }).toLowerCase(),
    password: stringField(input, "password", { required: true, min: 8, max: 128 })
  })),
  login: schema((input) => ({
    email: stringField(input, "email", { required: true, email: true, max: 255 }).toLowerCase(),
    password: stringField(input, "password", { required: true, min: 8, max: 128 })
  })),
  refresh: schema((input) => ({
    refreshToken: stringField(input, "refreshToken", { required: true, min: 20, max: 4000 })
  }))
};

export const profileSchema = schema((input) => ({
  name: stringField(input, "name", { required: true, min: 2, max: 120 }),
  company: stringField(input, "company", { max: 160, truncate: true }),
  signature: stringField(input, "signature", { max: 1000, truncate: true })
}));

export const settingsSchema = schema((input) => ({
  leadAlerts: booleanField(input, "leadAlerts", { default: true }),
  weeklyDigest: booleanField(input, "weeklyDigest", { default: true }),
  defaultCountry: stringField(input, "defaultCountry", { max: 80, truncate: true, default: "United States" }),
  defaultResults: numberField(input, "defaultResults", { int: true, min: 5, max: 200, default: 20, defaultOnInvalid: true, clamp: true }),
  brandName: stringField(input, "brandName", { max: 120, truncate: true, default: "MAT Leads AI Pro X" }),
  bookingUrl: stringField(input, "bookingUrl", { max: 400, truncate: true }),
  primaryOffer: stringField(input, "primaryOffer", { max: 180, truncate: true, default: "Website + local lead growth audit" }),
  proposalPrice: numberField(input, "proposalPrice", { int: true, min: 0, max: 100000, default: 2500, defaultOnInvalid: true, clamp: true }),
  followUpCadence: stringField(input, "followUpCadence", { max: 120, truncate: true, default: "Day 1, Day 3, Day 7" }),
  noWebsiteWeight: numberField(input, "noWebsiteWeight", { int: true, min: 0, max: 100, default: 50, defaultOnInvalid: true, clamp: true }),
  poorMobileWeight: numberField(input, "poorMobileWeight", { int: true, min: 0, max: 100, default: 20, defaultOnInvalid: true, clamp: true }),
  weakSeoWeight: numberField(input, "weakSeoWeight", { int: true, min: 0, max: 100, default: 20, defaultOnInvalid: true, clamp: true }),
  noSslWeight: numberField(input, "noSslWeight", { int: true, min: 0, max: 100, default: 10, defaultOnInvalid: true, clamp: true })
}));

export const leadSearchSchema = schema((input) => {
  const mapLink = stringField(input, "mapLink", { max: 4000, truncate: true });
  const latitude = optionalCoordinate(input, "latitude", -90, 90);
  const longitude = optionalCoordinate(input, "longitude", -180, 180);
  const hasMapLocation = Boolean(mapLink || (latitude !== null && longitude !== null));
  const country = stringField(input, "country", { max: 80 });
  const countries = stringListField(input, "countries", { max: 80, maxItems: 12 });
  const selectedCountries = [...new Set([country, ...countries].filter(Boolean))];
  const normalizedCountries = selectedCountries.length || hasMapLocation ? selectedCountries : ["Germany"];

  return {
    country: normalizedCountries[0] || "",
    countries: normalizedCountries,
    state: stringField(input, "state", { max: 80, truncate: true }),
    city: stringField(input, "city", { max: 80, truncate: true }),
    zip: stringField(input, "zip", { max: 24, truncate: true }),
    industry: stringField(input, "industry", { max: 240, truncate: true }),
    keyword: stringField(input, "keyword", { max: 240, truncate: true }),
    businessTypes: stringListField(input, "businessTypes", { max: 80, maxItems: 20 }),
    mapLink,
    latitude,
    longitude,
    radiusMeters: numberField(input, "radiusMeters", { int: true, min: 500, max: 50000, default: 15000, defaultOnInvalid: true, clamp: true }),
    limit: numberField(input, "limit", { int: true, min: 1, max: 200, default: 20, defaultOnInvalid: true, clamp: true }),
    searchDepth: enumField(input, "searchDepth", ["quick", "standard", "deep", "maximum"], { default: "deep" }),
    leadQuality: enumField(input, "leadQuality", ["all", "contact_ready", "needs_website", "high_opportunity", "owner_data"], { default: "all" }),
    sortBy: enumField(input, "sortBy", ["opportunity", "contact", "website_missing", "name"], { default: "opportunity" }),
    minOpportunityScore: numberField(input, "minOpportunityScore", { int: true, min: 0, max: 100, default: 0, defaultOnInvalid: true, clamp: true }),
    requireContact: booleanField(input, "requireContact", { default: false }),
    missingWebsiteOnly: booleanField(input, "missingWebsiteOnly", { default: false }),
    bypassCache: booleanField(input, "bypassCache", { default: false }),
    refreshSeed: stringField(input, "refreshSeed", { max: 80, truncate: true })
  };
});

const stages = ["New", "Contacted", "Follow Up", "Proposal Sent", "Meeting Scheduled", "Negotiation", "Won", "Lost"];

export const crmSchemas = {
  stage: schema((input) => ({
    stage: enumField(input, "stage", stages)
  })),
  note: schema((input) => {
    const rawTags = Array.isArray(input.tags) ? input.tags : [];
    const tags = rawTags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12);
    return {
      note: stringField(input, "note", { required: true, min: 1, max: 4000 }),
      tags
    };
  })
};

const outreachTypes = ["cold_email", "follow_up", "website_redesign", "seo", "marketing", "ai_automation", "business_audit"];

export const aiSchemas = {
  chat: schema((input) => ({
    prompt: stringField(input, "prompt", { required: true, min: 1, max: 4000 })
  })),
  analyze: schema((input) => ({
    leadId: stringField(input, "leadId", { required: true, min: 1, max: 160 })
  })),
  outreach: schema((input) => ({
    leadId: stringField(input, "leadId", { required: true, min: 1, max: 160 }),
    type: enumField(input, "type", outreachTypes, { default: "cold_email" })
  }))
};

export const billingSchema = schema((input) => ({
  plan: enumField(input, "plan", paidPlanKeys)
}));

export const paypalConfirmationSchema = schema((input) => ({
  plan: enumField(input, "plan", paidPlanKeys),
  sessionId: stringField(input, "sessionId", { required: true, min: 8, max: 160 }),
  paypalToken: stringField(input, "paypalToken", { max: 220, truncate: true }),
  payerId: stringField(input, "payerId", { max: 220, truncate: true }),
  transactionId: stringField(input, "transactionId", { max: 220, truncate: true })
}));
