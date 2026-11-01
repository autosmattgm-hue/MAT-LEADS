import { CrmService } from "./crmService.js";
import { DashboardService } from "./dashboardService.js";
import { NvidiaService } from "./nvidiaService.js";

function compactLead(lead = {}) {
  return {
    id: lead.id,
    name: lead.name || "Unnamed lead",
    stage: lead.stage || "New",
    score: Number(lead.opportunityScore || lead.audit?.score || 0),
    category: lead.category || lead.businessType || "",
    location: lead.city || lead.location || lead.address || "",
    hasWebsite: Boolean(lead.websiteUrl),
    nextActionAt: lead.nextActionAt || lead.nextFollowUpAt || ""
  };
}

function actionForDailyItem(item = {}) {
  const leadId = encodeURIComponent(String(item.leadId || ""));
  return {
    title: item.title || "Review lead",
    reason: item.reason || "Requires attention.",
    href: leadId ? `/lead-details.html?id=${leadId}` : "/crm.html",
    label: item.actionLabel || "Open lead"
  };
}

/**
 * Account-scoped agent context. It can recommend navigation and work based on
 * real CRM records but deliberately has no write or messaging capability.
 */
export class AiAgentService {
  constructor() {
    this.crm = new CrmService();
    this.dashboard = new DashboardService();
    this.nvidia = new NvidiaService();
  }

  async ask(user, prompt) {
    const [metrics, leads] = await Promise.all([
      this.dashboard.metrics(user),
      this.crm.listLeads(user)
    ]);
    const priorityLeads = [...leads]
      .map(compactLead)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6);
    const context = {
      platform: {
        name: "MAT LEADS AI PRO X",
        purpose: "A global lead discovery, website opportunity, outreach, CRM, and revenue operations workspace.",
        capabilities: [
          "Search and qualify real business leads with location, industry, radius, quality, website, contact, score, and result-count filters.",
          "Save, deduplicate, export, and manage leads through New, Contacted, Follow Up, Proposal Sent, Meeting Scheduled, Negotiation, Won, and Lost stages.",
          "Audit websites for reachability, SEO, mobile readiness, HTTPS, metadata, structure, and improvement opportunities when a URL is available.",
          "Prepare editable outreach drafts and proposals; sending and CRM mutations always require explicit user action.",
          "Review dashboard actions, analytics, pipeline value, conversion, and account settings."
        ],
        operatingRules: [
          "Never invent contact details, audit findings, revenue, or completed actions.",
          "Recommend the next useful screen or workflow when the user asks how to do something.",
          "Use the verified account snapshot for personal recommendations."
        ]
      },
      account: {
        role: user?.role || "user",
        plan: user?.planName || user?.subscription || "unknown"
      },
      metrics: {
        savedLeads: metrics.savedLeads,
        contactedLeads: metrics.contactedLeads,
        wonDeals: metrics.wonDeals,
        estimatedRevenue: metrics.estimatedRevenue,
        conversionRate: metrics.conversionRate,
        dailyActionSummary: metrics.dailyActionSummary || {}
      },
      dailyActions: (metrics.dailyActions || []).slice(0, 6).map((item) => ({
        title: item.title,
        leadName: item.leadName,
        reason: item.reason,
        dueAt: item.dueAt || ""
      })),
      priorityLeads
    };
    const result = await this.nvidia.agentChat(prompt, context);
    return {
      ...result,
      context: {
        metrics: context.metrics,
        actions: (metrics.dailyActions || []).slice(0, 6).map(actionForDailyItem),
        leadCount: leads.length
      }
    };
  }
}
