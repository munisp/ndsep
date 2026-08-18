import { describe, expect, it } from "vitest";
import { buildStakeholderSyncDiagnostics } from "../lib/stakeholder-sync-diagnostics-format";

describe("stakeholder support diagnostics", () => {
  it("excludes private paths, idempotency keys, and raw technical errors from ordinary exports", () => { const exportData = buildStakeholderSyncDiagnostics([{ id: "internal-id", idempotencyKey: "secret-key", kind: "profile", label: "Profile", queuedAt: "2026-08-18T00:00:00.000Z", status: "failed", retryCount: 1, payloadPath: "file:///private/sealed", lastErrorCode: "transport_failed", lastErrorMessage: "NIN 12345678901 failed provider check" }]); expect(JSON.stringify(exportData)).not.toContain("secret-key"); expect(JSON.stringify(exportData)).not.toContain("file:///private/sealed"); expect(JSON.stringify(exportData)).not.toContain("12345678901"); });
  it("retains technical detail only for a package that will be encrypted", () => expect(JSON.stringify(buildStakeholderSyncDiagnostics([{ id: "internal-id", idempotencyKey: "secret-key", kind: "profile", label: "Profile", queuedAt: "2026-08-18T00:00:00.000Z", status: "failed", retryCount: 1, payloadPath: "file:///private/sealed", lastErrorCode: "transport_failed", lastErrorMessage: "Authorized diagnostic detail" }], true))).toContain("Authorized diagnostic detail"));
});
