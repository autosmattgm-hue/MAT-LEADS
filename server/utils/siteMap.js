export const SITE_MAP = {
  public: [
    ["/index.html", "Landing page and product overview"],
    ["/login.html", "Sign in"],
    ["/signup.html", "Create an account and referral registration"],
    ["/pricing.html", "Plans and subscription checkout"],
    ["/about.html", "About MAT LEADS"],
    ["/faq.html", "Frequently asked questions"]
  ],
  workspace: [
    ["/dashboard.html", "Account overview, metrics, daily actions and saved work"],
    ["/leads.html", "Search businesses, filter opportunities and save leads"],
    ["/lead-details.html", "Lead evidence, audit, contacts, actions and CRM details"],
    ["/crm.html", "Pipeline stages, notes, follow-ups and outreach history"],
    ["/website-studio.html", "Chat with MAT Studio AI and generate a website"],
    ["/website-editor.html", "Edit a generated website visually"],
    ["/ai-agent.html", "Account-aware support and workflow guidance"],
    ["/community.html", "Persistent friend search and chat"],
    ["/social.html", "Social profile and network features"],
    ["/outreach.html", "Email, WhatsApp and follow-up messaging tools"],
    ["/proposals.html", "Client proposals and payment requests"],
    ["/playbook.html", "Lead-specific growth playbooks"],
    ["/reports.html", "Business and lead reports"],
    ["/analytics.html", "Performance and conversion analytics"],
    ["/earn.html", "Referrals, invoices and payout requests"],
    ["/gigs.html", "Gigs and work opportunities"],
    ["/tools.html", "Business productivity tools"],
    ["/work-planner.html", "Tasks and planning"],
    ["/profile.html", "Profile and plan details"],
    ["/settings.html", "Account, notification and security settings"],
    ["/admin.html", "Admin metrics and operations; admin role required"]
  ],
  supportRules: [
    "Use actual page names and route links when guiding navigation.",
    "Explain that AI can advise and draft, but does not silently send messages, alter CRM records, charge cards, or approve payouts.",
    "Use only verified lead information and tell users when a provider or deployment setting is required.",
    "For referral support, registration pays $0.20, a subscribing referral pays $4.00, and withdrawals require at least $50.",
    "For disappearing data, check the deployment health endpoint and persistent Firebase service configuration."
  ]
};

export function siteMapText() {
  return JSON.stringify(SITE_MAP);
}
