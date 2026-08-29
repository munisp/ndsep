import { describe, expect, it } from "vitest";
import { checkK8sReadiness } from "./k8sReadiness";

describe("checkK8sReadiness", () => {
  it("keeps a repository-only manifest scan explicitly static and not release eligible", () => {
    const report = checkK8sReadiness();
    expect(report.verificationScope).toBe("static_manifest_review");
    expect(report.releaseEligible).toBe(false);
    expect(report.level).toBe("not_ready");
    expect(report.limitations.length).toBeGreaterThan(0);
  });
});
