import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateBreakGlassEvidence } from "../../scripts/ci/generate-break-glass-evidence.mjs";
import { publishBreakGlassAlerts } from "../../scripts/ci/publish-break-glass-alerts.mjs";
import { verifyBreakGlassEvidence } from "../../scripts/ci/verify-break-glass-evidence.mjs";

const repository = "munisp/ndsep";
const commit = "b".repeat(40);
const digest = `sha256:${"a".repeat(64)}`;
const generatedAt = "2026-09-01T01:00:00.000Z";
const originalEnvironment = { ...process.env };
const sourceRoot = resolve(import.meta.dirname, "../..");

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function withEvidence<T>(callback: (evidenceDirectory: string, outputDirectory: string) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(resolve(tmpdir(), "ndsep-break-glass-siem-"));
  try {
    const authorizationVerification = {
      schemaVersion: "ndsep.break-glass-authorization-verification.v1",
      repository,
      authorization: {
        id: "BG-2026-ABCD", sha256: `sha256:${"2".repeat(64)}`, incidentId: "INC-2026-SCHEMA-HOTFIX",
        candidate: { image: "ghcr.io/munisp/ndsep", digest, sourceCommit: commit },
        scope: { services: ["api"] }, expiresAt: "2026-09-01T01:30:00.000Z",
      },
      independentApprovals: [
        { role: "incident_commander", actor: "incident-lead" },
        { role: "release_authority", actor: "release-lead" },
        { role: "database_authority", actor: "database-lead" },
      ],
      noReadinessCredit: true,
    };
    const releaseEvidence = {
      schema: "ndsep.release-evidence.v1",
      image: { name: "ghcr.io/munisp/ndsep", digest },
      source_sha: commit,
      trivy: { high_critical_count: 0 },
      sbom: { sha256: `sha256:${"3".repeat(64)}` },
    };
    const authorizationPath = resolve(directory, "authorization.json");
    const releasePath = resolve(directory, "release.json");
    const cosignPath = resolve(directory, "cosign.json");
    const provenancePath = resolve(directory, "provenance.txt");
    const evidenceDirectory = resolve(directory, "evidence");
    const outputDirectory = resolve(directory, "delivery");
    writeFileSync(authorizationPath, JSON.stringify(authorizationVerification));
    writeFileSync(releasePath, JSON.stringify(releaseEvidence));
    writeFileSync(cosignPath, "[{\"critical\":{}}]\n");
    writeFileSync(provenancePath, "Verified attestation\n");
    await generateBreakGlassEvidence({
      "authorization-verification": authorizationPath,
      "release-evidence": releasePath,
      "cosign-verification": cosignPath,
      "provenance-verification": provenancePath,
      repository,
      "source-commit": commit,
      "candidate-digest": digest,
      "run-id": "42",
      actor: "dispatch-actor",
      "workflow-ref": "https://github.com/munisp/ndsep/actions/workflows/digest-bound-emergency-release.yml@refs/heads/production",
      "generated-at": generatedAt,
      "out-dir": evidenceDirectory,
    });
    return await callback(evidenceDirectory, outputDirectory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("break-glass SIEM and pager evidence integration", () => {
  it("verifies every copied artifact, root binding, and audit-chain link before disclosure", async () => {
    await withEvidence(async evidenceDirectory => {
      const verified = await verifyBreakGlassEvidence(evidenceDirectory);
      expect(verified.candidate).toEqual({ image: "ghcr.io/munisp/ndsep", digest, sourceCommit: commit });
      expect(verified.verifiedEventTypes).toEqual([
        "break_glass.authorization_verified",
        "break_glass.candidate_revalidated",
        "break_glass.supply_chain_verified",
        "break_glass.exception_consumed",
      ]);
      expect(verified.noReadinessCredit).toBe(true);
      const auditPath = resolve(evidenceDirectory, "break-glass-audit-events.ndjson");
      writeFileSync(auditPath, `${readFileSync(auditPath, "utf8").replace("exception_consumed", "exception_bypassed")}`);
      await expect(verifyBreakGlassEvidence(evidenceDirectory)).rejects.toThrow(/sha256 mismatch/);
    });
  });

  it("renders a sanitized dry-run delivery receipt without credentials or network access", async () => {
    await withEvidence(async (evidenceDirectory, outputDirectory) => {
      const result = await publishBreakGlassAlerts({ evidenceDir: evidenceDirectory, outDir: outputDirectory, deliver: false });
      expect(result.delivery.mode).toBe("dry-run");
      expect(result.delivery.siem.delivered).toBe(false);
      expect(result.alert.severity).toBe("critical");
      expect(result.alert.deliveryScope).toMatch(/no deployment performed/);
      const receipt = readFileSync(result.receiptPath, "utf8");
      expect(receipt).toContain("break-glass authorization evidence only");
      expect(receipt).not.toContain("test-token");
    });
  });

  it("uses idempotent SIEM and PagerDuty payloads only after explicit confirmation", async () => {
    await withEvidence(async (evidenceDirectory, outputDirectory) => {
      const enabledPolicyPath = resolve(outputDirectory, "..", "enabled-alert-policy.json");
      writeFileSync(enabledPolicyPath, JSON.stringify({
        schemaVersion: "ndsep.break-glass-alert-delivery-policy.v1",
        policyId: "ndsep-production-break-glass-alert-delivery",
        repository,
        environment: "production-release",
        enabled: true,
        allowedSiemModes: ["splunk-hec", "elastic"],
        pagerDutyEndpoint: "https://events.pagerduty.com/v2/enqueue",
        attestationRequired: true,
        externalImmutableRetentionRequired: true,
        noReadinessCredit: true,
      }));
      process.env.BREAK_GLASS_DELIVERY_CONFIRMATION = "DELIVER_SANITIZED_BREAK_GLASS_EVENTS";
      process.env.BREAK_GLASS_ALERT_DELIVERY_POLICY = enabledPolicyPath;
      process.env.BREAK_GLASS_SIEM_MODE = "splunk-hec";
      process.env.BREAK_GLASS_SIEM_ENDPOINT = "https://siem.example/services/collector/event";
      process.env.BREAK_GLASS_SIEM_TOKEN = "splunk-token-not-written";
      process.env.BREAK_GLASS_SPLUNK_INDEX = "ndsep_security";
      process.env.PAGERDUTY_ROUTING_KEY = "A".repeat(32);
      const calls: Array<{ url: string; init: RequestInit }> = [];
      const fetchImpl = async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: 202 };
      };
      const result = await publishBreakGlassAlerts({ evidenceDir: evidenceDirectory, outDir: outputDirectory, deliver: true }, { fetchImpl });
      expect(result.delivery.siem).toMatchObject({ configured: true, delivered: true, mode: "splunk-hec", status: 202 });
      expect(result.delivery.pagerDuty).toMatchObject({ configured: true, delivered: true, status: 202 });
      expect(calls.map(call => call.url)).toEqual([
        "https://siem.example/services/collector/event",
        "https://events.pagerduty.com/v2/enqueue",
      ]);
      const splunkRequest = JSON.parse(String(calls[0].init.body));
      expect(splunkRequest.event.evidence.rootSha256).toMatch(/^sha256:/);
      expect(splunkRequest.event.audit.noReadinessCredit).toBe(true);
      const pagerRequest = JSON.parse(String(calls[1].init.body));
      expect(pagerRequest.event_action).toBe("trigger");
      expect(pagerRequest.dedup_key).toContain("BG-2026-ABCD");
      expect(JSON.stringify(pagerRequest)).not.toContain("splunk-token-not-written");
    });
  });

  it("keeps source alert delivery disabled and evidence-verified until a reviewed policy change", () => {
    const policy = JSON.parse(readFileSync(resolve(sourceRoot, ".github/security/break-glass-alert-delivery-policy.json"), "utf8"));
    const workflow = readFileSync(resolve(sourceRoot, ".github/workflows/digest-bound-emergency-release.yml"), "utf8");
    const securityGate = readFileSync(resolve(sourceRoot, ".github/workflows/security-gate.yml"), "utf8");
    expect(policy.enabled).toBe(false);
    expect(policy.attestationRequired).toBe(true);
    expect(policy.externalImmutableRetentionRequired).toBe(true);
    expect(workflow).toContain("verify-break-glass-evidence.mjs");
    expect(workflow).toContain("publish-break-glass-alerts.mjs");
    expect(workflow).toContain("DELIVER_SANITIZED_BREAK_GLASS_EVENTS");
    expect(workflow).toContain("BREAK_GLASS_SIEM_TOKEN");
    expect(workflow).toContain("PAGERDUTY_ROUTING_KEY");
    expect(securityGate).toContain("breakGlassSiemPagerIntegration.test.ts");
  });

  it("refuses live delivery until the protected confirmation and valid provider inputs exist", async () => {
    await withEvidence(async (evidenceDirectory, outputDirectory) => {
      process.env.BREAK_GLASS_SIEM_MODE = "elastic";
      process.env.BREAK_GLASS_SIEM_ENDPOINT = "https://siem.example";
      process.env.BREAK_GLASS_SIEM_TOKEN = "unused";
      process.env.PAGERDUTY_ROUTING_KEY = "A".repeat(32);
      await expect(publishBreakGlassAlerts({ evidenceDir: evidenceDirectory, outDir: outputDirectory, deliver: true }))
        .rejects.toThrow(/BREAK_GLASS_DELIVERY_CONFIRMATION/);
    });
  });
});
