import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  appendPermitReviewNote,
  exportPermitAuditHistory,
  extractPermitDocumentToForm,
  getActiveAgencyUser,
  getPermitCase,
  getPermitCaseForRole,
  getPermittingPlatform,
  listApprovalQueues,
  listMiddlewareComponents,
  listQueueAnalytics,
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

  it("exposes markdown and csv audit-history exports", () => {
    const markdown = exportPermitAuditHistory({ caseId: "permit-mining-001", format: "markdown" });
    const csv = exportPermitAuditHistory({ caseId: "permit-mining-001", format: "csv" });
    expect(markdown.fileName.endsWith(".md")).toBe(true);
    expect(markdown.content).toContain("Audit history");
    expect(csv.fileName.endsWith(".csv")).toBe(true);
    expect(csv.content).toContain("createdAt,type,actor,role,summary");
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
  });
});
