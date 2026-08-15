import fs from "node:fs";
import path from "node:path";

export type FieldEvidenceManifest = {
  id: string;
  missionId: string;
  parcelId: number;
  observationType: "boundary_marker" | "occupancy" | "encroachment" | "infrastructure" | "community_engagement" | "other";
  notes: string;
  capturedAt: string;
  coordinateSource: "parcel_reference" | "operator_entered" | "unavailable";
  latitude: number | null;
  longitude: number | null;
  attachmentCount: number;
  attachments: Array<{
    id: string;
    kind: "photo" | "file";
    name: string;
    mimeType: string | null;
    size: number | null;
    localUri: string;
    persistence: "app_document_directory" | "browser_session";
    capturedAt: string;
  }>;
  verificationState: "unverified" | "approved" | "rejected";
  origin: "offline_queue" | "online";
  recordedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewReason: string | null;
  assignedSupervisor: string | null;
  assignedAt: string | null;
  reviewDueAt: string | null;
  escalatedAt: string | null;
  escalatedBy: string | null;
  escalationStatus: "pending" | "acknowledged" | "resolved" | null;
  escalationNote: string | null;
  escalationUpdatedAt: string | null;
  escalationOwner: string | null;
  escalationHandoffDate: string | null;
};

const STORE_PATH = path.join(process.cwd(), "server", "data", "field-evidence.json");

function readStore(): FieldEvidenceManifest[] {
  try {
    return fs.existsSync(STORE_PATH) ? (JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as FieldEvidenceManifest[]) : [];
  } catch {
    return [];
  }
}

function writeStore(records: FieldEvidenceManifest[]) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(records, null, 2));
}

export function listFieldEvidence(missionId?: string) {
  const records = readStore();
  return (missionId ? records.filter((record) => record.missionId === missionId) : records).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export function recordFieldEvidence(input: Omit<FieldEvidenceManifest, "recordedAt" | "reviewedAt" | "reviewedBy" | "reviewReason" | "assignedSupervisor" | "assignedAt" | "reviewDueAt" | "escalatedAt" | "escalatedBy" | "escalationStatus" | "escalationNote" | "escalationUpdatedAt" | "escalationOwner" | "escalationHandoffDate">) {
  const records = readStore();
  const existing = records.find((record) => record.id === input.id);
  if (existing) return { status: "duplicate" as const, evidence: existing };
  const evidence: FieldEvidenceManifest = { ...input, attachmentCount: input.attachments.length, recordedAt: new Date().toISOString(), reviewedAt: null, reviewedBy: null, reviewReason: null, assignedSupervisor: null, assignedAt: null, reviewDueAt: null, escalatedAt: null, escalatedBy: null, escalationStatus: null, escalationNote: null, escalationUpdatedAt: null, escalationOwner: null, escalationHandoffDate: null };
  records.unshift(evidence);
  writeStore(records);
  return { status: "recorded" as const, evidence };
}

export function reviewFieldEvidence(input: { id: string; decision: "approved" | "rejected"; reviewer: string; reason: string }) {
  const records = readStore();
  const index = records.findIndex((record) => record.id === input.id);
  if (index < 0) throw new Error("Field evidence manifest was not found.");
  const existing = records[index];
  if (existing.verificationState !== "unverified") {
    return { status: "already_reviewed" as const, evidence: existing };
  }
  const evidence: FieldEvidenceManifest = {
    ...existing,
    verificationState: input.decision,
    reviewedAt: new Date().toISOString(),
    reviewedBy: input.reviewer,
    reviewReason: input.reason,
  };
  records[index] = evidence;
  writeStore(records);
  return { status: "reviewed" as const, evidence };
}

export function assignFieldEvidenceSupervisor(input: { id: string; supervisor: string; assignedBy: string }) {
  const records = readStore();
  const index = records.findIndex((record) => record.id === input.id);
  if (index < 0) throw new Error("Field evidence manifest was not found.");
  const existing = records[index];
  if (existing.verificationState !== "unverified") return { status: "already_reviewed" as const, evidence: existing };
  const assignedAt = new Date().toISOString();
  const evidence: FieldEvidenceManifest = { ...existing, assignedSupervisor: input.supervisor, assignedAt, reviewDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() };
  records[index] = evidence;
  writeStore(records);
  return { status: "assigned" as const, evidence };
}

export function escalateFieldEvidence(input: { id: string; escalatedBy: string }) {
  const records = readStore(); const index = records.findIndex((record) => record.id === input.id);
  if (index < 0) throw new Error("Field evidence manifest was not found.");
  const existing = records[index];
  if (existing.verificationState !== "unverified") return { status: "already_reviewed" as const, evidence: existing };
  const evidence: FieldEvidenceManifest = { ...existing, escalatedAt: existing.escalatedAt ?? new Date().toISOString(), escalatedBy: existing.escalatedBy ?? input.escalatedBy, escalationStatus: existing.escalationStatus ?? "pending", escalationUpdatedAt: new Date().toISOString() };
  records[index] = evidence; writeStore(records); return { status: "escalated" as const, evidence };
}

export function acknowledgeFieldEvidenceEscalation(input: { id: string; status: "acknowledged" | "resolved"; note: string; owner: string; handoffDate: string | null; updatedBy: string }) {
  const records = readStore(); const index = records.findIndex((record) => record.id === input.id);
  if (index < 0) throw new Error("Field evidence manifest was not found.");
  const existing = records[index]; if (!existing.escalatedAt) throw new Error("Only an escalated manifest can be acknowledged.");
  const evidence: FieldEvidenceManifest = { ...existing, escalationStatus: input.status, escalationNote: input.note, escalationOwner: input.owner, escalationHandoffDate: input.handoffDate, escalationUpdatedAt: new Date().toISOString() };
  records[index] = evidence; writeStore(records); return { status: "updated" as const, evidence };
}
