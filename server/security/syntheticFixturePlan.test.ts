import { describe, expect, it } from "vitest";
import {
  evaluateSyntheticFixtureCoverage,
  loadSyntheticFixturePlan,
  requireSyntheticFixtureScenario,
  validateSyntheticFixturePlan,
} from "../../scripts/lib/synthetic-fixture-plan.mjs";

const manifestUrl = new URL("../../scripts/fixtures/uncovered-table-scenario-manifest.json", import.meta.url);

async function loadManifest() {
  return loadSyntheticFixturePlan(manifestUrl);
}

describe("synthetic fixture-plan governance", () => {
  it("classifies every currently identified static seed gap exactly once", async () => {
    const manifest = await loadManifest();
    const { fixtureTables, exemptTables } = validateSyntheticFixturePlan(manifest);
    expect(fixtureTables).toHaveLength(73);
    expect(exemptTables).toHaveLength(5);
    expect(new Set([...fixtureTables, ...exemptTables]).size).toBe(78);
  });

  it("permits only declared runtime-owned empty tables and never credits readiness", async () => {
    const manifest = await loadManifest();
    const report = evaluateSyntheticFixtureCoverage(
      { emptyTables: ["event_store", "field_encryption_status"] },
      manifest,
      new Date("2026-08-31T00:00:00.000Z")
    );
    expect(report).toEqual({
      allPublicTablesPopulated: false,
      scenarioComplete: true,
      missingFixtureTables: [],
      runtimeOwnedEmptyTables: ["event_store", "field_encryption_status"],
      unplannedEmptyTables: [],
      expiredRuntimeExemptions: [],
      noReadinessCredit: true,
    });
    expect(requireSyntheticFixtureScenario(report)).toBe(report);
  });

  it("fails closed for an empty required fixture table or an unplanned empty table", async () => {
    const manifest = await loadManifest();
    const report = evaluateSyntheticFixtureCoverage(
      { emptyTables: ["ai_ethics_reviews", "a_table_missing_from_the_plan"] },
      manifest,
      new Date("2026-08-31T00:00:00.000Z")
    );
    expect(report.scenarioComplete).toBe(false);
    expect(report.missingFixtureTables).toEqual(["ai_ethics_reviews"]);
    expect(report.unplannedEmptyTables).toEqual(["a_table_missing_from_the_plan"]);
    expect(() => requireSyntheticFixtureScenario(report)).toThrow(
      "missing fixture: ai_ethics_reviews, unplanned empty table: a_table_missing_from_the_plan"
    );
  });

  it("fails closed when an exemption is expired even when its table is populated", async () => {
    const manifest = await loadManifest();
    const report = evaluateSyntheticFixtureCoverage(
      { emptyTables: [] },
      manifest,
      new Date("2027-01-01T00:00:00.000Z")
    );
    expect(report.scenarioComplete).toBe(false);
    expect(report.expiredRuntimeExemptions).toHaveLength(5);
    expect(() => requireSyntheticFixtureScenario(report)).toThrow("expired exemption: enforcement_summary");
  });

  it("rejects a manifest that overlaps fixture requirements with a readiness-crediting exemption", () => {
    expect(() =>
      validateSyntheticFixturePlan({
        schemaVersion: 1,
        fixtureRequired: { events: "A detailed fixture strategy that meets the minimum description length." },
        runtimeOwnedExemptions: {
          events: {
            ownerRole: "SRE",
            reason: "A detailed runtime ownership explanation that meets the minimum description length.",
            expiresAt: "2026-12-31T00:00:00.000Z",
            readinessCredit: true,
          },
        },
      })
    ).toThrow("A table cannot be both fixture-required and runtime-exempt");
  });
});
