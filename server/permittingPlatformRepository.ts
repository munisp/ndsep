import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as pdfParseModule from "pdf-parse";

import { invokeLLM, listLLMModels } from "./_core/llm";
import { analyzeDocumentImage } from "./mobilePlatformRepository";
import { storagePut } from "./storage";
import {
  clonePermittingPlatform,
  type AgencyRole,
  type AuditSigningKeyRecord,
  type PermitApprovalHandoffRecord,
  type PermitAuditEventRecord,
  type PermitCaseRecord,
  type PermitCustodyEventRecord,
  type PermitFormFieldRecord,
  type PermitFormSectionRecord,
  type PermitReminderRecord,
  type PermitReviewNoteRecord,
  type PermitStage,
  type PermittingPlatformSnapshot,
  type QueueAnalyticsRecord,
  type SupervisorDigestRecord,
  type SupervisorExceptionAnalyticsRecord,
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
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as PermittingPlatformSnapshot;
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

function appendAuditEvent(record: PermitCaseRecord, event: Omit<PermitAuditEventRecord, "id">) {
  const nextEvent: PermitAuditEventRecord = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...event,
  };
  record.auditHistory = record.auditHistory ?? [];
  record.auditHistory.unshift(nextEvent);
  return nextEvent;
}

function appendCustodyEvent(record: PermitCaseRecord, event: Omit<PermitCustodyEventRecord, "id">) {
  const nextEvent: PermitCustodyEventRecord = {
    id: `custody-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...event,
  };
  record.custodyTimeline = record.custodyTimeline ?? [];
  record.custodyTimeline.unshift(nextEvent);
  return nextEvent;
}

function ensureSeedAuditHistory(record: PermitCaseRecord) {
  if (record.auditHistory?.length) return;
  record.auditHistory = [
    {
      id: `audit-seed-${record.id}`,
      createdAt: record.updatedAt,
      actor: "system",
      role: "system" as const,
      type: "status_change" as const,
      summary: `Permit case initialized at ${record.stage.replace(/_/g, " ")}.`,
    },
    ...record.reviewNotes.map((note) => ({
      id: `audit-review-${note.id}`,
      createdAt: note.createdAt,
      actor: note.author,
      role: note.role,
      type: "review_note" as const,
      summary: `${note.decision.replace(/_/g, " ")}: ${note.note}`,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function inferFieldPermissions(record: PermitCaseRecord, field: PermitFormFieldRecord) {
  if (field.viewableBy?.length || field.editableBy?.length) return field;

  const allRoles: AgencyRole[] = [
    "applicant",
    "mining_reviewer",
    "petroleum_reviewer",
    "environment_reviewer",
    "planning_supervisor",
  ];

  const sectorReviewers: AgencyRole[] =
    record.sector === "mining"
      ? ["mining_reviewer", "environment_reviewer", "planning_supervisor"]
      : record.sector === "oil_gas"
        ? ["petroleum_reviewer", "environment_reviewer", "planning_supervisor"]
        : ["planning_supervisor", "environment_reviewer"];

  const reviewerOnly = field.key.includes("financial") || field.key.includes("bond") || field.key.includes("security");
  const editableBy: AgencyRole[] = reviewerOnly ? sectorReviewers : (["applicant", ...sectorReviewers] as AgencyRole[]);

  return {
    ...field,
    viewableBy: allRoles,
    editableBy,
  };
}

function ensureRecordStructure(record: PermitCaseRecord) {
  record.formSections = record.formSections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => inferFieldPermissions(record, field)),
  }));
  record.uploadedDocuments = record.uploadedDocuments ?? [];
  record.activeAssignment = record.activeAssignment ?? null;
  record.approvalHandoffs = record.approvalHandoffs ?? [];
  record.latestAuditPackage = record.latestAuditPackage ?? null;
  record.custodyTimeline = record.custodyTimeline ?? [];
  ensureSeedAuditHistory(record);
  return record;
}

function shouldEscalate(record: PermitCaseRecord) {
  return record.priority === "critical" || record.obligations.some((item) => item.status === "at_risk");
}

function preferredRoles(record: PermitCaseRecord): AgencyRole[] {
  if (record.sector === "mining") return ["mining_reviewer", "environment_reviewer", "planning_supervisor"];
  if (record.sector === "oil_gas") return ["petroleum_reviewer", "environment_reviewer", "planning_supervisor"];
  return ["planning_supervisor", "environment_reviewer"];
}

function upsertApprovalHandoff(record: PermitCaseRecord, handoff: PermitApprovalHandoffRecord) {
  record.approvalHandoffs = record.approvalHandoffs ?? [];
  const existingIndex = record.approvalHandoffs.findIndex((item) => item.id === handoff.id);
  if (existingIndex >= 0) record.approvalHandoffs[existingIndex] = handoff;
  else record.approvalHandoffs.unshift(handoff);
}

function autoAssignEscalations(store: PermittingPlatformSnapshot) {
  for (const record of store.permitCases) {
    ensureRecordStructure(record);
    if (!shouldEscalate(record)) continue;
    const candidateRoles = preferredRoles(record);
    const candidates = store.agencyUsers.filter((user) => candidateRoles.includes(user.role));
    if (!candidates.length) continue;
    const nextAssignee = candidates.sort((a, b) => a.queueIds.length - b.queueIds.length)[0];
    if (!nextAssignee) continue;
    const nextReason = record.priority === "critical" ? "Critical permit priority escalation" : "Obligation risk triggered escalation";
    if (record.activeAssignment?.assignedUserId === nextAssignee.id && record.activeAssignment.reason === nextReason) continue;
    const assignedAt = new Date().toISOString();
    record.activeAssignment = {
      assignedUserId: nextAssignee.id,
      assignedAt,
      reason: nextReason,
      status: "active",
    };
    upsertApprovalHandoff(record, {
      id: `handoff-${record.id}-${nextAssignee.role}`,
      fromRole: "system",
      toRole: nextAssignee.role,
      startedAt: assignedAt,
      dueAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      status: record.priority === "critical" ? "escalated" : "pending",
      reason: nextReason,
    });
    appendAuditEvent(record, {
      createdAt: record.activeAssignment.assignedAt,
      actor: nextAssignee.displayName,
      role: nextAssignee.role,
      type: "assignment",
      summary: `Auto-assigned escalated case to ${nextAssignee.displayName} for ${nextReason.toLowerCase()}.`,
    });
    record.updatedAt = record.activeAssignment.assignedAt;
  }
}

function computeReminderQueue(store: PermittingPlatformSnapshot): PermitReminderRecord[] {
  const reminders = store.permitCases.flatMap((record) =>
    (record.approvalHandoffs ?? [])
      .filter((handoff) => handoff.status !== "completed")
      .map((handoff) => {
        const hoursRemaining = Math.max(0, Math.round((new Date(handoff.dueAt).getTime() - Date.now()) / (1000 * 60 * 60)));
        return {
          id: `reminder-${record.id}-${handoff.id}`,
          caseId: record.id,
          handoffId: handoff.id,
          role: handoff.toRole,
          reminderAt: new Date(Math.max(Date.now(), new Date(handoff.dueAt).getTime() - 1000 * 60 * 60 * 6)).toISOString(),
          dueAt: handoff.dueAt,
          severity: hoursRemaining <= 6 || handoff.status === "escalated" ? "critical" : hoursRemaining <= 24 ? "warning" : "info",
          status: hoursRemaining <= 6 || handoff.status === "escalated" ? "triggered" : "scheduled",
          summary: `${record.title} is due for ${handoff.toRole.replace(/_/g, " ")} review in ${hoursRemaining}h.`,
        } satisfies PermitReminderRecord;
      }),
  );
  store.reminderQueue = reminders.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return store.reminderQueue;
}

function computeSupervisorExceptionAnalytics(store: PermittingPlatformSnapshot): SupervisorExceptionAnalyticsRecord[] {
  const analytics = store.agencies.map((agency) => {
    const relatedCases = store.permitCases.filter((record) => record.leadAgencyId === agency.id || record.participatingAgencyIds.includes(agency.id));
    const escalatedCount = relatedCases.flatMap((record) => record.approvalHandoffs ?? []).filter((handoff) => handoff.status === "escalated").length;
    const reassignmentCount = relatedCases.flatMap((record) => record.auditHistory ?? []).filter((event) => event.summary.includes("Supervisor reassigned case")).length;
    const assignmentHours = relatedCases
      .map((record) => {
        const assignedAt = record.activeAssignment?.assignedAt ? new Date(record.activeAssignment.assignedAt).getTime() : null;
        return assignedAt && record.updatedAt ? Math.max(0, (new Date(record.updatedAt).getTime() - assignedAt) / (1000 * 60 * 60)) : 0;
      })
      .filter((value) => value > 0);
    return {
      agencyId: agency.id,
      escalatedCount,
      reassignmentCount,
      avgHoursToAssignment: assignmentHours.length ? Math.round((assignmentHours.reduce((sum, value) => sum + value, 0) / assignmentHours.length) * 10) / 10 : 0,
      atRiskCaseIds: relatedCases.filter((record) => record.obligations.some((item) => item.status === "at_risk")).map((record) => record.id),
    } satisfies SupervisorExceptionAnalyticsRecord;
  });
  store.supervisorExceptionAnalytics = analytics;
  return analytics;
}

function computeSupervisorDigests(store: PermittingPlatformSnapshot): SupervisorDigestRecord[] {
  const digests = store.agencies.flatMap((agency) => {
    const relatedQueues = store.approvalQueues.filter((queue) => queue.agencyId === agency.id);
    const backlogCount = relatedQueues.reduce((sum, queue) => sum + queue.pendingCount, 0);
    const overdueHandoffs = (store.reminderQueue ?? []).filter((item) => item.status === "triggered" && store.permitCases.some((record) => record.id === item.caseId && (record.leadAgencyId === agency.id || record.participatingAgencyIds.includes(agency.id)))).length;
    if (backlogCount === 0 && overdueHandoffs === 0) return [];
    return [
      {
        id: `digest-email-${agency.id}`,
        agencyId: agency.id,
        generatedAt: new Date().toISOString(),
        channel: "email",
        subject: `${agency.name} queue digest`,
        summary: `${backlogCount} queued reviews and ${overdueHandoffs} overdue handoffs require supervisor attention.`,
        backlogCount,
        overdueHandoffs,
      },
      {
        id: `digest-inapp-${agency.id}`,
        agencyId: agency.id,
        generatedAt: new Date().toISOString(),
        channel: "in_app",
        subject: `${agency.name} supervisor digest`,
        summary: `${backlogCount} queued reviews and ${overdueHandoffs} overdue handoffs require supervisor attention.`,
        backlogCount,
        overdueHandoffs,
      },
    ] satisfies SupervisorDigestRecord[];
  });
  store.supervisorDigests = digests;
  return digests;
}

function computeQueueAnalytics(store: PermittingPlatformSnapshot): QueueAnalyticsRecord[] {
  autoAssignEscalations(store);
  computeReminderQueue(store);
  computeSupervisorExceptionAnalytics(store);
  computeSupervisorDigests(store);
  const analytics = store.approvalQueues.map((queue) => {
    const queueCases = store.permitCases.filter((record) => queue.caseIds.includes(record.id));
    const pendingCount = queueCases.length;
    const overdueCount = queueCases.filter((record) => record.obligations.some((item) => item.status === "at_risk")).length;
    const avgSlaHours = store.agencies.find((agency) => agency.id === queue.agencyId)?.reviewSlaHours ?? 0;
    const breachedCaseIds = queueCases.filter((record) => record.obligations.some((item) => item.status === "at_risk")).map((record) => record.id);
    const criticalCaseIds = queueCases.filter((record) => record.priority === "critical").map((record) => record.id);
    return {
      agencyId: queue.agencyId,
      role: queue.role,
      pendingCount,
      overdueCount,
      avgSlaHours,
      breachedCaseIds,
      criticalCaseIds,
    } satisfies QueueAnalyticsRecord;
  });

  store.queueAnalytics = analytics;
  store.approvalQueues = store.approvalQueues.map((queue) => {
    const metric = analytics.find((item) => item.agencyId === queue.agencyId && item.role === queue.role);
    return {
      ...queue,
      pendingCount: metric?.pendingCount ?? 0,
      overdueCount: metric?.overdueCount ?? 0,
      avgSlaHours: metric?.avgSlaHours ?? 0,
      breachedCaseIds: metric?.breachedCaseIds ?? [],
    };
  });

  return analytics;
}

function getFieldMap(record: PermitCaseRecord) {
  return record.formSections.flatMap((section) => section.fields).map((field) => field.key);
}

function applyExtractedFields(
  record: PermitCaseRecord,
  extracted: Array<{ key: string; value: string }>,
  provenance: "model" | "heuristic" | "unavailable",
) {
  const populatedKeys: string[] = [];
  record.formSections = record.formSections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => {
      const matched = extracted.find((item) => item.key === field.key);
      if (!matched?.value) return inferFieldPermissions(record, field);
      populatedKeys.push(field.key);
      return inferFieldPermissions(record, { ...field, value: matched.value, source: provenance === "heuristic" ? "heuristic" : "ai" });
    }),
  }));
  return populatedKeys;
}

function heuristicExtraction(record: PermitCaseRecord, documentText: string) {
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

  if (values.length === 0 && documentText.trim()) {
    const firstTextField = record.formSections.flatMap((section) => section.fields).find((field) => field.fieldType !== "number");
    if (firstTextField) values.push({ key: firstTextField.key, value: documentText.slice(0, 180) });
  }
  return values;
}

async function runStructuredExtraction(record: PermitCaseRecord, documentText: string) {
  let model: string | null = null;
  try {
    const models = await listLLMModels();
    model = models.data.find((item) => item.id.includes("llama"))?.id ?? models.data[0]?.id ?? null;
    if (!model) {
      return {
        extracted: heuristicExtraction(record, documentText),
        model: null,
        confidence: null,
        provenance: "heuristic" as const,
        status: "requires_review" as const,
        reason: "No structured extraction model is configured. Values were derived only from visible label-pattern rules.",
      };
    }
    const response = await Promise.race([
      invokeLLM({
        model,
        messages: [
          { role: "system", content: "Extract permit intake fields from the document text and return strict JSON only." },
          {
            role: "user",
            content: `Sector: ${record.sector}\nExpected field keys: ${getFieldMap(record).join(", ")}\n\nDocument text:\n${documentText}`,
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
                confidence: { type: "number" },
              },
              required: ["extracted", "confidence"],
              additionalProperties: false,
            },
          },
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("LLM extraction timeout")), 1200)),
    ]);
    const content = response.choices[0]?.message?.content;
    const parsed = typeof content === "string" ? JSON.parse(content) : { extracted: [], confidence: 0 };
    return {
      extracted: Array.isArray(parsed.extracted) ? parsed.extracted : [],
      model,
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
      provenance: "model" as const,
      status: "requires_review" as const,
      reason: "Model-assisted extraction requires reviewer confirmation before any permit decision.",
    };
  } catch (error) {
    return {
      extracted: heuristicExtraction(record, documentText),
      model,
      confidence: null,
      provenance: "heuristic" as const,
      status: "requires_review" as const,
      reason: `Structured extraction failed: ${error instanceof Error ? error.message : "unknown error"}. Values were derived only from visible label-pattern rules.`,
    };
  }
}

async function extractTextFromUpload(input: { mimeType: string; buffer: Buffer }) {
  if (input.mimeType.includes("pdf")) {
    try {
      const pdfParse = (pdfParseModule as unknown as { default?: (buffer: Buffer) => Promise<{ text?: string }> }).default;
      if (!pdfParse) {
        return { text: "", sourceType: "pdf" as const, status: "unavailable" as const, reason: "No PDF parser is available; binary bytes were not treated as extracted text." };
      }
      const parsed = await pdfParse(input.buffer);
      const text = parsed.text?.trim() || "";
      return text
        ? { text, sourceType: "pdf" as const, status: "processed" as const, reason: null }
        : { text: "", sourceType: "pdf" as const, status: "requires_review" as const, reason: "The PDF yielded no extractable text and requires an OCR-capable review path." };
    } catch (error) {
      return { text: "", sourceType: "pdf" as const, status: "unavailable" as const, reason: `PDF parsing failed: ${error instanceof Error ? error.message : "unknown error"}. Binary bytes were not treated as document text.` };
    }
  }
  if (input.mimeType.startsWith("image/")) {
    return { text: "", sourceType: "image" as const, status: "pending" as const, reason: null };
  }
  return { text: input.buffer.toString("utf8"), sourceType: "text" as const, status: "processed" as const, reason: null };
}

function buildFieldPairsFromVisionResult(result: Awaited<ReturnType<typeof analyzeDocumentImage>>) {
  return Object.entries(result.extractedFields ?? {})
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([key, value]) => ({ key, value }));
}

function serializeAuditAsMarkdown(record: PermitCaseRecord) {
  const lines = [
    `# Audit history for ${record.title}`,
    "",
    `- Permit ID: ${record.id}`,
    `- Sector: ${record.sector}`,
    `- Stage: ${record.stage}`,
    `- Priority: ${record.priority}`,
    "",
    "## Events",
    "",
  ];
  for (const event of record.auditHistory ?? []) {
    lines.push(`- ${event.createdAt} | ${event.type} | ${event.actor} | ${event.summary}`);
  }
  return lines.join("\n");
}

function serializeAuditAsCsv(record: PermitCaseRecord) {
  const header = "createdAt,type,actor,role,summary";
  const rows = (record.auditHistory ?? []).map((event) =>
    [event.createdAt, event.type, event.actor, event.role, event.summary]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header, ...rows].join("\n");
}

function getAuditSigningConfiguration() {
  const privateKey = process.env.AUDIT_PRIVATE_KEY?.replace(/\\n/g, "\n") || null;
  const publicKey = process.env.AUDIT_PUBLIC_KEY?.replace(/\\n/g, "\n") || null;
  const keyId = process.env.AUDIT_PUBLIC_KEY_ID || null;
  if (!privateKey || !publicKey || !keyId) {
    return {
      available: false as const,
      privateKey: null,
      publicKey: null,
      keyId: null,
      reason: "Audit signing is unavailable because AUDIT_PRIVATE_KEY, AUDIT_PUBLIC_KEY, and AUDIT_PUBLIC_KEY_ID must all be configured. No transient signing key was generated.",
    };
  }
  return { available: true as const, privateKey, publicKey, keyId, reason: null };
}

function buildSigningKeyRegistry(): AuditSigningKeyRecord[] {
  const config = getAuditSigningConfiguration();
  if (!config.available) return [];
  const activeKey: AuditSigningKeyRecord = {
    keyId: config.keyId,
    algorithm: "RSA-SHA256",
    publicKeyPem: config.publicKey,
    createdAt: new Date().toISOString(),
    active: true,
  };
  return [activeKey];
}

function signAuditContent(content: string) {
  const config = getAuditSigningConfiguration();
  const sha256 = crypto.createHash("sha256").update(content).digest("hex");
  if (!config.available) {
    return { sha256, signature: "", algorithm: "RSA-SHA256", publicKeyId: null, signingStatus: "unavailable" as const, reason: config.reason };
  }
  const signature = crypto.sign("RSA-SHA256", Buffer.from(sha256, "utf8"), config.privateKey).toString("base64");
  return { sha256, signature, algorithm: "RSA-SHA256", publicKeyId: config.keyId, signingStatus: "configured" as const, reason: null };
}

function verifySignedAuditContent(input: { content: string; sha256: string; signature: string }) {
  const config = getAuditSigningConfiguration();
  const recalculatedHash = crypto.createHash("sha256").update(input.content).digest("hex");
  if (!config.available) {
    return { hashMatches: recalculatedHash === input.sha256, signatureMatches: false, recalculatedHash, availability: "unavailable" as const, reason: config.reason };
  }
  const signatureMatches = crypto.verify("RSA-SHA256", Buffer.from(recalculatedHash, "utf8"), config.publicKey, Buffer.from(input.signature, "base64"));
  return {
    hashMatches: recalculatedHash === input.sha256,
    signatureMatches,
    recalculatedHash,
    availability: "available" as const,
    reason: null,
  };
}

export function getPermittingPlatform() {
  const store = readStore();
  store.permitCases = store.permitCases.map((record) => ensureRecordStructure(record));
  store.signingKeys = buildSigningKeyRegistry();
  computeQueueAnalytics(store);
  writeStore(store);
  return store;
}

export function listPermitCases() {
  return getPermittingPlatform().permitCases;
}

export function getPermitCase(caseId: string) {
  return getPermittingPlatform().permitCases.find((item) => item.id === caseId) ?? null;
}

export function getPermitCaseForRole(input: { caseId: string; role: AgencyRole }) {
  const record = getPermitCase(input.caseId);
  if (!record) return null;
  return {
    ...record,
    formSections: record.formSections.map((section) => ({
      ...section,
      fields: section.fields.filter((field) => !field.viewableBy || field.viewableBy.includes(input.role)),
    })),
  };
}

export function exportPermitAuditHistory(input: { caseId: string; format: "markdown" | "csv" }) {
  const store = getPermittingPlatform();
  const record = getRecordOrThrow(store, input.caseId);
  const content = input.format === "csv" ? serializeAuditAsCsv(record) : serializeAuditAsMarkdown(record);
  const { sha256, signature, algorithm, publicKeyId, signingStatus, reason } = signAuditContent(content);
  const fileName = `${record.id}-audit-history.${input.format === "csv" ? "csv" : "md"}`;
  const generatedAt = new Date().toISOString();
  record.latestAuditPackage = {
    generatedAt,
    format: input.format,
    fileName,
    sha256,
    signature,
    signedBy: signingStatus === "configured" ? "configured-audit-signer" : "unavailable",
    algorithm,
    publicKeyId: publicKeyId ?? undefined,
    signingStatus,
    verifierHint:
      signingStatus === "configured"
        ? "Verify by recomputing the SHA-256 hash of the exported file and validating the RSA-SHA256 signature with the published audit verification key."
        : `This export is unsigned and cannot be independently verified. ${reason}`,
  };
  appendCustodyEvent(record, {
    packageType: "audit",
    packageRef: fileName,
    occurredAt: generatedAt,
    actor: signingStatus === "configured" ? "configured-audit-signer" : "system",
    role: "system",
    action: "generated",
    summary:
      signingStatus === "configured"
        ? `Audit package ${fileName} generated with signing key ${publicKeyId}.`
        : `Audit export ${fileName} generated without a signature because audit key configuration is unavailable.`,
  });
  writeStore(store);
    return {
      fileName,
      mimeType: input.format === "csv" ? "text/csv" : "text/markdown",
      content,
      packageMetadata: record.latestAuditPackage,
    };
}

export function getAuditVerificationKey() {
  const config = getAuditSigningConfiguration();
  return {
    available: config.available,
    keyId: config.keyId,
    algorithm: "RSA-SHA256",
    publicKeyPem: config.publicKey,
    registry: buildSigningKeyRegistry(),
    reason: config.reason,
  };
}

export function verifyAuditPackage(input: {
  caseId?: string;
  fileName: string;
  content: string;
  sha256: string;
  signature: string;
}) {
  const verification = verifySignedAuditContent(input);
  const platform = getPermittingPlatform();
  const linkedCase = input.caseId ? platform.permitCases.find((item) => item.id === input.caseId) ?? null : null;
  const matchesLatestPackage = !!linkedCase?.latestAuditPackage && linkedCase.latestAuditPackage.sha256 === input.sha256 && linkedCase.latestAuditPackage.signature === input.signature;
  if (linkedCase) {
    appendCustodyEvent(linkedCase, {
      packageType: "audit",
      packageRef: input.fileName,
      occurredAt: new Date().toISOString(),
      actor: "external verifier",
      role: "system",
      action: "verified",
      summary:
        verification.availability === "available"
          ? `Audit package ${input.fileName} verification result: ${verification.hashMatches && verification.signatureMatches ? "valid" : "invalid"}.`
          : `Audit package ${input.fileName} could not be independently verified because audit key configuration is unavailable.`,
    });
    writeStore(platform);
  }
  return {
    fileName: input.fileName,
    valid: verification.availability === "available" && verification.hashMatches && verification.signatureMatches,
    hashMatches: verification.hashMatches,
    signatureMatches: verification.signatureMatches,
    recalculatedHash: verification.recalculatedHash,
    matchesLatestPackage,
    linkedCaseId: linkedCase?.id ?? null,
    verificationKey: getAuditVerificationKey(),
    keyRegistry: platform.signingKeys ?? buildSigningKeyRegistry(),
    availability: verification.availability,
    reason: verification.reason,
  };
}

export function overridePermitAssignment(input: {
  caseId: string;
  assignedUserId: string;
  actorName: string;
  actorRole: AgencyRole;
  reason: string;
}) {
  const store = getPermittingPlatform();
  const record = getRecordOrThrow(store, input.caseId);
  const user = store.agencyUsers.find((item) => item.id === input.assignedUserId);
  if (!user) throw new Error("Agency user not found");
  const assignedAt = new Date().toISOString();
  record.activeAssignment = {
    assignedUserId: user.id,
    assignedAt,
    reason: input.reason,
    status: "active",
  };
  upsertApprovalHandoff(record, {
    id: `handoff-${record.id}-${user.role}`,
    fromRole: input.actorRole,
    toRole: user.role,
    startedAt: assignedAt,
    dueAt: new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString(),
    status: "pending",
    reason: input.reason,
  });
  record.updatedAt = assignedAt;
  appendAuditEvent(record, {
    createdAt: assignedAt,
    actor: input.actorName,
    role: input.actorRole,
    type: "assignment",
    summary: `Supervisor reassigned case to ${user.displayName} with reason: ${input.reason}`,
  });
  writeStore(store);
  return record.activeAssignment;
}

export function advancePermitHandoff(input: {
  caseId: string;
  handoffId: string;
  actorName: string;
  actorRole: AgencyRole;
  action: "accept" | "complete" | "escalate";
  note: string;
}) {
  const store = getPermittingPlatform();
  const record = getRecordOrThrow(store, input.caseId);
  const handoff = (record.approvalHandoffs ?? []).find((item) => item.id === input.handoffId);
  if (!handoff) throw new Error("Approval handoff not found");
  const timestamp = new Date().toISOString();
  if (input.action === "accept") {
    handoff.status = "accepted";
  } else if (input.action === "complete") {
    handoff.status = "completed";
    handoff.dueAt = timestamp;
  } else {
    handoff.status = "escalated";
    handoff.dueAt = new Date(Date.now() + 1000 * 60 * 60 * 6).toISOString();
  }
  record.updatedAt = timestamp;
  appendAuditEvent(record, {
    createdAt: timestamp,
    actor: input.actorName,
    role: input.actorRole,
    type: "assignment",
    summary: `Approval handoff ${input.action}ed by ${input.actorName}: ${input.note}`,
  });
  writeStore(store);
  return handoff;
}

export function listReminderQueue(role?: AgencyRole) {
  const platform = getPermittingPlatform();
  const reminders = platform.reminderQueue ?? computeReminderQueue(platform);
  return role ? reminders.filter((item) => item.role === role) : reminders;
}

export function listSupervisorExceptionAnalytics() {
  const platform = getPermittingPlatform();
  return platform.supervisorExceptionAnalytics ?? computeSupervisorExceptionAnalytics(platform);
}

export function listSupervisorDigests() {
  const platform = getPermittingPlatform();
  return platform.supervisorDigests ?? computeSupervisorDigests(platform);
}

export function listSigningKeys() {
  return getPermittingPlatform().signingKeys ?? buildSigningKeyRegistry();
}

export function revokeSigningKey(input: { keyId: string; reason: string; actorName: string }) {
  const platform = getPermittingPlatform();
  const key = (platform.signingKeys ?? buildSigningKeyRegistry()).find((item) => item.keyId === input.keyId);
  if (!key) throw new Error("Signing key not found");
  key.active = false;
  key.revokedAt = new Date().toISOString();
  key.revocationReason = input.reason;
  platform.signingKeys = (platform.signingKeys ?? buildSigningKeyRegistry()).map((item) => (item.keyId === key.keyId ? key : item));
  platform.permitCases.forEach((record) => {
    if (record.latestAuditPackage?.publicKeyId === key.keyId) {
      appendCustodyEvent(record, {
        packageType: "audit",
        packageRef: record.latestAuditPackage.fileName,
        occurredAt: key.revokedAt!,
        actor: input.actorName,
        role: "system",
        action: "revoked",
        summary: `Signing key ${key.keyId} revoked for audit package ${record.latestAuditPackage.fileName}: ${input.reason}`,
      });
    }
  });
  writeStore(platform);
  return key;
}

export function getPermitCustodyTimeline(caseId: string) {
  return getPermitCase(caseId)?.custodyTimeline ?? [];
}

export function listAgencies() {
  return getPermittingPlatform().agencies;
}

export function listAgencyUsers() {
  return getPermittingPlatform().agencyUsers;
}

export function getActiveAgencyUser() {
  const store = getPermittingPlatform();
  return store.agencyUsers.find((item) => item.id === store.activeAgencyUserId) ?? null;
}

export function setActiveAgencyUser(input: { userId: string }) {
  const store = getPermittingPlatform();
  const user = store.agencyUsers.find((item) => item.id === input.userId);
  if (!user) throw new Error("Agency user not found");
  store.activeAgencyUserId = user.id;
  writeStore(store);
  return user;
}

export function listApprovalQueues(input?: { agencyId?: string; role?: AgencyRole }) {
  const store = getPermittingPlatform();
  return store.approvalQueues.filter((queue) => {
    if (input?.agencyId && queue.agencyId !== input.agencyId) return false;
    if (input?.role && queue.role !== input.role) return false;
    return true;
  });
}

export function listQueueAnalytics() {
  return getPermittingPlatform().queueAnalytics ?? [];
}

export function listMiddlewareComponents() {
  return getPermittingPlatform().middleware;
}

export function listServiceTopology() {
  return getPermittingPlatform().services;
}

export function listParityState() {
  return getPermittingPlatform().parity;
}

export function updatePermitCaseStage(input: { caseId: string; stage: PermitStage }) {
  const store = getPermittingPlatform();
  const record = getRecordOrThrow(store, input.caseId);
  const updatedAt = new Date().toISOString();
  record.stage = input.stage;
  record.updatedAt = updatedAt;
  record.timeline = buildTimeline(input.stage, updatedAt);
  appendAuditEvent(record, {
    createdAt: updatedAt,
    actor: "system",
    role: "system",
    type: "status_change",
    summary: `Case moved to ${input.stage.replace(/_/g, " ")}.`,
  });
  computeQueueAnalytics(store);
  writeStore(store);
  return record;
}

export function updatePermitFormSections(input: { caseId: string; formSections: PermitFormSectionRecord[]; summary?: string | null; actorRole?: AgencyRole }) {
  const store = getPermittingPlatform();
  const record = getRecordOrThrow(store, input.caseId);
  const actorRole = input.actorRole ?? getActiveAgencyUser()?.role ?? "applicant";
  record.formSections = input.formSections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => {
      const current = record.formSections.flatMap((item) => item.fields).find((item) => item.key === field.key);
      const guarded = inferFieldPermissions(record, { ...(current ?? field), ...field });
      if (guarded.editableBy && !guarded.editableBy.includes(actorRole) && current) return current;
      return guarded;
    }),
  }));
  if (typeof input.summary === "string") record.summary = input.summary;
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
  const store = getPermittingPlatform();
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
  appendAuditEvent(record, {
    createdAt: reviewNote.createdAt,
    actor: input.author,
    role: input.role,
    type: "review_note",
    summary: `${input.decision.replace(/_/g, " ")}: ${input.note}`,
  });
  if (input.decision === "approved" && record.stage === "approval") {
    record.stage = "issued";
    record.timeline = buildTimeline("issued", reviewNote.createdAt);
  }
  computeQueueAnalytics(store);
  writeStore(store);
  return reviewNote;
}

export async function extractPermitDocumentToForm(input: { caseId: string; documentName: string; documentText: string }) {
  const store = getPermittingPlatform();
  const record = getRecordOrThrow(store, input.caseId);
  const result = await runStructuredExtraction(record, input.documentText);
  const populatedKeys = applyExtractedFields(record, result.extracted, result.provenance);
  const extraction = {
    documentName: input.documentName,
    extractedAt: new Date().toISOString(),
    model: result.model,
    populatedKeys,
    sourceType: "text" as const,
    confidence: result.confidence,
    provenance: result.provenance,
    status: result.status,
    reason: result.reason,
  };
  record.lastAiExtraction = extraction;
  record.updatedAt = extraction.extractedAt;
  appendAuditEvent(record, {
    createdAt: extraction.extractedAt,
    actor: "system",
    role: "system",
    type: "ai_extraction",
    summary: `${result.provenance === "model" ? "Model-assisted" : "Rule-based"} text extraction populated ${populatedKeys.length} fields from ${input.documentName}; reviewer confirmation is required.`,
  });
  writeStore(store);
  return { caseRecord: record, extraction: record.lastAiExtraction };
}

export async function uploadPermitDocumentAndExtract(input: {
  caseId: string;
  fileName: string;
  mimeType: string;
  base64Data: string;
  uploadedByRole: AgencyRole;
}) {
  const store = getPermittingPlatform();
  const record = getRecordOrThrow(store, input.caseId);
  const buffer = Buffer.from(input.base64Data, "base64");
  const uploaded = await storagePut(`permits/${input.caseId}/${input.fileName}`, buffer, input.mimeType);
  const extractedSource = await extractTextFromUpload({ mimeType: input.mimeType, buffer });

  let extracted: Array<{ key: string; value: string }> = [];
  let model: string | null = null;
  let confidence: number | null = null;
  let provenance: "model" | "heuristic" | "unavailable" = "unavailable";
  let extractionStatus: "processed" | "requires_review" | "unavailable" | "failed" = extractedSource.status === "unavailable" ? "unavailable" : "requires_review";
  let extractionReason: string | null = extractedSource.reason;

  if (extractedSource.sourceType === "image") {
    const analysis = await analyzeDocumentImage({
      fileName: input.fileName,
      mimeType: input.mimeType,
      base64Data: input.base64Data,
      documentType: `${record.sector}-permit`,
    });
    extracted = buildFieldPairsFromVisionResult(analysis);
    model = analysis.model;
    confidence = analysis.confidence;
    provenance = analysis.provenance === "model_assisted" ? "model" : "unavailable";
    extractionStatus = analysis.availability === "available" ? "requires_review" : "unavailable";
    extractionReason = analysis.reason;
    if (!extracted.length && analysis.availability === "available" && analysis.summary) {
      const fallback = await runStructuredExtraction(record, analysis.summary);
      extracted = fallback.extracted;
      model = fallback.model;
      confidence = fallback.confidence;
      provenance = fallback.provenance;
      extractionStatus = fallback.status;
      extractionReason = fallback.reason;
    }
  } else if (extractedSource.status !== "unavailable") {
    const structured = await runStructuredExtraction(record, extractedSource.text);
    extracted = structured.extracted;
    model = structured.model;
    confidence = structured.confidence;
    provenance = structured.provenance;
    extractionStatus = structured.status;
    extractionReason = structured.reason;
  }

  const uploadedAt = new Date().toISOString();
  const populatedKeys = applyExtractedFields(record, extracted, provenance);
  const uploadedDocument = {
    id: `doc-${Date.now()}`,
    fileName: input.fileName,
    mimeType: input.mimeType,
    storagePath: uploaded.key,
    publicUrl: uploaded.url,
    uploadedAt,
    uploadedByRole: input.uploadedByRole,
    extractedTextPreview:
      extractedSource.sourceType === "image"
        ? extractionStatus === "unavailable"
          ? extractionReason || `Automated image analysis is unavailable for ${input.fileName}.`
          : `Model-assisted image screening for ${input.fileName}; reviewer confirmation is required.`
        : extractedSource.text.slice(0, 320) || extractionReason || "No extractable text was produced.",
    extractionStatus,
  };
  record.uploadedDocuments = record.uploadedDocuments ?? [];
  record.uploadedDocuments.unshift(uploadedDocument);
  record.lastAiExtraction = {
    documentName: input.fileName,
    extractedAt: uploadedAt,
    model,
    populatedKeys,
    sourceType: extractedSource.sourceType,
    confidence,
    provenance,
    status: extractionStatus,
    reason: extractionReason,
  };
  record.updatedAt = uploadedAt;
  appendAuditEvent(record, {
    createdAt: uploadedAt,
    actor: input.uploadedByRole,
    role: input.uploadedByRole,
    type: "document_upload",
    summary: `Uploaded ${input.fileName}; extraction status is ${extractionStatus} with ${populatedKeys.length} populated fields.`,
  });
  appendAuditEvent(record, {
    createdAt: uploadedAt,
    actor: "system",
    role: "system",
    type: "ai_extraction",
    summary:
      provenance === "model"
        ? `Model-assisted extraction completed for ${input.fileName}; reviewer confirmation is required.`
        : provenance === "heuristic"
          ? `Rule-based extraction completed for ${input.fileName}; this is not an AI-verified result and requires reviewer confirmation.`
          : `Automated extraction was unavailable for ${input.fileName}; no verified result was produced.`,
  });
  writeStore(store);
  return { caseRecord: record, extraction: record.lastAiExtraction, uploadedDocument };
}

export function upsertPermitCase(input: PermitCaseRecord) {
  const store = getPermittingPlatform();
  const normalized = ensureRecordStructure(input);
  const existingIndex = store.permitCases.findIndex((item) => item.id === input.id);
  if (existingIndex >= 0) store.permitCases[existingIndex] = normalized;
  else store.permitCases.unshift(normalized);
  computeQueueAnalytics(store);
  writeStore(store);
  return normalized;
}
