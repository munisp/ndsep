import fs from "node:fs";
import path from "node:path";

import { NIGERIA_JURISDICTION_POLICIES, type NigeriaJurisdictionKey } from "../lib/nigeria-jurisdiction-policy";

export type LocalPolicyRecord = {
  jurisdiction: NigeriaJurisdictionKey;
  label: string;
  slaHours: number;
  checklist: string[];
  disclaimer: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
  changeReason: string;
  history: Array<{ version: number; updatedAt: string; updatedBy: string; changeReason: string; slaHours: number; checklist: string[] }>;
};

const STORE_PATH = path.join(process.cwd(), "server", "data", "local-sla-policies.json");

function defaults(): LocalPolicyRecord[] {
  return Object.values(NIGERIA_JURISDICTION_POLICIES).map((policy) => ({ ...policy, version: 1, updatedAt: "", updatedBy: "local-default", changeReason: "Initial local pilot policy", history: [] }));
}
function readStore() {
  try { return fs.existsSync(STORE_PATH) ? (JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as LocalPolicyRecord[]) : defaults(); } catch { return defaults(); }
}
function writeStore(records: LocalPolicyRecord[]) { fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true }); fs.writeFileSync(STORE_PATH, JSON.stringify(records, null, 2)); }

export function listLocalPolicies() { return readStore(); }
export function updateLocalPolicy(input: { jurisdiction: NigeriaJurisdictionKey; slaHours: number; checklist: string[]; reason: string; updatedBy: string }) {
  const records = readStore();
  const index = records.findIndex((item) => item.jurisdiction === input.jurisdiction);
  if (index < 0) throw new Error("Local jurisdiction policy was not found.");
  const current = records[index];
  const updatedAt = new Date().toISOString();
  const next: LocalPolicyRecord = { ...current, slaHours: input.slaHours, checklist: input.checklist, version: current.version + 1, updatedAt, updatedBy: input.updatedBy, changeReason: input.reason, history: [{ version: current.version, updatedAt: current.updatedAt, updatedBy: current.updatedBy, changeReason: current.changeReason, slaHours: current.slaHours, checklist: current.checklist }, ...current.history].slice(0, 20) };
  records[index] = next;
  writeStore(records);
  return next;
}
