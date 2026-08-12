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
  verificationState: "unverified";
  origin: "offline_queue" | "online";
  recordedAt: string;
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

export function recordFieldEvidence(input: Omit<FieldEvidenceManifest, "recordedAt">) {
  const records = readStore();
  const existing = records.find((record) => record.id === input.id);
  if (existing) return { status: "duplicate" as const, evidence: existing };
  const evidence: FieldEvidenceManifest = { ...input, recordedAt: new Date().toISOString() };
  records.unshift(evidence);
  writeStore(records);
  return { status: "recorded" as const, evidence };
}
