import fs from "node:fs";
import path from "node:path";

import { invokeLLM, listLLMModels } from "./_core/llm";
import {
  clonePermittingPlatform,
  type AgencyRole,
  type PermitCaseRecord,
  type PermitFormSectionRecord,
  type PermitReviewNoteRecord,
  type PermitStage,
  type PermittingPlatformSnapshot,
} from "../lib/permitting-domain";

const DATA_DIR = path.join(process.cwd(), "server", "data");
const STORE_PATH = path.join(DATA_DIR, "permitting-platform.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(clonePermittingPlatform(), null, 2));
  }
}

function readStore(): PermittingPlatformSnapshot {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    return JSON.parse(raw) as PermittingPlatformSnapshot;
  } catch {
    const fallback = clonePermittingPlatform();
    fs.writeFileSync(STORE_PATH, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

function writeStore(store: PermittingPlatformSnapshot) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function buildTimeline(stage: PermitStage, updatedAt: string) {
  const order: PermitStage[] = [
    "intake",
    "spatial_clearance",
    "technical_review",
    "environmental_review",
    "agency_coordination",
    "payment_pending",
    "approval",
    "issued",
    "active_monitoring",
  ];
  const labels: Record<PermitStage, string> = {
    intake: "Unified intake",
    spatial_clearance: "Spatial clearance",
    technical_review: "Technical review",
    environmental_review: "Environmental review",
    agency_coordination: "Agency coordination",
    payment_pending: "Payment confirmation",
    approval: "Approval decision",
    issued: "Permit issued",
    active_monitoring: "Active monitoring",
  };
  const rank = order.indexOf(stage);
  return order.map((key, index) => ({
    key,
    label: labels[key],
    completed: index <= rank,
    timestamp: index <= rank ? updatedAt : undefined,
  }));
}

function getRecordOrThrow(store: PermittingPlatformSnapshot, caseId: string) {
  const record = store.permitCases.find((item) => item.id === caseId);
  if (!record) throw new Error("Permit case not found");
  return record;
}

function syncQueueCounts(store: PermittingPlatformSnapshot) {
  store.approvalQueues = store.approvalQueues.map((queue) => {
    const queueCases = store.permitCases.filter((record) => queue.caseIds.includes(record.id));
    const pendingCount = queueCases.length;
    const overdueCount = queueCases.filter((record) => record.priority === "critical" || record.obligations.some((item) => item.status === "at_risk")).length;
    return { ...queue, pendingCount, overdueCount };
  });
}

export function getPermittingPlatform() {
  return readStore();
}

export function listPermitCases() {
  return readStore().permitCases;
}

export function getPermitCase(caseId: string) {
  return readStore().permitCases.find((item) => item.id === caseId) ?? null;
}

export function listAgencies() {
  return readStore().agencies;
}

export function listAgencyUsers() {
  return readStore().agencyUsers;
}

export function getActiveAgencyUser() {
  const store = readStore();
  return store.agencyUsers.find((item) => item.id === store.activeAgencyUserId) ?? null;
}

export function setActiveAgencyUser(input: { userId: string }) {
  const store = readStore();
  const user = store.agencyUsers.find((item) => item.id === input.userId);
  if (!user) throw new Error("Agency user not found");
  store.activeAgencyUserId = user.id;
  writeStore(store);
  return user;
}

export function listApprovalQueues() {
  const store = readStore();
  syncQueueCounts(store);
  writeStore(store);
  return store.approvalQueues;
}

export function listMiddlewareComponents() {
  return readStore().middleware;
}

export function listServiceTopology() {
  return readStore().services;
}

export function listParityState() {
  return readStore().parity;
}

export function updatePermitCaseStage(input: { caseId: string; stage: PermitStage }) {
  const store = readStore();
  const record = getRecordOrThrow(store, input.caseId);
  const updatedAt = new Date().toISOString();
  record.stage = input.stage;
  record.updatedAt = updatedAt;
  record.timeline = buildTimeline(input.stage, updatedAt);
  syncQueueCounts(store);
  writeStore(store);
  return record;
}

export function updatePermitFormSections(input: { caseId: string; formSections: PermitFormSectionRecord[]; summary?: string | null }) {
  const store = readStore();
  const record = getRecordOrThrow(store, input.caseId);
  record.formSections = input.formSections;
  if (input.summary) record.summary = input.summary;
  record.updatedAt = new Date().toISOString();
  writeStore(store);
  return record;
}

export function appendPermitReviewNote(input: {
  caseId: string;
  author: string;
  role: AgencyRole;
  agencyId: string | null;
  decision: PermitReviewNoteRecord["decision"];
  note: string;
}) {
  const store = readStore();
  const record = getRecordOrThrow(store, input.caseId);
  const reviewNote: PermitReviewNoteRecord = {
    id: `note-${Date.now()}`,
    author: input.author,
    role: input.role,
    agencyId: input.agencyId,
    decision: input.decision,
    note: input.note,
    createdAt: new Date().toISOString(),
  };
  record.reviewNotes.unshift(reviewNote);
  record.updatedAt = reviewNote.createdAt;
  if (input.decision === "approved" && record.stage === "approval") {
    record.stage = "issued";
    record.timeline = buildTimeline("issued", reviewNote.createdAt);
  }
  syncQueueCounts(store);
  writeStore(store);
  return reviewNote;
}

function applyExtractedFields(record: PermitCaseRecord, extracted: Array<{ key: string; value: string }>) {
  const populatedKeys: string[] = [];
  record.formSections = record.formSections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => {
      const matched = extracted.find((item) => item.key === field.key);
      if (!matched || !matched.value) return field;
      populatedKeys.push(field.key);
      return {
        ...field,
        value: matched.value,
        source: "ai",
      };
    }),
  }));
  return populatedKeys;
}

function heuristicExtraction(record: PermitCaseRecord, documentText: string) {
  const lower = documentText.toLowerCase();
  const values: Array<{ key: string; value: string }> = [];
  const addIf = (key: string, patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = documentText.match(pattern);
      if (match?.[1]) {
        values.push({ key, value: match[1].trim() });
        return;
      }
    }
  };

  if (record.sector === "mining") {
    addIf("company_name", [/company[:\-]\s*(.+)/i, /applicant[:\-]\s*(.+)/i]);
    addIf("mineral_type", [/mineral[:\-]\s*(.+)/i, /commodity[:\-]\s*(.+)/i]);
    addIf("cadastre_units", [/cadastre units?[:\-]\s*(.+)/i]);
    addIf("contact_email", [/email[:\-]\s*([^\s]+)/i]);
    addIf("work_programme_summary", [/work programme[:\-]\s*(.+)/i, /program summary[:\-]\s*(.+)/i]);
    addIf("financial_capability", [/financial capability[:\-]\s*(.+)/i]);
    addIf("landowner_consent", [/landowner consent[:\-]\s*(.+)/i]);
  }

  if (record.sector === "oil_gas") {
    addIf("operator_name", [/operator[:\-]\s*(.+)/i]);
    addIf("block_reference", [/block[:\-]\s*(.+)/i, /oml[:\-]?\s*(.+)/i]);
    addIf("well_identifier", [/well[:\-]\s*(.+)/i]);
    addIf("operation_type", [/operation type[:\-]\s*(.+)/i]);
    addIf("spill_response_plan", [/spill response[:\-]\s*(.+)/i]);
    addIf("abandonment_security", [/abandonment security[:\-]\s*(.+)/i, /bond[:\-]\s*(.+)/i]);
    addIf("local_approvals", [/local approvals?[:\-]\s*(.+)/i]);
  }

  if (values.length === 0 && lower.length > 0) {
    const firstTextField = record.formSections.flatMap((section) => section.fields).find((field) => field.fieldType !== "number");
    if (firstTextField) values.push({ key: firstTextField.key, value: documentText.slice(0, 180) });
  }

  return values;
}

export async function extractPermitDocumentToForm(input: { caseId: string; documentName: string; documentText: string }) {
  const store = readStore();
  const record = getRecordOrThrow(store, input.caseId);
  let extracted: Array<{ key: string; value: string }> = [];
  let model = "heuristic-fallback";

  try {
    const models = await listLLMModels();
    model = models.data.find((item) => item.id === "gpt-5-mini")?.id ?? models.data[0]?.id ?? "gpt-5-mini";
    const response = await Promise.race([
      invokeLLM({
        model,
        messages: [
        { role: "system", content: "Extract permit intake fields from the document text and return JSON only." },
        {
          role: "user",
          content: `Sector: ${record.sector}\nExpected field keys: ${record.formSections
            .flatMap((section) => section.fields)
            .map((field) => field.key)
            .join(", ")}\n\nDocument text:\n${input.documentText}`,
        },
      ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "permit_form_extraction",
            strict: true,
            schema: {
              type: "object",
              properties: {
                extracted: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      key: { type: "string" },
                      value: { type: "string" },
                    },
                    required: ["key", "value"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["extracted"],
              additionalProperties: false,
            },
          },
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("LLM extraction timeout")), 1200)),
    ]);
    const content = response.choices[0]?.message?.content;
    const parsed = typeof content === "string" ? JSON.parse(content) : { extracted: [] };
    extracted = Array.isArray(parsed.extracted) ? parsed.extracted : [];
  } catch {
    extracted = heuristicExtraction(record, input.documentText);
  }

  if (extracted.length === 0) {
    extracted = heuristicExtraction(record, input.documentText);
  }

  const populatedKeys = applyExtractedFields(record, extracted);
  record.lastAiExtraction = {
    documentName: input.documentName,
    extractedAt: new Date().toISOString(),
    model,
    populatedKeys,
  };
  record.updatedAt = record.lastAiExtraction.extractedAt;
  writeStore(store);
  return {
    caseRecord: record,
    extraction: record.lastAiExtraction,
  };
}

export function upsertPermitCase(input: PermitCaseRecord) {
  const store = readStore();
  const existingIndex = store.permitCases.findIndex((item) => item.id === input.id);
  if (existingIndex >= 0) {
    store.permitCases[existingIndex] = input;
  } else {
    store.permitCases.unshift(input);
  }
  syncQueueCounts(store);
  writeStore(store);
  return input;
}
