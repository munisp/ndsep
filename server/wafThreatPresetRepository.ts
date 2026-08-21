import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { wafThreatFilterPresets } from "../drizzle/schema";
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
  await db.insert(wafThreatFilterPresets).values({ presetId, agencyId: input.agencyId, name: input.name, query: input.query, createdBy: input.createdBy });
  return { presetId };
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
