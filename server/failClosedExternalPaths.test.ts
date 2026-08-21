import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("fail-closed external integration paths", () => {
  it("does not synthesize NIMC verification from identifier input", () => {
    const source = read("server/routers/phase12Features.ts");
    expect(source).toContain("verifyNationalId");
    expect(source).toContain("SERVICE_UNAVAILABLE");
    expect(source).not.toContain("Deterministic verification based on ID hash");
    expect(source).not.toContain("verified successfully via NIMC API");
  });

  it("requires a configured NIMC bridge and rejects a simulator in production", () => {
    const source = read("server/nationalIdProvider.ts");
    expect(source).toContain("NIMC_NVS_URL");
    expect(source).toContain("NIMC_NVS_TOKEN");
    expect(source).toContain("simulation_forbidden");
    expect(source).toContain("NDSEP_ALLOW_TEST_PROVIDER_EMULATORS");
  });

  it("does not return estimated ART robustness results when its worker is unavailable", () => {
    const source = read("server/routers/aimlRouter.ts");
    expect(source).toContain("no adversarial-test result was produced");
    expect(source).not.toContain(
      "showing deterministic estimates based on epsilon"
    );
    expect(source).not.toContain("clean_accuracy: 0.87");
  });

  it("does not return a null or mock WireDigger response on an outage", () => {
    const source = read("server/routers/wiredigg.ts");
    expect(source).toContain("WireDigger service is unavailable");
    expect(source).toContain("WireDigger service is not configured");
    expect(source).not.toContain("returning mock");
    expect(source).not.toContain("return null;");
  });
});
