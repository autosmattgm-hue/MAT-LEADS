import { FirestoreRepository } from "../repositories/firestoreRepository.js";
import { isAdminUser } from "../utils/entitlements.js";

export class CrmService {
  constructor() {
    this.leads = new FirestoreRepository("leads");
    this.activities = new FirestoreRepository("activities");
  }

  async listLeads(user) {
    try {
      if (isAdminUser(user)) {
        return await this.leads.list({ limit: 1000 });
      }

      return await this.leads.list({
        where: [{ field: "ownerId", op: "==", value: user?.uid }],
        limit: 100
      });
    } catch {
      return [];
    }
  }

  async updateStage(id, stage, user) {
    const existing = await this.leads.findById(id);
    if (!existing) return null;
    const updated = await this.leads.upsert(id, {
      ...existing,
      ownerId: isAdminUser(user) ? existing.ownerId || user?.uid : user?.uid,
      stage
    });
    await this.activities.create({
      leadId: id,
      actor: user?.email,
      action: "stage_updated",
      stage
    });
    return updated;
  }

  async addNote(id, note, tags, user) {
    return this.activities.create({
      leadId: id,
      actor: user?.email,
      action: "note_added",
      note,
      tags
    });
  }
}
