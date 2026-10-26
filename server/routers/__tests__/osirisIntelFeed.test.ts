/**
 * osirisIntelFeed router unit tests (round 13, P1.5).
 *
 * No database: the shared pg pool (../../db getPool) is mocked with a
 * SQL-dispatching stub; emitMutationEvent is mocked; global fetch is stubbed
 * for triggerPoll. Procedures are invoked via router.createCaller with a
 * synthetic context (same pattern as __tests__/telegramWatch.test.ts).
 *
 * Covers:
 *  - feedStatus returns watermarks + per-source counts;
 *  - listRecentItems filters by source_key (single source and both), applies
 *    review_status and pagination;
 *  - triggerPoll POSTs the worker /run endpoint and returns its stats;
 *  - triggerPoll FAILS CLOSED when the worker is unreachable or non-OK;
 *  - authz: reads are staff-gated, triggerPoll is admin-only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../../_core/context";

const mockQuery = vi.fn();
const mockEmit = vi.fn().mockResolvedValue(undefined);
const mockFetch = vi.fn();

vi.mock("../../db", () => ({
  getPool: () => ({ query: mockQuery }),
  getSharedPool: () => ({ query: mockQuery }),
}));

vi.mock("../../middlewareIntegration", () => ({
  emitMutationEvent: (...args: unknown[]) => mockEmit(...args),
  checkPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../security/opa", () => ({
  requireOpaDecision: vi.fn().mockResolvedValue(undefined),
  buildOpaInput: vi.fn(() => ({})),
}));

vi.stubGlobal("fetch", mockFetch);

import { osirisIntelFeedRouter, OSIRIS_INTEL_SOURCE_KEYS } from "../osirisIntelFeed";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(role: string): TrpcContext {
  const user: AuthenticatedUser = {
    id: 42,
    openId: "test-officer-001",
    email: "officer@ndpc.gov.ng",
    name: "Test Officer",
    loginMethod: "manus",
    role: role as AuthenticatedUser["role"],
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const ITEM_ROW = {
  id: 91,
  url: "https://example.com/story",
  title: "[osiris_gdelt] data breach at Example Bank",
  summary: "data breach at Example Bank in Lagos",
  published_at: "2026-04-01T10:00:00.000Z",
  fetched_at: "2026-04-02T00:00:00.000Z",
  severity: "critical",
  triage_method: "keyword",
  triage_label: "data_breach",
  review_status: "pending",
  source_key: "osiris_gdelt",
  source_name: "OSIRIS GDELT geocoded events feed",
  matches: [{ match_id: 5, organization_id: 11, matched_name: "Example Bank Ltd",
              match_method: "exact", confidence: 1, status: "suggested" }],
};

/** Dispatch canned rows by SQL shape. */
function installQueryStub() {
  mockQuery.mockImplementation(async (sql: string, _params: unknown[] = []) => {
    if (/FROM osiris_intel_watermarks/i.test(sql)) {
      return { rows: [{
        source: "osiris_gdelt", last_seen_id: "evt-9",
        last_run_at: "2026-04-02T00:00:00.000Z", stats: { events_seen: 12, candidates: 2 },
      }] };
    }
    if (/FROM adverse_media_sources/i.test(sql) && /WHERE source_key IN/i.test(sql)) {
      return { rows: [
        { source_key: "osiris_gdelt", name: "OSIRIS GDELT geocoded events feed",
          enabled: false, last_status: "ok", last_error: null,
          last_polled_at: "2026-04-02T00:00:00.000Z" },
        { source_key: "osiris_news", name: "OSIRIS 23-broadcaster live-news feed",
          enabled: false, last_status: "ok", last_error: null, last_polled_at: null },
      ] };
    }
    if (/LEFT JOIN adverse_media_items/i.test(sql)) {
      return { rows: [
        { source_key: "osiris_gdelt", total: 7, pending: 5, confirmed: 1, rejected: 1,
          last_item_at: "2026-04-02T00:00:00.000Z" },
        { source_key: "osiris_news", total: 3, pending: 3, confirmed: 0, rejected: 0,
          last_item_at: null },
      ] };
    }
    if (/FROM adverse_media_items i/i.test(sql) && /COUNT\(\*\)/i.test(sql)) {
      return { rows: [{ n: 10 }] };
    }
    if (/FROM adverse_media_items i/i.test(sql)) {
      return { rows: [ITEM_ROW] };
    }
    if (/INSERT INTO audit_logs/i.test(sql)) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

describe("osirisIntelFeedRouter", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockEmit.mockClear();
    mockFetch.mockReset();
    installQueryStub();
  });

  it("exports the two OSIRIS source keys", () => {
    expect(OSIRIS_INTEL_SOURCE_KEYS).toEqual(["osiris_gdelt", "osiris_news"]);
  });

  it("feedStatus returns watermarks, sources and per-source counts", async () => {
    const caller = osirisIntelFeedRouter.createCaller(createContext("admin"));
    const res = await caller.feedStatus();
    expect(res.watermarks).toHaveLength(1);
    expect(res.watermarks[0].source).toBe("osiris_gdelt");
    expect(res.sources).toHaveLength(2);
    expect(res.counts).toHaveLength(2);
    expect(res.counts[0]).toMatchObject({ source_key: "osiris_gdelt", total: 7, pending: 5 });
  });

  it("listRecentItems restricts to a single source when filtered", async () => {
    const caller = osirisIntelFeedRouter.createCaller(createContext("government_staff"));
    const res = await caller.listRecentItems({ source: "osiris_news", limit: 25, offset: 50 });
    expect(res.total).toBe(10);
    expect(res.rows[0].source_key).toBe("osiris_gdelt");
    const listCall = mockQuery.mock.calls.find(([sql]: [string]) => /ORDER BY i\.fetched_at DESC/i.test(sql));
    expect(listCall[1]).toEqual(["osiris_news", 25, 50]);
  });

  it("listRecentItems defaults to both OSIRIS sources via ANY()", async () => {
    const caller = osirisIntelFeedRouter.createCaller(createContext("admin"));
    await caller.listRecentItems({ review_status: "pending" });
    const listCall = mockQuery.mock.calls.find(([sql]: [string]) => /ORDER BY i\.fetched_at DESC/i.test(sql));
    expect(listCall[0]).toMatch(/s\.source_key IN/i);
    expect(listCall[1]).toEqual(["osiris_gdelt", "osiris_news", "pending", 50, 0]);
  });

  it("triggerPoll POSTs the worker /run endpoint with the source filter", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", stats: { items_ingested: 3 } }),
    });
    const caller = osirisIntelFeedRouter.createCaller(createContext("admin"));
    const res = await caller.triggerPoll({ source: "osiris_gdelt" });
    expect(res.status).toBe("ok");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/run$/);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ sources: ["osiris_gdelt"] });
    const auditCall = mockQuery.mock.calls.find(([sql]: [string]) => /INSERT INTO audit_logs/i.test(sql));
    expect(auditCall[1][0]).toBe("osiris_intel_poll_triggered");
    expect(mockEmit).toHaveBeenCalled();
  });

  it("triggerPoll fails closed when the worker is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const caller = osirisIntelFeedRouter.createCaller(createContext("admin"));
    await expect(caller.triggerPoll()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: expect.stringMatching(/unreachable/i),
    });
  });

  it("triggerPoll fails closed when the worker returns non-OK", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const caller = osirisIntelFeedRouter.createCaller(createContext("admin"));
    await expect(caller.triggerPoll()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: expect.stringMatching(/HTTP 500/),
    });
  });

  it("rejects non-staff roles on reads", async () => {
    const caller = osirisIntelFeedRouter.createCaller(createContext("user"));
    await expect(caller.feedStatus()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.listRecentItems()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("triggerPoll is admin-only (staff are FORBIDDEN)", async () => {
    const caller = osirisIntelFeedRouter.createCaller(createContext("government_staff"));
    await expect(caller.triggerPoll()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
