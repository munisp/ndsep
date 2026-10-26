/**
 * Saved Views Router Tests (round 12, wave 2)
 * ============================================
 * Verifies user-scoped CRUD against a mocked pg pool: the caller's derived
 * pseudonymous uuid is always a query parameter, duplicate names surface as
 * CONFLICT, and unknown ids surface as NOT_FOUND.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

const queryMock = vi.hoisted(() => vi.fn<(q: string, p?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>>());

vi.mock("pg", () => {
  const mockPool = {
    query: (...args: any[]) => queryMock(...(args as [string, unknown[]])),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    }),
  };
  return { default: { Pool: vi.fn(() => mockPool) }, Pool: vi.fn(() => mockPool) };
});

vi.mock("../middlewareIntegration", () => ({
  checkPermission: vi.fn().mockResolvedValue(true),
  emitMutationEvent: vi.fn().mockResolvedValue(undefined),
  EVENTS: {},
}));

vi.mock("../security/opa", () => ({
  requireOpaDecision: vi.fn().mockResolvedValue(undefined),
  buildOpaInput: vi.fn(() => ({})),
}));

import { getDb } from "../db";
import { savedViewsRouter, userUuid } from "./savedViews";

beforeAll(async () => {
  await getDb();
});

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeCtx(id: number): TrpcContext {
  const user: AuthenticatedUser = {
    id,
    openId: `test-user-${id}`,
    email: `user${id}@ndsep.gov.ng`,
    name: `User ${id}`,
    loginMethod: "manus",
    role: "user",
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

const VIEW = {
  id: "11111111-2222-5333-8444-555555555555",
  surface: "complaint_triage",
  name: "SLA breaches",
  filters: { status: "received" },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("userUuid", () => {
  it("is deterministic and a valid v5-style uuid", () => {
    const a = userUuid(1);
    expect(a).toBe(userUuid(1));
    expect(a).not.toBe(userUuid(2));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("savedViews.list", () => {
  it("is scoped to the caller's derived user uuid and surface", async () => {
    queryMock.mockResolvedValueOnce({ rows: [VIEW], rowCount: 1 });
    const res = await savedViewsRouter.createCaller(makeCtx(1)).list({ surface: "complaint_triage" });
    expect(res).toHaveLength(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("WHERE user_id = $1 AND surface = $2");
    expect(params![0]).toBe(userUuid(1));
    expect(params![1]).toBe("complaint_triage");
  });

  it("different users map to different scopes", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    await savedViewsRouter.createCaller(makeCtx(1)).list({ surface: "global_search" });
    await savedViewsRouter.createCaller(makeCtx(2)).list({ surface: "global_search" });
    expect(queryMock.mock.calls[0][1]![0]).not.toBe(queryMock.mock.calls[1][1]![0]);
  });
});

describe("savedViews.create", () => {
  it("inserts with the caller's uuid and returns the row", async () => {
    queryMock.mockResolvedValueOnce({ rows: [VIEW], rowCount: 1 });
    const res = await savedViewsRouter.createCaller(makeCtx(1)).create({
      surface: "complaint_triage",
      name: "SLA breaches",
      filters: { status: "received" },
    });
    expect(res.id).toBe(VIEW.id);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("INSERT INTO saved_views");
    expect(params![0]).toBe(userUuid(1));
    // filters json is serialized for the jsonb column
    expect(JSON.parse(params![3] as string)).toEqual({ status: "received" });
  });

  it("maps unique-violation to CONFLICT", async () => {
    queryMock.mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: "23505" }));
    await expect(
      savedViewsRouter.createCaller(makeCtx(1)).create({ surface: "global_search", name: "dup", filters: { query: "bank" } }),
    ).rejects.toThrowError(/already exists/);
  });

  it("rejects malformed surface keys and oversized filters", async () => {
    const caller = savedViewsRouter.createCaller(makeCtx(1));
    await expect(caller.create({ surface: "Bad Surface!", name: "x", filters: {} })).rejects.toThrowError();
    await expect(
      caller.create({ surface: "global_search", name: "x", filters: { blob: "y".repeat(20_000) } }),
    ).rejects.toThrowError(/too large/);
  });
});

describe("savedViews.update", () => {
  it("requires at least one mutable field", async () => {
    await expect(savedViewsRouter.createCaller(makeCtx(1)).update({ id: VIEW.id })).rejects.toThrowError(/Nothing to update/);
  });

  it("updates only the caller's own rows", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ ...VIEW, name: "renamed" }], rowCount: 1 });
    const res = await savedViewsRouter.createCaller(makeCtx(1)).update({ id: VIEW.id, name: "renamed" });
    expect(res.name).toBe("renamed");
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("WHERE id = $1 AND user_id = $2");
    expect(params![1]).toBe(userUuid(1));
  });

  it("NOT_FOUND when the row is missing or belongs to another user", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(
      savedViewsRouter.createCaller(makeCtx(1)).update({ id: VIEW.id, name: "nope" }),
    ).rejects.toThrowError(/not found/i);
  });
});

describe("savedViews.remove", () => {
  it("deletes only the caller's own rows", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: VIEW.id }], rowCount: 1 });
    const res = await savedViewsRouter.createCaller(makeCtx(1)).remove({ id: VIEW.id });
    expect(res).toEqual({ deleted: true, id: VIEW.id });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("DELETE FROM saved_views WHERE id = $1 AND user_id = $2");
    expect(params![1]).toBe(userUuid(1));
  });

  it("NOT_FOUND when nothing was deleted", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(savedViewsRouter.createCaller(makeCtx(1)).remove({ id: VIEW.id })).rejects.toThrowError(/not found/i);
  });

  it("requires authentication", async () => {
    const anon = { user: null, req: { protocol: "https", headers: {} }, res: {} } as unknown as TrpcContext;
    await expect(savedViewsRouter.createCaller(anon).list({ surface: "global_search" })).rejects.toThrowError();
  });
});
