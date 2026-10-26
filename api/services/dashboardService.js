import { CrmService } from "./crmService.js";

export class DashboardService {
  constructor() {
    this.crm = new CrmService();
  }

  async metrics(user) {
    const leads = await this.crm.listLeads(user);
    const savedLeads = leads.length;
    const contactedLeads = leads.filter((lead) => ["Contacted", "Follow Up", "Proposal Sent", "Meeting Scheduled", "Negotiation", "Won"].includes(lead.stage)).length;
    const wonDeals = leads.filter((lead) => lead.stage === "Won").length;
    const estimatedRevenue = leads.reduce((sum, lead) => sum + Number(lead.estimatedValue || 0), 0);

    return {
      totalLeads: savedLeads,
      savedLeads,
      contactedLeads,
      wonDeals,
      estimatedRevenue,
      conversionRate: savedLeads ? Math.round((wonDeals / savedLeads) * 100) : 0,
      monthlyGrowth: this.monthlyGrowth(leads)
    };
  }

  monthlyGrowth(leads) {
    const labels = [];
    const now = new Date();
    for (let index = 5; index >= 0; index -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      labels.push({
        label: date.toLocaleString("en-US", { month: "short" }),
        year: date.getFullYear(),
        month: date.getMonth(),
        value: 0
      });
    }

    for (const lead of leads) {
      const date = new Date(lead.savedAt || lead.discoveredAt || lead.createdAt || Date.now());
      const bucket = labels.find((item) => item.year === date.getFullYear() && item.month === date.getMonth());
      if (bucket) bucket.value += 1;
    }

    return labels.map(({ label, value }) => ({ label, value }));
  }
}
