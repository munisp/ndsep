/**
 * demoSeed.test.ts
 * Unit tests for the demo data seed/reset logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDemoData } from "./demoSeed";
import type { Pool, PoolClient } from "pg";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeMockClient(): PoolClient {
  const rows: Record<string, unknown[]> = {
    users: [{ id: 1 }],
    dpco_organisations: [{ id: 42 }],
  };

  const queryMock = vi.fn().mockImplementation((sql: string) => {
    if (/SELECT id FROM users/.test(sql)) return Promise.resolve({ rows: [{ id: 1 }] });
    if (/INSERT INTO dpco_organisations/.test(sql)) return Promise.resolve({ rows: [{ id: 42 }] });
    if (/INSERT INTO dpco_invoices/.test(sql)) return Promise.resolve({ rows: [{ id: Math.floor(Math.random() * 1000) + 1 }] });
    if (/INSERT INTO dpco_payments/.test(sql)) return Promise.resolve({ rows: [{ id: Math.floor(Math.random() * 1000) + 1 }] });
    if (/INSERT INTO banking_institutions/.test(sql)) return Promise.resolve({ rows: [{ id: Math.floor(Math.random() * 1000) + 100 }] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });

  return {
    query: queryMock,
    release: vi.fn(),
  } as unknown as PoolClient;
}

function makeMockPool(client: PoolClient): Pool {
  return {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("resetDemoData", () => {
  let client: PoolClient;
  let pool: Pool;

  beforeEach(() => {
    client = makeMockClient();
    pool = makeMockPool(client);
  });

  it("runs inside a transaction (BEGIN / COMMIT)", async () => {
    await resetDemoData(pool);
    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0] as string);
    expect(calls[0]).toBe("BEGIN");
    expect(calls[calls.length - 1]).toBe("COMMIT");
  });

  it("returns seeded record counts", async () => {
    const result = await resetDemoData(pool);
    expect(result.seeded).toBeDefined();
    expect(typeof result.seeded.clients).toBe("number");
    expect(typeof result.seeded.invoices).toBe("number");
    expect(typeof result.seeded.payments).toBe("number");
    expect(typeof result.seeded.revenueSplits).toBe("number");
  });

  it("seeds the expected number of clients (9)", async () => {
    const result = await resetDemoData(pool);
    expect(result.seeded.clients).toBe(9);
  });

  it("seeds the expected number of audit engagements (5)", async () => {
    const result = await resetDemoData(pool);
    expect(result.seeded.auditEngagements).toBe(5);
  });

  it("seeds the expected number of training sessions (6)", async () => {
    const result = await resetDemoData(pool);
    expect(result.seeded.trainingSessions).toBe(6);
  });

  it("seeds the expected number of policy drafts (6)", async () => {
    const result = await resetDemoData(pool);
    expect(result.seeded.policyDrafts).toBe(6);
  });

  it("seeds 8 invoices total (months Oct 2024 – May 2025)", async () => {
    const result = await resetDemoData(pool);
    expect(result.seeded.invoices).toBe(8);
  });

  it("seeds 5 payments (paid months only)", async () => {
    const result = await resetDemoData(pool);
    expect(result.seeded.payments).toBe(5);
  });

  it("rolls back on error and re-throws", async () => {
    // Make the INSERT into dpco_organisations throw
    (client.query as ReturnType<typeof vi.fn>).mockImplementationOnce(() => Promise.resolve({ rows: [{ id: 1 }] })) // BEGIN
      .mockImplementationOnce(() => Promise.resolve({ rows: [{ id: 1 }] })) // upsert users
      .mockImplementationOnce(() => Promise.resolve({ rows: [{ id: 1 }] })) // select user id
      .mockImplementationOnce(() => Promise.reject(new Error("DB error")));  // insert org → fail

    await expect(resetDemoData(pool)).rejects.toThrow("DB error");

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0] as string);
    expect(calls).toContain("ROLLBACK");
  });

  it("releases the pool client even on error", async () => {
    (client.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // BEGIN
      .mockRejectedValueOnce(new Error("fail"));

    await expect(resetDemoData(pool)).rejects.toThrow();
    expect(client.release).toHaveBeenCalledOnce();
  });
});
