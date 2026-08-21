import crypto from "node:crypto";
import { and, desc, eq, max } from "drizzle-orm";
import { wafThreatFilterPresetRevisions, wafThreatFilterPresets } from "../drizzle/schema";
import { getDb } from "./db";

export async function listTeamWafThreatPresets(agencyId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(wafThreatFilterPresets).where(eq(wafThreatFilterPresets.agencyId, agencyId));
}

export async function publishTeamWafThreatPreset(input: { agencyId: string; name: string; query: string; createdBy: string }) {
  const db = await getDb();
  if (!db) throw new Error("Team WAF preset storage is unavailable because the primary database is not configured.");
  const presetId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(wafThreatFilterPresets).values({ presetId, agencyId: input.agencyId, name: input.name, query: input.query, createdBy: input.createdBy, approvalStatus: "pending", activeVersion: 0 });
    await tx.insert(wafThreatFilterPresetRevisions).values({ revisionId, presetId, version: 1, query: input.query, submittedBy: input.createdBy, status: "pending" });
  });
  return { presetId, revisionId, status: "pending" as const };
}

export async function submitTeamWafThreatPresetRevision(input: { presetId: string; agencyId: string; query: string; actor: string }) {
  const db = await getDb();
  if (!db) throw new Error("Team WAF preset storage is unavailable because the primary database is not configured.");
  const presets = await db.select().from(wafThreatFilterPresets).where(and(eq(wafThreatFilterPresets.presetId, input.presetId), eq(wafThreatFilterPresets.agencyId, input.agencyId))).limit(1);
  const preset = presets[0]; if (!preset) throw new Error("Team WAF preset was not found in your agency scope.");
  const existing = await db.select({ version: max(wafThreatFilterPresetRevisions.version) }).from(wafThreatFilterPresetRevisions).where(eq(wafThreatFilterPresetRevisions.presetId, input.presetId));
  const version = (existing[0]?.version ?? 0) + 1; const revisionId = crypto.randomUUID();
  await db.insert(wafThreatFilterPresetRevisions).values({ revisionId, presetId: input.presetId, version, query: input.query, submittedBy: input.actor, status: "pending" });
  return { revisionId, version, status: "pending" as const };
}

export async function listTeamWafThreatPresetRevisions(input: { presetId: string; agencyId: string }) {
  const db = await getDb(); if (!db) return [];
  const presets = await db.select().from(wafThreatFilterPresets).where(and(eq(wafThreatFilterPresets.presetId, input.presetId), eq(wafThreatFilterPresets.agencyId, input.agencyId))).limit(1);
  if (!presets[0]) throw new Error("Team WAF preset was not found in your agency scope.");
  return db.select().from(wafThreatFilterPresetRevisions).where(eq(wafThreatFilterPresetRevisions.presetId, input.presetId)).orderBy(desc(wafThreatFilterPresetRevisions.version));
}

export async function reviewTeamWafThreatPresetRevision(input: { presetId: string; agencyId: string; revisionId: string; reviewer: string; approved: boolean; note: string }) {
  const db = await getDb(); if (!db) throw new Error("Team WAF preset storage is unavailable because the primary database is not configured.");
  const revisions = await db.select().from(wafThreatFilterPresetRevisions).where(and(eq(wafThreatFilterPresetRevisions.revisionId, input.revisionId), eq(wafThreatFilterPresetRevisions.presetId, input.presetId))).limit(1);
  const revision = revisions[0]; if (!revision || revision.status !== "pending") throw new Error("The selected WAF preset revision is not pending approval.");
  await db.transaction(async (tx) => { await tx.update(wafThreatFilterPresetRevisions).set({ status: input.approved ? "approved" : "rejected", reviewedBy: input.reviewer, reviewedAt: new Date(), reviewNote: input.note }).where(eq(wafThreatFilterPresetRevisions.revisionId, input.revisionId)); if (input.approved) await tx.update(wafThreatFilterPresets).set({ query: revision.query, approvalStatus: "approved", activeVersion: revision.version }).where(and(eq(wafThreatFilterPresets.presetId, input.presetId), eq(wafThreatFilterPresets.agencyId, input.agencyId))); });
  return { approved: input.approved, version: revision.version };
}

export async function deleteTeamWafThreatPreset(input: { presetId: string; agencyId: string; actor: string; mayManageAgency: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Team WAF preset storage is unavailable because the primary database is not configured.");
  const rows = await db.select().from(wafThreatFilterPresets).where(and(eq(wafThreatFilterPresets.presetId, input.presetId), eq(wafThreatFilterPresets.agencyId, input.agencyId))).limit(1);
  const preset = rows[0];
  if (!preset) throw new Error("Team WAF preset was not found in your agency scope.");
  if (preset.createdBy !== input.actor && !input.mayManageAgency) throw new Error("Only the preset author or an agency supervisor may remove a shared preset.");
  await db.delete(wafThreatFilterPresets).where(eq(wafThreatFilterPresets.presetId, input.presetId));
  return { deleted: true };
}
