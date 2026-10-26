/**
 * forecastClient unit tests (round 13, W5 / P1.6).
 *
 * Covers: key custody (no OSIRIS_OI_KEY → unavailable, ZERO network calls),
 * MCP-preferred transport, REST fallback when MCP has no forecast tool,
 * synchronous + polled-async REST completion, the hard deadline, and
 * result normalization (probability coercion, sources preserved verbatim).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  runForecast,
  normalizeForecastPayload,
  findForecastTool,
} from "../forecastClient";

function jsonResponse(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
}

function rpcResult(id: number, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

beforeEach(() => {
  process.env.OSIRIS_URL = "https://osiris.test";
  delete process.env.OSIRIS_OI_KEY;
  delete process.env.OSIRIS_FORECAST_DEADLINE_MS;
});

describe("key custody", () => {
  it("no key → unavailable and NEVER calls out", async () => {
    const fetchFn = vi.fn();
    const out = await runForecast("q", undefined, { fetchFn: fetchFn as any });
    expect(out.status).toBe("unavailable");
    expect(out.modelKeyPresent).toBe(false);
    if (out.status !== "completed") expect(out.reason).toMatch(/OSIRIS_OI_KEY/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("normalizeForecastPayload", () => {
  it("normalizes canonical shape and preserves sources verbatim", () => {
    const src = { url: "https://reuters.example/x", title: "Escalation watch", publisher: "Reuters", extra: { kept: true } };
    const out = normalizeForecastPayload({
      forecastProbability: 0.7,
      rationale: "troop build-up",
      sources: [src, "https://bare.example/link"],
      completedAt: "2026-01-01T00:00:00Z",
    });
    expect(out).not.toBeNull();
    expect(out!.forecastProbability).toBe(0.7);
    expect(out!.rationale).toBe("troop build-up");
    expect(out!.sources[0]).toEqual(src); // extra keys preserved
    expect(out!.sources[1]).toEqual({ url: "https://bare.example/link" });
    expect(out!.completedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("coerces percent-style probabilities and nested forecast objects", () => {
    expect(normalizeForecastPayload({ probability: 62 })!.forecastProbability).toBeCloseTo(0.62);
    expect(normalizeForecastPayload({ forecast: { probability: 0.31, rationale: "r" } })!.forecastProbability).toBeCloseTo(0.31);
  });

  it("reads citations/references as source fallbacks", () => {
    expect(normalizeForecastPayload({ probability: 0.5, citations: ["https://c.example"] })!.sources).toEqual([{ url: "https://c.example" }]);
    expect(normalizeForecastPayload({ probability: 0.5, references: [{ url: "https://r.example" }] })!.sources).toEqual([{ url: "https://r.example" }]);
  });

  it("rejects payloads with no usable probability", () => {
    expect(normalizeForecastPayload({ rationale: "no number" })).toBeNull();
    expect(normalizeForecastPayload({ probability: -0.1 })).toBeNull();
    expect(normalizeForecastPayload({ probability: 101 })).toBeNull();
    expect(normalizeForecastPayload("string")).toBeNull();
    expect(normalizeForecastPayload(null)).toBeNull();
  });
});

describe("findForecastTool", () => {
  it("prefers run_forecast, falls back to any *forecast*, tolerates absence", () => {
    expect(findForecastTool([{ name: "get_forecast" }, { name: "run_forecast" }])!.name).toBe("run_forecast");
    expect(findForecastTool([{ name: "dns_lookup" }, { name: "forecast_status" }])!.name).toBe("forecast_status");
    expect(findForecastTool([{ name: "dns_lookup" }])).toBeNull();
    expect(findForecastTool([])).toBeNull();
  });
});

describe("runForecast — MCP transport preferred", () => {
  it("completes via MCP tools/call when a forecast tool is discovered", async () => {
    process.env.OSIRIS_OI_KEY = "k";
    const fetchFn = vi.fn(async (_url: string, init?: any) => {
      const req = JSON.parse(init.body);
      if (req.method === "initialize") return jsonResponse(200, rpcResult(req.id, { protocolVersion: "2024-11-05" }));
      if (req.method === "notifications/initialized") return jsonResponse(200, "");
      if (req.method === "tools/list") return jsonResponse(200, rpcResult(req.id, { tools: [{ name: "run_forecast" }] }));
      if (req.method === "tools/call") {
        return jsonResponse(200, rpcResult(req.id, {
          structuredContent: {
            probability: 0.66,
            rationale: "simulated escalation",
            sources: [{ url: "https://src.example/1" }],
          },
        }));
      }
      throw new Error("unexpected");
    }) as any;

    const out = await runForecast("Probability that X ...", { countryIso: "UA" }, { fetchFn, deadlineMs: 10_000 });
    expect(out.status).toBe("completed");
    if (out.status === "completed") {
      expect(out.transport).toBe("mcp");
      expect(out.forecast.forecastProbability).toBeCloseTo(0.66);
      expect(out.forecast.sources).toEqual([{ url: "https://src.example/1" }]);
      expect(out.modelKeyPresent).toBe(true);
    }
  });

  it("falls back to REST when MCP is unreachable", async () => {
    process.env.OSIRIS_OI_KEY = "k";
    const fetchFn = vi.fn(async (url: string, init?: any) => {
      if (String(url).includes("/api/mcp")) throw new Error("ECONNREFUSED");
      if (String(url).includes("/api/oi/forecast") && init?.method === "POST") {
        return jsonResponse(200, { probability: 0.4, rationale: "rest sync", sources: [] });
      }
      throw new Error("unexpected " + url);
    }) as any;
    const out = await runForecast("q", undefined, { fetchFn, deadlineMs: 10_000 });
    expect(out.status).toBe("completed");
    if (out.status === "completed") expect(out.transport).toBe("rest");
  });

  it("falls back to REST when MCP exposes no forecast tool", async () => {
    process.env.OSIRIS_OI_KEY = "k";
    const fetchFn = vi.fn(async (url: string, init?: any) => {
      if (String(url).includes("/api/mcp")) {
        const req = JSON.parse(init.body);
        if (req.method === "initialize") return jsonResponse(200, rpcResult(req.id, { protocolVersion: "2024-11-05" }));
        if (req.method === "tools/list") return jsonResponse(200, rpcResult(req.id, { tools: [{ name: "whois" }] }));
        return jsonResponse(200, "");
      }
      return jsonResponse(200, { probability: 0.25, rationale: "rest", sources: [] });
    }) as any;
    const out = await runForecast("q", undefined, { fetchFn, deadlineMs: 10_000 });
    expect(out.status).toBe("completed");
    if (out.status === "completed") {
      expect(out.transport).toBe("rest");
      expect(out.forecast.forecastProbability).toBeCloseTo(0.25);
    }
  });
});

describe("runForecast — REST transport", () => {
  beforeEach(() => {
    process.env.OSIRIS_OI_KEY = "k";
  });

  it("polls an async job until completed", async () => {
    vi.useFakeTimers();
    try {
      let polls = 0;
      const fetchFn = vi.fn(async (url: string, init?: any) => {
        if (init?.method === "POST") return jsonResponse(202, { id: "job-1", status: "pending" });
        polls++;
        if (polls < 2) return jsonResponse(200, { id: "job-1", status: "running" });
        return jsonResponse(200, { status: "completed", probability: 0.71, rationale: "done", sources: [{ url: "https://s.example" }] });
      }) as any;

      const promise = runForecast("q", undefined, { fetchFn, forceRest: true, deadlineMs: 60_000 });
      // advance through the 3s poll sleeps
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(3_100);
      }
      const out = await promise;
      expect(out.status).toBe("completed");
      if (out.status === "completed") {
        expect(out.transport).toBe("rest");
        expect(out.forecast.forecastProbability).toBeCloseTo(0.71);
      }
      expect(polls).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns timeout when the job never completes before the deadline", async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn(async (url: string, init?: any) => {
        if (init?.method === "POST") return jsonResponse(202, { id: "job-9", status: "pending" });
        return jsonResponse(200, { id: "job-9", status: "running" });
      }) as any;
      const promise = runForecast("q", undefined, { fetchFn, forceRest: true, deadlineMs: 8_000 });
      for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(3_100);
      const out = await promise;
      expect(out.status).toBe("timeout");
      if (out.status !== "completed") expect(out.reason).toMatch(/deadline/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps a failed job to error", async () => {
    const fetchFn = vi.fn(async (url: string, init?: any) => {
      if (init?.method === "POST") return jsonResponse(200, { status: "failed", error: "simulation crashed" });
      throw new Error("unexpected");
    }) as any;
    const out = await runForecast("q", undefined, { fetchFn, forceRest: true, deadlineMs: 5_000 });
    expect(out.status).toBe("error");
  });

  it("maps HTTP failure at submit to error (never throws)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(500, { error: "oi down" }) as any);
    const out = await runForecast("q", undefined, { fetchFn, forceRest: true, deadlineMs: 5_000 });
    expect(out.status).toBe("error");
    if (out.status !== "completed") expect(out.reason).toMatch(/HTTP 500/);
  });

  it("sends the OI key as Bearer from server-side env on REST calls", async () => {
    process.env.OSIRIS_OI_KEY = "rest-key-1";
    const fetchFn = vi.fn(async () => jsonResponse(200, { probability: 0.1 }) as any);
    await runForecast("q", undefined, { fetchFn, forceRest: true, deadlineMs: 5_000 });
    const init = (fetchFn.mock.calls[0] as any[])[1];
    expect(init.headers.Authorization).toBe("Bearer rest-key-1");
  });
});
