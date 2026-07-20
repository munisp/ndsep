import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { getPermittingPlatform, getPermitCase, listMiddlewareComponents, listServiceTopology, updatePermitCaseStage } from "../server/permittingPlatformRepository";

const DATA_DIR = path.join(process.cwd(), "server", "data");
const STORE_PATH = path.join(DATA_DIR, "permitting-platform.json");

describe("permitting platform repository", () => {
  beforeEach(() => {
    fs.rmSync(STORE_PATH, { force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
  });

  it("hydrates the seeded platform with permit cases, agencies, and parity state", () => {
    const platform = getPermittingPlatform();
    expect(platform.permitCases.length).toBeGreaterThan(0);
    expect(platform.agencies.length).toBeGreaterThan(0);
    expect(platform.parity.some((item) => item.surface === "pwa")).toBe(true);
  });

  it("updates permit case stage progression and rebuilds the timeline", () => {
    const updated = updatePermitCaseStage({ caseId: "permit-mining-001", stage: "approval" });
    expect(updated.stage).toBe("approval");
    expect(updated.timeline.find((item) => item.key === "approval")?.completed).toBe(true);
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
});
