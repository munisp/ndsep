import { describe, expect, it } from "vitest";

import { assessJurisdictionSla, getJurisdictionPolicy } from "../lib/nigeria-jurisdiction-policy";
import fs from "node:fs";
import path from "node:path";
import { afterEach } from "vitest";
import { updateLocalPolicy } from "../server/localPolicyRepository";

const storePath = path.join(process.cwd(), "server", "data", "local-sla-policies.json");
afterEach(() => { if (fs.existsSync(storePath)) fs.rmSync(storePath); });

describe("Nigeria jurisdiction policy", () => {
  it("returns an explicitly local Lagos policy and calculates the configured SLA window", () => {
    const policy = getJurisdictionPolicy("lagos");
    expect(policy?.disclaimer).toContain("not an official Lagos approval rule");
    expect(policy?.checklist.length).toBeGreaterThan(2);
    expect(assessJurisdictionSla("2026-08-12T00:00:00.000Z", policy!, new Date("2026-08-13T00:00:00.000Z"))).toMatchObject({ hoursRemaining: 96, status: "within_sla" });
  });

  it("does not create a jurisdiction policy for the aggregate view", () => {
    expect(getJurisdictionPolicy("all")).toBeNull();
  });

  it("versions an authorized local policy update without claiming official rule status", () => {
    const updated = updateLocalPolicy({ jurisdiction: "kano", slaHours: 72, checklist: ["Evidence reference captured", "Supervisor decision recorded"], reason: "Pilot turnaround adjustment", updatedBy: "admin-subject" });
    expect(updated).toMatchObject({ version: 2, slaHours: 72, updatedBy: "admin-subject" });
    expect(updated.history[0]?.version).toBe(1);
  });
});
