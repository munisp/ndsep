/**
 * Round-12 productivity KPI computation tests.
 *
 * No database: ../db's getPool is mocked (same pattern as
 * server/routers/ngnLedgerWiring.test.ts) and canned row sets are keyed by
 * the SQL each computation issues. Verifies the KPI math, the zero-sample
 * baseline behaviour (value 0, never fabricated), and the kpi_snapshots
 * persistence / 42P01 degradation path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Canned rows keyed by a matcher run against the SQL text.
let routes: Array<{ match: RegExp; rows: any[]; error?: { code: string } }> = [];
let queries: Array<{ sql: string; params: unknown[] }> = [];

vi.mock("../db", () => ({
  getPool: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      for (const route of routes) {
        if (route.match.test(sql)) {
          if (route.error) {
            throw Object.assign(new Error("relation does not exist"), route.error);
          }
          return { rows: route.rows };
        }
      }
      return { rows: [] };
    },
  }),
}));

beforeEach(() => {
  routes = [];
  queries = [];
});

async function loadModule() {
  return import("./productivityKpis");
}

describe("computeClicksPerWorkflow", () => {
  it("averages staff events + ledger actions per complaint", async () => {
    routes = [
      { match: /FROM complaint_events/i, rows: [{ staff_events: 10, complaints: 4 }] },
      { match: /FROM audit_ledger/i, rows: [{ ledger_actions: 6 }] },
    ];
    const { computeClicksPerWorkflow } = await loadModule();
    const pool = (await import("../db")).getPool()!;
    const exec = async (sql: string, params?: unknown[]) => (await pool.query(sql, params)).rows;
    const metric = await computeClicksPerWorkflow(exec);
    expect(metric.id).toBe("clicks_per_workflow");
    expect(metric.value).toBe(4); // (10 + 6) / 4
    expect(metric.sampleSize).toBe(4);
    expect(metric.dimensions).toMatchObject({ staffEvents: 10, ledgerActions: 6, complaints: 4 });
  });

  it("returns 0 with sampleSize 0 when no complaints exist", async () => {
    routes = [
      { match: /FROM complaint_events/i, rows: [{ staff_events: 0, complaints: 0 }] },
      { match: /FROM audit_ledger/i, rows: [{ ledger_actions: 0 }] },
    ];
    const { computeClicksPerWorkflow } = await loadModule();
    const pool = (await import("../db")).getPool()!;
    const metric = await computeClicksPerWorkflow(async (sql, params) => (await pool.query(sql, params)).rows);
    expect(metric.value).toBe(0);
    expect(metric.sampleSize).toBe(0);
  });
});

describe("time-to-triage / time-to-resolution", () => {
  it("passes through the computed averages and sample sizes", async () => {
    routes = [
      { match: /triaged AS/i, rows: [{ avg_hours: 5.5, n: 12 }] },
      { match: /resolved AS/i, rows: [{ avg_hours: 96.25, n: 8 }] },
    ];
    const { computeTimeToTriage, computeTimeToResolution } = await loadModule();
    const pool = (await import("../db")).getPool()!;
    const exec = async (sql: string, params?: unknown[]) => (await pool.query(sql, params)).rows;
    const triage = await computeTimeToTriage(exec);
    const resolution = await computeTimeToResolution(exec);
    expect(triage).toMatchObject({ id: "time_to_triage_hours", value: 5.5, sampleSize: 12, unit: "hours" });
    expect(resolution).toMatchObject({ id: "time_to_resolution_hours", value: 96.25, sampleSize: 8 });
  });

  it("reports 0 (not NULL/NaN) when no complaint has been triaged yet", async () => {
    routes = [{ match: /complaint_events/i, rows: [{ avg_hours: null, n: 0 }] }];
    const { computeTimeToTriage, computeTimeToResolution } = await loadModule();
    const pool = (await import("../db")).getPool()!;
    const exec = async (sql: string, params?: unknown[]) => (await pool.query(sql, params)).rows;
    expect((await computeTimeToTriage(exec)).value).toBe(0);
    expect((await computeTimeToResolution(exec)).value).toBe(0);
  });
});

describe("computeQueueAutoClearRate", () => {
  it("combines scan_findings and adverse_media_items into one rate", async () => {
    routes = [
      { match: /FROM scan_findings/i, rows: [{ resolved_total: 10, auto_cleared: 2 }] },
      { match: /FROM adverse_media_items/i, rows: [{ resolved_total: 10, auto_cleared: 0 }] },
    ];
    const { computeQueueAutoClearRate } = await loadModule();
    const pool = (await import("../db")).getPool()!;
    const metric = await computeQueueAutoClearRate(async (sql, params) => (await pool.query(sql, params)).rows);
    expect(metric.id).toBe("queue_auto_clear_rate");
    expect(metric.value).toBe(10); // 2 / 20 = 10%
    expect(metric.sampleSize).toBe(20);
  });

  it("honest 0 baseline when nothing has been resolved", async () => {
    routes = [
      { match: /FROM scan_findings/i, rows: [{ resolved_total: 0, auto_cleared: 0 }] },
      { match: /FROM adverse_media_items/i, rows: [{ resolved_total: 0, auto_cleared: 0 }] },
    ];
    const { computeQueueAutoClearRate } = await loadModule();
    const pool = (await import("../db")).getPool()!;
    const metric = await computeQueueAutoClearRate(async (sql, params) => (await pool.query(sql, params)).rows);
    expect(metric.value).toBe(0);
    expect(metric.sampleSize).toBe(0);
  });
});

describe("computeFormFieldsEdited", () => {
  it("sums metadata.fieldsEdited and reports form event counts", async () => {
    routes = [
      { match: /FROM analytics_events/i, rows: [{ starts: 20, completions: 15, abandonments: 5, fields_edited: 137 }] },
    ];
    const { computeFormFieldsEdited } = await loadModule();
    const pool = (await import("../db")).getPool()!;
    const metric = await computeFormFieldsEdited(async (sql, params) => (await pool.query(sql, params)).rows);
    expect(metric).toMatchObject({ id: "form_fields_edited", value: 137, sampleSize: 40, unit: "fields" });
    expect(metric.dimensions).toMatchObject({ starts: 20, completions: 15, abandonments: 5 });
  });
});

describe("computeProductivityKpiBaseline", () => {
  it("computes all five metrics with defaults (all-zero db)", async () => {
    const { computeProductivityKpiBaseline } = await loadModule();
    const baseline = await computeProductivityKpiBaseline();
    expect(baseline.metrics.map((m) => m.id)).toEqual([
      "clicks_per_workflow",
      "time_to_triage_hours",
      "time_to_resolution_hours",
      "queue_auto_clear_rate",
      "form_fields_edited",
    ]);
    for (const m of baseline.metrics) {
      expect(m.value).toBe(0);
      expect(Number.isFinite(m.value)).toBe(true);
    }
    expect(baseline.computedAt).toBeTruthy();
  });
});

describe("persistKpiSnapshots / readKpiSnapshotHistory", () => {
  it("inserts one snapshot row per metric", async () => {
    const { persistKpiSnapshots } = await loadModule();
    const baseline = {
      computedAt: new Date().toISOString(),
      metrics: [
        { id: "a", label: "A", value: 1, unit: "hours", sampleSize: 2, dimensions: {}, description: "" },
        { id: "b", label: "B", value: 3.5, unit: "percent", sampleSize: 0, dimensions: { x: 1 }, description: "" },
      ],
    };
    const written = await persistKpiSnapshots(baseline);
    expect(written).toBe(2);
    const inserts = queries.filter((q) => /INSERT INTO kpi_snapshots/i.test(q.sql));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].params[0]).toBe("a");
    expect(inserts[1].params[1]).toBe(3.5);
    // dimensions carry unit + sampleSize
    expect(JSON.parse(String(inserts[0].params[2]))).toMatchObject({ unit: "hours", sampleSize: 2 });
  });

  it("skips gracefully when kpi_snapshots is missing (42P01 — migration not applied)", async () => {
    routes = [{ match: /kpi_snapshots/i, rows: [], error: { code: "42P01" } }];
    const { persistKpiSnapshots, readKpiSnapshotHistory } = await loadModule();
    const baseline = {
      computedAt: new Date().toISOString(),
      metrics: [
        { id: "a", label: "A", value: 1, unit: "hours", sampleSize: 2, dimensions: {}, description: "" },
      ],
    };
    await expect(persistKpiSnapshots(baseline)).resolves.toBe(0);
    await expect(readKpiSnapshotHistory(undefined, 10)).resolves.toEqual([]);
  });

  it("rethrows non-42P01 persistence errors (no silent swallow)", async () => {
    routes = [{ match: /kpi_snapshots/i, rows: [], error: { code: "23505" } }];
    const { persistKpiSnapshots } = await loadModule();
    const baseline = {
      computedAt: new Date().toISOString(),
      metrics: [
        { id: "a", label: "A", value: 1, unit: "hours", sampleSize: 2, dimensions: {}, description: "" },
      ],
    };
    await expect(persistKpiSnapshots(baseline)).rejects.toThrow();
  });

  it("filters history by metric when provided", async () => {
    routes = [{ match: /FROM kpi_snapshots/i, rows: [{ id: "x", metric: "m", value: 1, dimensions: {}, captured_at: "2026-01-01" }] }];
    const { readKpiSnapshotHistory } = await loadModule();
    const rows = await readKpiSnapshotHistory("time_to_triage_hours", 5);
    expect(rows).toHaveLength(1);
    const q = queries.find((q) => /FROM kpi_snapshots/i.test(q.sql));
    expect(q?.params).toEqual(["time_to_triage_hours", 5]);
  });
});
