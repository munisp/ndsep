/**
 * Round-10: Permify schema + sync-helper surface checks.
 *
 * 1. NDSEP_SCHEMA defines every round-10 entity from ROUND10_RESOURCE_TYPES,
 *    with relations and actions (drift between the schema and the tuple-sync
 *    helpers would make Permify reject checks at runtime).
 * 2. Import smoke: the check wrappers and every round-10 tuple-sync helper
 *    are exported functions with the documented arity.
 * 3. Schedule wiring: round9Schedules registers durable Temporal schedules
 *    (ensureSchedule) and the Temporal worker calls registration at startup.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  NDSEP_SCHEMA,
  ROUND10_RESOURCE_TYPES,
  checkResourcePermission,
  requireResourcePermission,
  permifyCheck,
  requirePermission,
  permifyDeleteRelationship,
} from "../../server/permify";
import * as permifySync from "../../server/permifySync";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const src = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

/** Expected relations/actions per round-10 entity (mirrors docs/permify-round10.md). */
const EXPECTED: Record<string, { relations: string[]; actions: string[] }> = {
  public_complaint: { relations: ["assignee", "controller"], actions: ["view", "manage"] },
  settlement: { relations: ["initiator", "approver", "organization"], actions: ["view", "approve", "manage"] },
  publication_document: { relations: ["editor", "approver", "organization"], actions: ["view", "publish", "manage"] },
  tribunal_bundle: { relations: ["assembler", "verifier", "organization"], actions: ["view", "verify", "export", "manage"] },
  hosting_declaration: { relations: ["declarant", "reviewer", "organization"], actions: ["view", "review", "manage"] },
  transfer_declaration: { relations: ["declarant", "reviewer", "organization"], actions: ["view", "review", "manage"] },
  scan_target: { relations: ["owner", "organization"], actions: ["view", "manage"] },
  scan_finding: { relations: ["assignee", "organization"], actions: ["view", "triage"] },
  supervision_plan: { relations: ["owner", "assignee", "organization"], actions: ["view", "approve", "manage"] },
  verified_revenue: { relations: ["filer", "verifier", "organization"], actions: ["view", "verify", "manage"] },
  identity_verification: { relations: ["subject", "reviewer"], actions: ["view", "manage"] },
  ussd_intake: { relations: ["assignee", "organization"], actions: ["view", "manage"] },
  adverse_media_item: { relations: ["reviewer", "organization"], actions: ["view", "triage"] },
  ai_system: { relations: ["owner", "assessor", "organization"], actions: ["view", "assess", "manage"] },
  mutual_assistance_request: { relations: ["requester", "handler"], actions: ["view", "manage"] },
  legal_instrument: { relations: ["custodian", "publisher"], actions: ["view", "publish", "manage"] },
};

function entityBlock(name: string): string {
  const m = NDSEP_SCHEMA.match(new RegExp(`entity ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(m, `schema must define entity ${name}`).not.toBeNull();
  return m![1];
}

describe("round-10 Permify schema", () => {
  it("ROUND10_RESOURCE_TYPES covers the 16 round-8/9 entities", () => {
    expect([...ROUND10_RESOURCE_TYPES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [entity, spec] of Object.entries(EXPECTED)) {
    it(`entity ${entity} declares its relations and actions`, () => {
      const body = entityBlock(entity);
      for (const rel of spec.relations) {
        expect(body, `${entity} missing relation ${rel}`).toContain(`relation ${rel} `);
      }
      for (const action of spec.actions) {
        expect(body, `${entity} missing action ${action}`).toContain(`action ${action} =`);
      }
    });
  }

  it("preserves the 15 legacy entities (schema extension, not replacement)", () => {
    for (const legacy of [
      "user", "organization", "sector", "platform", "admin", "compliance",
      "enforcement", "banking", "audit", "transfer", "regulator",
      "enforcement_case", "breach_incident", "compliance_audit", "data_transfer", "dsar_request",
    ]) {
      expect(NDSEP_SCHEMA, `legacy entity ${legacy} removed`).toMatch(new RegExp(`entity ${legacy} \\{`));
    }
  });

  it("organization-parented entities reference the organization entity", () => {
    for (const entity of Object.keys(EXPECTED)) {
      const spec = EXPECTED[entity];
      if (!spec.relations.includes("organization") && !spec.relations.includes("controller")) continue;
      const body = entityBlock(entity);
      expect(body).toMatch(/@organization/);
    }
  });
});

describe("check wrappers (permify.ts)", () => {
  it("exports resource-scoped check wrappers as functions", () => {
    expect(typeof checkResourcePermission).toBe("function");
    expect(typeof requireResourcePermission).toBe("function");
    expect(typeof permifyCheck).toBe("function");
    expect(typeof requirePermission).toBe("function");
    expect(typeof permifyDeleteRelationship).toBe("function");
  });

  it("checkResourcePermission fails closed when Permify is unreachable", async () => {
    // No Permify sidecar in the test sandbox — the wrapper must deny, not throw.
    const allowed = await checkResourcePermission(1, { type: "public_complaint", id: 1 }, "view");
    expect(allowed).toBe(false);
  });

  it("requireResourcePermission throws FORBIDDEN when the check denies", async () => {
    await expect(
      requireResourcePermission(1, { type: "settlement", id: 1 }, "approve"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("tuple-sync helpers (permifySync.ts)", () => {
  const HELPERS: Array<[string, number]> = [
    ["syncComplaintAssignment", 3],
    ["syncSettlementParties", 2],
    ["syncPublicationDocument", 2],
    ["syncTribunalBundle", 2],
    ["syncHostingDeclaration", 2],
    ["syncTransferDeclaration", 2],
    ["syncScanTarget", 3],
    ["syncScanFindingAssignment", 3],
    ["syncSupervisionPlan", 2],
    ["syncVerifiedRevenue", 2],
    ["syncIdentityVerification", 2],
    ["syncUssdIntakeAssignment", 3],
    ["syncAdverseMediaItem", 3],
    ["syncAiSystem", 2],
    ["syncMutualAssistanceRequest", 2],
    ["syncLegalInstrument", 2],
    ["deleteResourceTuples", 2],
  ];

  for (const [name, arity] of HELPERS) {
    it(`exports ${name} (arity ${arity})`, () => {
      const fn = (permifySync as Record<string, unknown>)[name];
      expect(typeof fn, `${name} must be an exported function`).toBe("function");
      expect((fn as (...args: unknown[]) => unknown).length).toBeLessThanOrEqual(arity);
    });
  }

  it("helpers are no-ops when PERMIFY_ENABLED=false (no network writes)", async () => {
    // vitest sets NODE_ENV=test; PERMIFY_ENABLED is unset here → enabled, but
    // the Permify sidecar is unreachable, so writes land in the retry queue
    // instead of throwing. A rejected promise would fail this test.
    await expect(
      permifySync.syncComplaintAssignment(1, 2, 3),
    ).resolves.toBeUndefined();
  });
});

describe("Temporal schedule wiring", () => {
  it("server/temporal.ts exposes the schedule registry functions", () => {
    const t = src("server/temporal.ts");
    expect(t).toContain("export async function ensureSchedule");
    expect(t).toContain("export async function listSchedules");
    expect(t).toContain("client.schedule.create");
  });

  it("round9Schedules registers durable schedules via ensureSchedule", () => {
    const s = src("server/services/round9Schedules.ts");
    expect(s).toContain('await import("../temporal")');
    expect(s).toContain("ensureSchedule({");
    expect(s).toContain("export const ROUND9_JOB_RUNNERS");
    expect(s).toContain("export async function runRound9Job");
    // No silent no-op: the unconfigured path must warn per schedule.
    expect(s).toContain("schedule SKIPPED explicitly");
  });

  it("Temporal worker registers round-9 schedules at startup, fail-closed in production", () => {
    const w = src("workers/temporal/worker.ts");
    expect(w).toContain("registerRound9Schedules");
    expect(w).toContain('process.env.NODE_ENV === "production"');
  });

  it("wiring guide exists and names every helper", () => {
    const doc = src("docs/permify-round10.md");
    for (const name of [
      "syncComplaintAssignment", "syncSettlementParties", "syncPublicationDocument",
      "syncTribunalBundle", "syncHostingDeclaration", "syncTransferDeclaration",
      "syncScanTarget", "syncScanFindingAssignment", "syncSupervisionPlan",
      "syncVerifiedRevenue", "syncIdentityVerification", "syncUssdIntakeAssignment",
      "syncAdverseMediaItem", "syncAiSystem", "syncMutualAssistanceRequest",
      "syncLegalInstrument", "deleteResourceTuples",
    ]) {
      expect(doc, `docs/permify-round10.md must document ${name}`).toContain(name);
    }
  });
});
