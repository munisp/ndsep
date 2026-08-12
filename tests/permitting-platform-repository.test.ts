import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  advancePermitHandoff,
  appendPermitReviewNote,
  exportPermitAuditHistory,
  extractPermitDocumentToForm,
  getActiveAgencyUser,
  getAuditVerificationKey,
  getPermitCase,
  getPermitCaseForRole,
  getPermitCustodyTimeline,
  getPermittingPlatform,
  listApprovalQueues,
  listMiddlewareComponents,
  listQueueAnalytics,
  listReminderQueue,
  listSigningKeys,
  listSupervisorDigests,
  listSupervisorExceptionAnalytics,
  overridePermitAssignment,
  revokeSigningKey,
  verifyAuditPackage,
  listServiceTopology,
  setActiveAgencyUser,
  updatePermitCaseStage,
  updatePermitFormSections,
  uploadPermitDocumentAndExtract,
} from "../server/permittingPlatformRepository";

const DATA_DIR = path.join(process.cwd(), "server", "data");
const STORE_PATH = path.join(DATA_DIR, "permitting-platform.json");
const UPLOAD_DIR = path.join(process.cwd(), "server", "uploads");

describe("permitting platform repository", () => {
  beforeEach(() => {
    const keyPair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    process.env.AUDIT_PRIVATE_KEY = keyPair.privateKey;
    process.env.AUDIT_PUBLIC_KEY = keyPair.publicKey;
    process.env.AUDIT_PUBLIC_KEY_ID = "test-audit-rsa-key";
    fs.rmSync(STORE_PATH, { force: true });
    fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
  });

  it("hydrates the seeded platform with permit cases, agencies, parity, and agency users", () => {
    const platform = getPermittingPlatform();
    expect(platform.permitCases.length).toBeGreaterThan(0);
    expect(platform.agencies.length).toBeGreaterThan(0);
    expect(platform.agencyUsers.length).toBeGreaterThan(0);
    expect(platform.parity.some((item) => item.surface === "pwa")).toBe(true);
  });

  it("updates permit case stage progression and rebuilds the timeline", () => {
    const updated = updatePermitCaseStage({ caseId: "permit-mining-001", stage: "approval" });
    expect(updated.stage).toBe("approval");
    expect(updated.timeline.find((item) => item.key === "approval")?.completed).toBe(true);
  });

  it("persists editable form updates for sector-specific permit cases", () => {
    const record = getPermitCase("permit-mining-001");
    expect(record).not.toBeNull();
    const updatedSections = record!.formSections.map((section) => ({
      ...section,
      fields: section.fields.map((field) =>
        field.key === "company_name" ? { ...field, value: "Northern Lithium Ventures", source: "manual" as const } : field,
      ),
    }));
    const updated = updatePermitFormSections({
      caseId: "permit-mining-001",
      actorRole: "applicant",
      summary: "Updated summary",
      formSections: updatedSections,
    });
    expect(updated.summary).toBe("Updated summary");
    expect(updated.formSections[0]?.fields.find((field) => field.key === "company_name")?.value).toBe("Northern Lithium Ventures");
  });

  it("switches active agency user and exposes approval queues for the selected role", () => {
    const switched = setActiveAgencyUser({ userId: "user-petroleum-1" });
    expect(switched.role).toBe("petroleum_reviewer");
    expect(getActiveAgencyUser()?.id).toBe("user-petroleum-1");
    expect(listApprovalQueues({ agencyId: "petroleum-regulator" }).some((queue) => queue.id === "queue-petroleum-review")).toBe(true);
  });

  it("stores review notes for role-based approval activity", () => {
    const note = appendPermitReviewNote({
      caseId: "permit-oilgas-014",
      author: "Ijeoma Peters",
      role: "petroleum_reviewer",
      agencyId: "petroleum-regulator",
      decision: "comment",
      note: "HSE attachment accepted for review.",
    });
    expect(note.decision).toBe("comment");
    expect(getPermitCase("permit-oilgas-014")?.reviewNotes[0]?.note).toContain("HSE attachment");
  });

  it("returns role-filtered permit fields for applicant and reviewer contexts", () => {
    const applicantView = getPermitCaseForRole({ caseId: "permit-mining-001", role: "applicant" });
    const reviewerView = getPermitCaseForRole({ caseId: "permit-mining-001", role: "mining_reviewer" });
    expect(applicantView?.formSections.length).toBeGreaterThan(0);
    expect(reviewerView?.formSections.length).toBeGreaterThan(0);
    expect(applicantView?.formSections.flatMap((section) => section.fields).length).toBeGreaterThan(0);
  });

  it("computes queue analytics for SLA and critical-case visibility", () => {
    const analytics = listQueueAnalytics();
    expect(analytics.length).toBeGreaterThan(0);
    expect(analytics.some((item) => item.pendingCount >= 1)).toBe(true);
    expect(analytics.some((item) => item.avgSlaHours >= 48)).toBe(true);
  });

  it("automatically assigns escalated permits to reviewer queues", () => {
    const platform = getPermittingPlatform();
    const criticalCase = platform.permitCases.find((item) => item.id === "permit-oilgas-014");
    expect(criticalCase?.activeAssignment?.assignedUserId).toBeTruthy();
    expect(criticalCase?.auditHistory?.some((event) => event.type === "assignment")).toBe(true);
  });

  it("exposes markdown and csv audit-history exports", async () => {
    const markdown = await exportPermitAuditHistory({ caseId: "permit-mining-001", format: "markdown" });
    const csv = await exportPermitAuditHistory({ caseId: "permit-mining-001", format: "csv" });
    expect(markdown.fileName.endsWith(".md")).toBe(true);
    expect(markdown.content).toContain("Audit history");
    expect(csv.fileName.endsWith(".csv")).toBe(true);
    expect(csv.content).toContain("createdAt,type,actor,role,summary");
    expect(csv.packageMetadata?.sha256).toBeTruthy();
    expect(csv.packageMetadata?.signature).toBeTruthy();
    expect(csv.packageMetadata?.algorithm).toBe("RSA-SHA256");
    expect(csv.packageMetadata?.publicKeyId).toBeTruthy();
  });

  it("publishes the verification key and registry used for externally shared audit packages", () => {
    const key = getAuditVerificationKey();
    expect(key.algorithm).toBe("RSA-SHA256");
    expect(key.keyId).toBeTruthy();
    expect(key.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(key.registry.length).toBeGreaterThan(0);
    expect(key.registry.some((item) => item.active)).toBe(true);
  });

  it("tracks signing-key registry entries and revocation history", () => {
    const keysBefore = listSigningKeys();
    expect(keysBefore.some((item) => item.active)).toBe(true);
    const activeKey = keysBefore.find((item) => item.active);
    expect(activeKey).toBeTruthy();
    const revoked = revokeSigningKey({
      keyId: activeKey!.keyId,
      reason: "Compromised workstation certificate",
      actorName: "Supervisor Integrity Desk",
    });
    expect(revoked.active).toBe(false);
    expect(revoked.revocationReason).toContain("Compromised workstation");
  });

  it("verifies signed audit packages against exported content", async () => {
    const exported = await exportPermitAuditHistory({ caseId: "permit-mining-001", format: "csv" });
    const verification = verifyAuditPackage({
      caseId: "permit-mining-001",
      fileName: exported.fileName,
      content: exported.content,
      sha256: exported.packageMetadata!.sha256,
      signature: exported.packageMetadata!.signature,
    });
    expect(verification.valid).toBe(true);
    expect(verification.hashMatches).toBe(true);
    expect(verification.signatureMatches).toBe(true);
    expect(verification.matchesLatestPackage).toBe(true);
    expect(verification.availability).toBe("available");
  });

  it("fails closed instead of generating a transient audit signing key", async () => {
    delete process.env.AUDIT_PRIVATE_KEY;
    delete process.env.AUDIT_PUBLIC_KEY;
    delete process.env.AUDIT_PUBLIC_KEY_ID;
    const exported = await exportPermitAuditHistory({ caseId: "permit-mining-001", format: "csv" });
    expect(exported.packageMetadata?.signingStatus).toBe("unavailable");
    expect(exported.packageMetadata?.signature).toBe("");
    const verification = verifyAuditPackage({
      caseId: "permit-mining-001",
      fileName: exported.fileName,
      content: exported.content,
      sha256: exported.packageMetadata!.sha256,
      signature: "not-a-real-signature",
    });
    expect(verification.valid).toBe(false);
    expect(verification.availability).toBe("unavailable");
  });

  it("rejects tampered audit content even when a signing key is configured", async () => {
    const exported = await exportPermitAuditHistory({ caseId: "permit-mining-001", format: "csv" });
    const verification = verifyAuditPackage({
      caseId: "permit-mining-001",
      fileName: exported.fileName,
      content: `${exported.content}\nTampered row`,
      sha256: exported.packageMetadata!.sha256,
      signature: exported.packageMetadata!.signature,
    });
    expect(verification.valid).toBe(false);
    expect(verification.hashMatches).toBe(false);
  });

  it("allows planning supervisors to override auto-assigned reviewers", () => {
    const reassigned = overridePermitAssignment({
      caseId: "permit-oilgas-014",
      assignedUserId: "user-env-1",
      actorName: "Tunde Solarin",
      actorRole: "planning_supervisor",
      reason: "Environmental dependency now blocks issuance.",
    });
    expect(reassigned.assignedUserId).toBe("user-env-1");
    expect(reassigned.reason).toContain("Environmental dependency");
    expect(getPermitCase("permit-oilgas-014")?.auditHistory?.some((event) => event.summary.includes("Supervisor reassigned case"))).toBe(true);
  });

  it("lists scheduled reminders, supervisor digests, and supervisor exception analytics for escalated workflows", () => {
    const reminders = listReminderQueue();
    const digests = listSupervisorDigests();
    const supervisorMetrics = listSupervisorExceptionAnalytics();
    expect(reminders.length).toBeGreaterThan(0);
    expect(reminders.some((item) => item.severity === "critical" || item.severity === "warning")).toBe(true);
    expect(digests.length).toBeGreaterThan(0);
    expect(digests.some((item) => item.channel === "email" || item.channel === "in_app")).toBe(true);
    expect(supervisorMetrics.length).toBeGreaterThan(0);
    expect(supervisorMetrics.some((item) => item.escalatedCount >= 0 && item.reassignmentCount >= 0)).toBe(true);
  });

  it("records a chain-of-custody timeline for signed audit package generation and verification", async () => {
    const exported = await exportPermitAuditHistory({ caseId: "permit-mining-001", format: "csv" });
    verifyAuditPackage({
      caseId: "permit-mining-001",
      fileName: exported.fileName,
      content: exported.content,
      sha256: exported.packageMetadata!.sha256,
      signature: exported.packageMetadata!.signature,
    });
    const custody = getPermitCustodyTimeline("permit-mining-001");
    expect(custody.length).toBeGreaterThan(0);
    expect(custody.some((item) => item.action === "generated")).toBe(true);
    expect(custody.some((item) => item.action === "verified")).toBe(true);
  });

  it("advances multi-step approval handoffs through accept and escalate actions", () => {
    overridePermitAssignment({
      caseId: "permit-oilgas-014",
      assignedUserId: "user-env-1",
      actorName: "Tunde Solarin",
      actorRole: "planning_supervisor",
      reason: "Environmental dependency now blocks issuance.",
    });
    const handoffId = getPermitCase("permit-oilgas-014")?.approvalHandoffs?.[0]?.id;
    expect(handoffId).toBeTruthy();
    const accepted = advancePermitHandoff({
      caseId: "permit-oilgas-014",
      handoffId: handoffId!,
      actorName: "Amina Bello",
      actorRole: "environment_reviewer",
      action: "accept",
      note: "Picked up for environmental review.",
    });
    expect(accepted.status).toBe("accepted");
    const escalated = advancePermitHandoff({
      caseId: "permit-oilgas-014",
      handoffId: handoffId!,
      actorName: "Amina Bello",
      actorRole: "environment_reviewer",
      action: "escalate",
      note: "Need planning supervisor intervention.",
    });
    expect(escalated.status).toBe("escalated");
  });

  it("exposes middleware and polyglot service topology for the expanded platform", () => {
    expect(listMiddlewareComponents().some((item) => item.key === "kafka")).toBe(true);
    expect(listServiceTopology().map((item) => item.language)).toEqual(expect.arrayContaining(["typescript", "python", "go", "rust"]));
  });

  it("returns a permit case by identifier", () => {
    const record = getPermitCase("permit-oilgas-014");
    expect(record?.sector).toBe("oil_gas");
    expect(record?.obligations.length).toBeGreaterThan(0);
  });

  it("prefills permit forms from uploaded document text", async () => {
    const result = await extractPermitDocumentToForm({
      caseId: "permit-mining-001",
      documentName: "mining-intake.txt",
      documentText:
        "Company: Atlas Mining PLC\nMineral: Tin\nCadastre Units: 88\nEmail: permits@atlas.ng\nWork Programme: Surface mapping and trenching across two corridors.",
    });
    const companyField = result.caseRecord.formSections.flatMap((section) => section.fields).find((field) => field.key === "company_name");
    expect(companyField?.value).toBeTruthy();
    expect(result.extraction?.documentName).toBe("mining-intake.txt");
    expect(result.extraction?.status).toBe("requires_review");
    expect(["model", "heuristic"]).toContain(result.extraction?.provenance);
    if (result.extraction?.provenance === "heuristic") {
      expect(result.extraction.confidence).toBeNull();
      expect(result.caseRecord.formSections.flatMap((section) => section.fields).find((field) => field.key === "company_name")?.source).toBe("heuristic");
    }
  });

  it("stores uploaded permit documents and extracts fields from portable file uploads", async () => {
    const text = "Operator: Delta Frontier Energy\nBlock: OML-500\nWell: WELL-55\nOperation Type: Offshore intervention";
    const upload = await uploadPermitDocumentAndExtract({
      caseId: "permit-oilgas-014",
      fileName: "petroleum.txt",
      mimeType: "text/plain",
      base64Data: Buffer.from(text, "utf8").toString("base64"),
      uploadedByRole: "petroleum_reviewer",
    });
    expect(upload.uploadedDocument.fileName).toBe("petroleum.txt");
    expect(upload.caseRecord.uploadedDocuments?.length).toBeGreaterThan(0);
    expect(upload.extraction?.populatedKeys.length).toBeGreaterThan(0);
    expect(upload.caseRecord.auditHistory?.some((event) => event.type === "document_upload")).toBe(true);
    expect(upload.extraction?.status).toBe("requires_review");
    expect(upload.uploadedDocument.extractionStatus).toBe("requires_review");
  });
});
