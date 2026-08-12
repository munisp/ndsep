import { describe, expect, it } from "vitest";

import { assessJurisdictionSla, getJurisdictionPolicy } from "../lib/nigeria-jurisdiction-policy";

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
});
