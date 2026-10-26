/**
 * telegramWatch router unit tests (round 13, P0.1).
 *
 * No database: the shared pg pool (../../db getPool) is mocked with a
 * SQL-dispatching stub; emitMutationEvent is mocked. Procedures are invoked
 * via router.createCaller with a synthetic staff context (same pattern as
 * __tests__/decisionFeedback.test.ts).
 *
 * Covers:
 *  - listSignals applies the status filter and paginates;
 *  - confirmSignal updates the row and appends a decision_feedback row with
 *    surface='telegram_watch' keyed by the signal's prediction_id;
 *  - rejectSignal requires a note and records action='reject';
 *  - confirm/reject fail with CONFLICT when the row is not pending;
 *  - breachLagList returns days_overdue per entity;
 *  - stats aggregates queue + lag counters;
 *  - non-staff roles are FORBIDDEN.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../../_core/context";

const mockQuery = vi.fn();
const mockEmit = vi.fn().mockResolvedValue(undefined);

vi.mock("../../db", () => ({
  getPool: () => ({ query: mockQuery }),
  getSharedPool: () => ({ query: mockQuery }),
}));

vi.mock("../../middlewareIntegration", () => ({
  emitMutationEvent: (...args: unknown[]) => mockEmit(...args),
}));

import { telegramWatchRouter, TELEGRAM_WATCH_SURFACE } from "../telegramWatch";

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

const SIGNAL_ROW = {
  id: 7,
  post_id: "post-99",
  channel: "nigeria_cyber_news",
  post_ts: "2026-04-01T00:00:00.000Z",
  post_url: "https://t.me/s/nigeria_cyber_news/99",
  text_redacted: "BREAKING: data breach at Example Bank, 50000 records leaked",
  geo: null,
  classifier: { keywords: ["\\bdata\\s*breach\\b"], method: "keyword", ambiguous: false, entities: [] },
  severity: "critical",
  adverse_media_item_id: 123,
  status: "confirmed",
  reviewed_by: "Test Officer",
  reviewed_at: "2026-04-02T00:00:00.000Z",
  prediction_id: "11111111-2222-4333-8444-555555555555",
  created_at: "2026-04-01T01:00:00.000Z",
};

/** Dispatch canned rows by SQL shape. */
function installQueryStub() {
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/FROM telegram_watch_items\s+WHERE/i.test(sql) && /COUNT\(\*\)/i.test(sql)) {
      return { rows: [{ n: 1 }] };
    }
    if (/FROM telegram_watch_items/i.test(sql) && /ORDER BY created_at DESC/i.test(sql)) {
      return { rows: [SIGNAL_ROW] };
    }
    if (/UPDATE telegram_watch_items/i.test(sql)) {
      return { rows: [SIGNAL_ROW] };
    }
    if (/INSERT INTO decision_feedback/i.test(sql)) {
      return { rows: [{ id: "fb-1", created_at: "2026-04-02T00:00:00.000Z" }] };
    }
    if (/INSERT INTO audit_logs/i.test(sql)) {
      return { rows: [] };
    }
    if (/FROM breach_lag_signals s/i.test(sql)) {
      return { rows: [{
        id: 3, signal_type: "breach_notification_overdue", organization_id: 11,
        organization_name: "Example Bank", telegram_watch_item_id: 7,
        post_ts: "2026-03-20T00:00:00.000Z", notification_deadline: "2026-03-23T00:00:00.000Z",
        status: "open", acknowledged_by: null, acknowledged_at: null,
        created_at: "2026-03-24T00:00:00.000Z", days_overdue: 10,
      }] };
    }
    if (/UPDATE breach_lag_signals/i.test(sql)) {
      return { rows: [{ id: 3, status: "acknowledged" }] };
    }
    if (/FROM telegram_watch_items$/im.test(sql.trim()) || /FILTER \(WHERE status = 'pending'\)/i.test(sql)) {
      return { rows: [{ pending: 2, confirmed: 5, rejected: 1, total: 8 }] };
    }
    if (/FROM breach_lag_signals$/im.test(sql.trim()) || /entities_open/i.test(sql)) {
      return { rows: [{ open: 3, acknowledged: 1, resolved: 0, entities_open: 2 }] };
    }
    if (/FROM telegram_watch_watermarks/i.test(sql)) {
      return { rows: [{ channel: "nigeria_cyber_news", last_post_ts: null, last_run_at: null }] };
    }
    return { rows: [] };
  });
}

describe("telegramWatchRouter", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockEmit.mockClear();
    installQueryStub();
  });

  it("listSignals filters by status and paginates", async () => {
    const caller = telegramWatchRouter.createCaller(createContext("admin"));
    const res = await caller.listSignals({ status: "pending", limit: 25, offset: 50 });
    expect(res.total).toBe(1);
    expect(res.rows[0].post_id).toBe("post-99");
    const listCall = mockQuery.mock.calls.find(([sql]: [string]) => /ORDER BY created_at DESC/i.test(sql));
    expect(listCall[1]).toEqual(["pending", 25, 50]);
  });

  it("confirmSignal updates status and records decision_feedback accept", async () => {
    const caller = telegramWatchRouter.createCaller(createContext("government_staff"));
    const row = await caller.confirmSignal({ id: 7 });
    expect(row.status).toBe("confirmed");

    const fbCall = mockQuery.mock.calls.find(([sql]: [string]) => /INSERT INTO decision_feedback/i.test(sql));
    expect(fbCall).toBeDefined();
    expect(fbCall[1][0]).toBe(SIGNAL_ROW.prediction_id);
    expect(fbCall[1][1]).toBe(TELEGRAM_WATCH_SURFACE);
    expect(fbCall[1][5]).toBe("accept");

    const auditCall = mockQuery.mock.calls.find(([sql]: [string]) => /INSERT INTO audit_logs/i.test(sql));
    expect(auditCall[1][0]).toBe("telegram_watch_signal_confirmed");
    expect(mockEmit).toHaveBeenCalled();
  });

  it("rejectSignal records action='reject' and requires a note", async () => {
    const caller = telegramWatchRouter.createCaller(createContext("admin"));
    await expect(caller.rejectSignal({ id: 7, note: "no" })).rejects.toThrow();
    const row = await caller.rejectSignal({ id: 7, note: "false positive — marketing post" });
    expect(row).toBeDefined();
    const fbCall = mockQuery.mock.calls.find(([sql]: [string]) => /INSERT INTO decision_feedback/i.test(sql));
    expect(fbCall[1][5]).toBe("reject");
  });

  it("confirm/reject fail with CONFLICT when the signal is not pending", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/UPDATE telegram_watch_items/i.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const caller = telegramWatchRouter.createCaller(createContext("admin"));
    await expect(caller.confirmSignal({ id: 7 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller.rejectSignal({ id: 7, note: "already reviewed" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("breachLagList returns entities with days_overdue", async () => {
    const caller = telegramWatchRouter.createCaller(createContext("admin"));
    const rows = await caller.breachLagList({ status: "open", limit: 50, offset: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].organization_name).toBe("Example Bank");
    expect(rows[0].signal_type).toBe("breach_notification_overdue");
    expect(rows[0].days_overdue).toBe(10);
  });

  it("acknowledgeLagSignal transitions open -> acknowledged", async () => {
    const caller = telegramWatchRouter.createCaller(createContext("auditor"));
    const row = await caller.acknowledgeLagSignal({ id: 3 });
    expect(row.status).toBe("acknowledged");
  });

  it("stats aggregates signal queue and breach-lag counters", async () => {
    const caller = telegramWatchRouter.createCaller(createContext("admin"));
    const res = await caller.stats();
    expect(res.signals).toMatchObject({ pending: 2, confirmed: 5, rejected: 1, total: 8 });
    expect(res.breachLag).toMatchObject({ open: 3, entities_open: 2 });
    expect(res.channels).toHaveLength(1);
  });

  it("rejects non-staff roles", async () => {
    const caller = telegramWatchRouter.createCaller(createContext("user"));
    await expect(caller.listSignals()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires authentication", async () => {
    const caller = telegramWatchRouter.createCaller({
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    });
    // staffProcedure denies anonymous callers with FORBIDDEN (role gate runs
    // before any data access).
    await expect(caller.listSignals()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
