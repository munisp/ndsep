/**
 * transferRiskForecast service tests (round 13, W5 / P1.6).
 *
 * Covers the blending rule matrix (static × forecast probability), the 24h
 * per-country cache, persistence to transfer_risk_forecasts, feedback
 * baseline minting, and the fail-closed degradation paths (OI unavailable
 * with no key — the runForecast dep double-checks custody by asserting the
 * service never invents a forecast when the engine says unavailable).
 */
import { describe, it, expect, vi } from "vitest";

import {
  blendRisk,
  upgradeOne,
  buildForecastQuestion,
  forecastTransferRisk,
  listLatestForecasts,
  FEEDBACK_SURFACE,
  type TransferRiskDeps,
} from "./transferRiskForecast";
import type { ForecastOutcome } from "../osiris/forecastClient";

// ─── Pure blending matrix ────────────────────────────────────────────────────

describe("blendRisk — static × probability matrix", () => {
  const statics = ["none", "elevated", "high", "critical"] as const;
  const probs = [null, 0.1, 0.19, 0.2, 0.59, 0.6, 0.95] as const;

  it("covers the full matrix against expected levels", () => {
    const expected: Record<string, string> = {
      // static critical stays critical, always
      "critical/null": "critical", "critical/0.1": "critical", "critical/0.19": "critical",
      "critical/0.2": "critical", "critical/0.59": "critical", "critical/0.6": "critical", "critical/0.95": "critical",
      // p>=0.6 upgrades one level
      "none/0.6": "elevated", "none/0.95": "elevated",
      "elevated/0.6": "high", "elevated/0.95": "high",
      "high/0.6": "critical", "high/0.95": "critical",
      // below threshold → static
      "none/null": "none", "none/0.1": "none", "none/0.19": "none", "none/0.2": "none", "none/0.59": "none",
      "elevated/null": "elevated", "elevated/0.1": "elevated", "elevated/0.19": "elevated",
      "elevated/0.2": "elevated", "elevated/0.59": "elevated",
      "high/null": "high", "high/0.1": "high", "high/0.19": "high", "high/0.2": "high", "high/0.59": "high",
    };
    for (const s of statics) {
      for (const p of probs) {
        const key = `${s}/${p}`;
        const { blended } = blendRisk(s, p);
        expect(blended, key).toBe(expected[key]);
      }
    }
  });

  it("tags the applied rule", () => {
    expect(blendRisk("critical", 0.9).rule).toBe("static-critical-preserved");
    expect(blendRisk("high", 0.7).rule).toMatch(/forecast-upgrade/);
    expect(blendRisk("elevated", 0.05).rule).toMatch(/reassuring-kept-static/);
    expect(blendRisk("none", 0.05).rule).toBe("no-change"); // reassuring only named for elevated/high
    expect(blendRisk("high", null).rule).toBe("no-forecast-static-only");
  });

  it("never downgrades, even on p=0", () => {
    for (const s of statics) expect(blendRisk(s, 0).blended).toBe(s);
  });

  it("upgradeOne caps at critical", () => {
    expect(upgradeOne("none")).toBe("elevated");
    expect(upgradeOne("elevated")).toBe("high");
    expect(upgradeOne("high")).toBe("critical");
    expect(upgradeOne("critical")).toBe("critical");
  });
});

describe("buildForecastQuestion", () => {
  it("names country, adverse outcomes and 12-month horizon", () => {
    const q = buildForecastQuestion("Ukraine (UA)");
    expect(q).toContain("Ukraine (UA)");
    expect(q).toMatch(/conflict escalation or sanctions regime change/);
    expect(q).toMatch(/data-hosting risk/);
    expect(q).toMatch(/next 12 months/);
  });
});

// ─── Service behaviour with injected deps ────────────────────────────────────

function makeDeps(overrides: Partial<TransferRiskDeps> = {}) {
  const inserted: unknown[][] = [];
  const outcome: ForecastOutcome = {
    status: "completed",
    transport: "mcp",
    modelKeyPresent: true,
    forecast: {
      forecastProbability: 0.7,
      rationale: "simulation says escalation likely",
      sources: [{ url: "https://src.example/a", title: "A" }],
      completedAt: "2026-02-01T00:00:00.000Z",
    },
  };
  const deps: TransferRiskDeps = {
    exec: vi.fn(async (query: string, params: unknown[] = []) => {
      if (query.includes("SELECT * FROM transfer_risk_forecasts")) return []; // cold cache
      if (query.includes("INSERT INTO transfer_risk_forecasts")) {
        inserted.push(params);
        return [{ id: "11111111-2222-3333-4444-555555555555" }];
      }
      return [];
    }),
    runForecast: vi.fn(async () => outcome),
    staticRisk: () => "high",
    conflictZoneName: () => "Test Zone",
    mintFeedback: vi.fn(async () => "99999999-8888-7777-6666-555555555555"),
    now: () => new Date("2026-02-01T00:00:00.000Z"),
    ...overrides,
  };
  return { deps, inserted, outcome };
}

describe("forecastTransferRisk", () => {
  it("runs, blends, persists (sources + key flag) and mints feedback", async () => {
    const { deps, inserted } = makeDeps();
    const res = await forecastTransferRisk("ua", deps);

    expect(res.countryIso).toBe("UA");
    expect(res.staticRisk).toBe("high");
    expect(res.forecastProbability).toBeCloseTo(0.7);
    expect(res.blendedLevel).toBe("critical"); // high + p>=0.6 → upgrade
    expect(res.forecastStatus).toBe("completed");
    expect(res.fromCache).toBe(false);
    expect(res.modelKeyPresent).toBe(true);
    expect(res.sources).toEqual([{ url: "https://src.example/a", title: "A" }]);
    expect(res.rationale).toMatch(/Static conflict-zone risk for UA: high/);
    expect(res.rationale).toMatch(/0\.70/);
    expect(res.forecastId).toBe("11111111-2222-3333-4444-555555555555");
    expect(res.predictionId).toBe("99999999-8888-7777-6666-555555555555");

    // question content passed to OI
    const [q, ctx] = (deps.runForecast as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(q).toContain("Test Zone (UA)");
    expect(ctx).toMatchObject({ countryIso: "UA", staticConflictRisk: "high", horizonMonths: 12 });

    // persisted row: sources preserved, key flag recorded, probability stored
    expect(inserted).toHaveLength(1);
    const row = inserted[0] as any[];
    expect(row[0]).toBe("UA");
    expect(row[1]).toBe("high");
    expect(row[2]).toBeCloseTo(0.7);
    expect(row[3]).toBe("critical");
    expect(row[5]).toEqual([{ url: "https://src.example/a", title: "A" }]);
    expect(row[6]).toBe(true); // model_key_present
    expect(row[7]).toBe("99999999-8888-7777-6666-555555555555"); // prediction_id

    // feedback baseline minted under the transfer_forecast surface
    expect(deps.mintFeedback).toHaveBeenCalledWith(expect.objectContaining({ surface: FEEDBACK_SURFACE }));
  });

  it("serves the 24h cache without re-running the forecast", async () => {
    const cachedRow = {
      id: "cached-id",
      country_iso: "UA",
      static_risk: "high",
      forecast_probability: 0.7,
      blended_level: "critical",
      rationale: "cached rationale",
      sources: [{ url: "https://s.example" }],
      model_key_present: true,
      prediction_id: "p-1",
      created_at: "2026-01-31T12:00:00.000Z", // 12h old — inside TTL
    };
    const { deps } = makeDeps({
      exec: vi.fn(async () => [cachedRow]),
    });
    const res = await forecastTransferRisk("UA", deps);
    expect(res.fromCache).toBe(true);
    expect(res.forecastStatus).toBe("cached");
    expect(res.blendedLevel).toBe("critical");
    expect(deps.runForecast).not.toHaveBeenCalled();
    expect(deps.mintFeedback).not.toHaveBeenCalled();
  });

  it("key custody: OI unavailable (no key) → static-only blend, persisted with model_key_present=false", async () => {
    const { deps, inserted } = makeDeps({
      runForecast: vi.fn(async (): Promise<ForecastOutcome> => ({
        status: "unavailable",
        reason: "OSIRIS_OI_KEY not configured",
        modelKeyPresent: false,
      })),
    });
    const res = await forecastTransferRisk("UA", deps);
    expect(res.forecastStatus).toBe("unavailable");
    expect(res.forecastProbability).toBeNull();
    expect(res.blendedLevel).toBe("high"); // falls back to static
    expect(res.modelKeyPresent).toBe(false);
    expect(res.sources).toEqual([]);
    expect(res.rationale).toMatch(/OSIRIS_OI_KEY/);
    expect(res.rationale).toMatch(/falls back to static/);
    const row = inserted[0] as any[];
    expect(row[2]).toBeNull(); // forecast_probability NULL — fail-visible
    expect(row[6]).toBe(false);
  });

  it("timeout → static-only blend with the reason recorded", async () => {
    const { deps } = makeDeps({
      runForecast: vi.fn(async (): Promise<ForecastOutcome> => ({
        status: "timeout", reason: "forecast deadline exceeded", modelKeyPresent: true,
      })),
    });
    const res = await forecastTransferRisk("UA", deps);
    expect(res.forecastStatus).toBe("timeout");
    expect(res.blendedLevel).toBe("high");
    expect(res.rationale).toMatch(/deadline/);
  });

  it("survives missing migration 0147 (42P01) — computes, doesn't persist", async () => {
    const err = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    const { deps } = makeDeps({ exec: vi.fn(async () => { throw err; }) });
    const res = await forecastTransferRisk("UA", deps);
    expect(res.blendedLevel).toBe("critical"); // still blended from the fresh run
    expect(res.forecastId).toBeNull();
  });

  it("survives feedback-mint failure — forecast still persists", async () => {
    const { deps, inserted } = makeDeps({
      mintFeedback: vi.fn(async () => { throw new Error("kafka down"); }),
    });
    const res = await forecastTransferRisk("UA", deps);
    expect(res.predictionId).toBeNull();
    expect(inserted).toHaveLength(1);
  });
});

describe("listLatestForecasts", () => {
  it("returns [] when migration 0147 is not applied", async () => {
    const err = Object.assign(new Error("missing"), { code: "42P01" });
    const out = await listLatestForecasts(10, { exec: vi.fn(async () => { throw err; }) });
    expect(out).toEqual([]);
  });

  it("maps rows to results", async () => {
    const row = {
      id: "x", country_iso: "SD", static_risk: "critical", forecast_probability: null,
      blended_level: "critical", rationale: "r", sources: [], model_key_present: false,
      prediction_id: null, created_at: "2026-01-01T00:00:00Z",
    };
    const out = await listLatestForecasts(10, { exec: vi.fn(async () => [row]) });
    expect(out).toHaveLength(1);
    expect(out[0].countryIso).toBe("SD");
    expect(out[0].forecastProbability).toBeNull();
    expect(out[0].fromCache).toBe(true);
  });
});
