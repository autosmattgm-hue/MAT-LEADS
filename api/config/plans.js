import { env } from "./env.js";

export const plans = {
  trial: {
    key: "trial",
    name: "Free Trial",
    monthlyLeadLimit: 5,
    priceUsd: null,
    stripePriceEnv: null,
    paypalPaymentLink: null,
    trialSearchLimit: 2,
    trialLeadLimit: 5,
    features: ["2 lead searches", "5 leads per search"]
  },
  starter: {
    key: "starter",
    name: "Starter",
    monthlyLeadLimit: 100,
    priceUsd: 29,
    stripePriceEnv: "STRIPE_STARTER_PRICE_ID",
    paypalPaymentLink: env.paypal.paymentLinks.starter,
    features: ["100 leads/mo", "CRM + reports"]
  },
  professional: {
    key: "professional",
    name: "Professional",
    monthlyLeadLimit: 1000,
    priceUsd: 99,
    stripePriceEnv: "STRIPE_PRO_PRICE_ID",
    paypalPaymentLink: env.paypal.paymentLinks.professional,
    features: ["1,000 leads/mo", "AI outreach", "AI Website Studio", "Business AI Tycoon + WhatsApp scripts", "Shareable website links + downloads"]
  },
  growth_plus: {
    key: "growth_plus",
    name: "Growth Plus",
    monthlyLeadLimit: 3500,
    priceUsd: 149,
    stripePriceEnv: "STRIPE_GROWTH_PLUS_PRICE_ID",
    paypalPaymentLink: env.paypal.paymentLinks.growthPlus,
    features: ["3,500 leads/mo", "AI outreach", "CRM integrations", "AI Website Studio + priority builds", "Business AI Tycoon + WhatsApp scripts"]
  },
  agency: {
    key: "agency",
    name: "Agency",
    monthlyLeadLimit: null,
    priceUsd: 249,
    stripePriceEnv: "STRIPE_AGENCY_PRICE_ID",
    paypalPaymentLink: env.paypal.paymentLinks.agency,
    features: ["Unlimited leads", "Team workflows", "AI Website Studio + white-label links", "Business AI Tycoon for closers"]
  },
  enterprise: {
    key: "enterprise",
    name: "Enterprise",
    monthlyLeadLimit: null,
    priceUsd: null,
    stripePriceEnv: null,
    paypalPaymentLink: null,
    features: ["Custom security review", "SSO", "Dedicated support"]
  }
};

export const paidPlanKeys = Object.entries(plans)
  .filter(([, plan]) => Number.isFinite(plan.priceUsd))
  .map(([key]) => key);

export function getPlan(planKey) {
  return plans[planKey];
}

export function publicPlan(planKey) {
  const plan = getPlan(planKey);
  if (!plan) return null;
  return {
    key: plan.key,
    name: plan.name,
    monthlyLeadLimit: plan.monthlyLeadLimit,
    priceUsd: plan.priceUsd,
    trialSearchLimit: plan.trialSearchLimit,
    trialLeadLimit: plan.trialLeadLimit,
    features: plan.features
  };
}
