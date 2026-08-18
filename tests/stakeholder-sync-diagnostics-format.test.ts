import { describe, expect, it } from "vitest";
import { buildStakeholderSyncDiagnostics } from "../lib/stakeholder-sync-diagnostics-format";

describe("stakeholder support diagnostics", () => {
  it("excludes encrypted payload locations and idempotency keys", () => { const exportData = buildStakeholderSyncDiagnostics([{ id: "internal-id", idempotencyKey: "secret-key", kind: "profile", label: "Profile", queuedAt: "2026-08-18T00:00:00.000Z", status: "failed", retryCount: 1, payloadPath: "file:///private/sealed", lastErrorCode: "transport_failed" }]); expect(JSON.stringify(exportData)).not.toContain("secret-key"); expect(JSON.stringify(exportData)).not.toContain("file:///private/sealed"); });
});
