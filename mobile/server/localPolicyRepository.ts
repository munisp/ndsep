import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

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

function escapePdf(value: string) { return value.replace(/([\\()])/g, "\\$1").replace(/[\r\n]+/g, " "); }
function pdfBuffer(lines: string[]) {
  const content = [`BT`, `/F1 11 Tf`, `50 780 Td`, ...lines.flatMap((line, index) => index === 0 ? [`(${escapePdf(line)}) Tj`] : [`0 -15 Td`, `(${escapePdf(line)}) Tj`]), `ET`].join("\n");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}
export function exportLocalPolicyHistoryPdf() {
  const policies = listLocalPolicies();
  const lines = [
    "IDLR-PTS Local SLA Policy History",
    "LOCAL CONFIGURATION ONLY - NOT OFFICIAL STATE POLICY",
    `Generated: ${new Date().toISOString()}`,
    ...policies.flatMap((policy) => [
      `${policy.label} | version ${policy.version} | ${policy.slaHours}h`,
      `Reason: ${policy.changeReason}`,
      ...policy.history.slice(0, 3).map((entry) => `Prior v${entry.version}: ${entry.slaHours}h | ${entry.changeReason}`),
    ]),
  ];
  const pdf = pdfBuffer(lines.slice(0, 42));
  return { fileName: `idlr-pts-local-sla-policy-history-${new Date().toISOString().slice(0, 10)}.pdf`, mimeType: "application/pdf", contentBase64: pdf.toString("base64"), sha256: crypto.createHash("sha256").update(pdf).digest("hex"), trustStatus: "unsigned_no_signing_service" as const, disclaimer: "Integrity hash included. No signing service is configured; this PDF is not a government-issued or cryptographically signed policy." };
}
