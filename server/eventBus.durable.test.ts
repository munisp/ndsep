import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPool: vi.fn(),
  kafkaProduce: vi.fn(),
  daprPublish: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./db", () => ({ getPool: mocks.getPool }));
vi.mock("./kafka", () => ({ kafkaProduce: mocks.kafkaProduce }));
vi.mock("./dapr", () => ({ daprPublish: mocks.daprPublish }));
vi.mock("./logger", () => ({ logger: mocks.logger }));

import { processDurableOutbox, publishEvent, stopDurableOutbox } from "./eventBus";

const durableRow = {
  id: "6f7b3b77-741a-4db1-a222-000000000001",
  event_type: "breach.created",
  topic: "ndsep.breach.created",
  aggregate_id: "42",
  aggregate_type: "breach_incident",
  payload: {
    type: "breach.created",
    aggregateId: "42",
    aggregateType: "breach_incident",
    payload: { orgId: 7, severity: "high" },
    timestamp: "2026-09-01T12:00:00.000Z",
    correlationId: "66a195d4-b43e-4d18-bc6c-000000000001",
  },
  headers: {
    "event-type": "breach.created",
    "aggregate-type": "breach_incident",
    "correlation-id": "66a195d4-b43e-4d18-bc6c-000000000001",
  },
  user_id: 3,
  correlation_id: "66a195d4-b43e-4d18-bc6c-000000000001",
  attempts: 1,
};

function buildPool(rows: typeof durableRow[] = []) {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("WITH due AS")) return { rows };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return {
    query: vi.fn(async () => ({ rows: [] })),
    connect: vi.fn(async () => client),
    client,
  };
}

describe("durable PostgreSQL event outbox", () => {
  beforeEach(() => {
    stopDurableOutbox();
    vi.clearAllMocks();
    mocks.daprPublish.mockResolvedValue(false);
  });

  it("persists the event then reschedules it when Kafka is unavailable", async () => {
    const pool = buildPool([durableRow]);
    mocks.getPool.mockReturnValue(pool);
    mocks.kafkaProduce.mockResolvedValue(false);

    await expect(publishEvent("breach.created", "42", "breach_incident", { orgId: 7, severity: "high" }, 3)).resolves.toBe(true);

    const enqueueCall = pool.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO domain_event_outbox"));
    const rescheduleCall = pool.query.mock.calls.find(([sql]) => String(sql).includes("next_attempt_at"));
    expect(enqueueCall).toBeDefined();
    expect(rescheduleCall).toBeDefined();
    expect(rescheduleCall?.[1][1]).toBeGreaterThanOrEqual(5);
    expect(pool.client.query).toHaveBeenCalledWith("BEGIN");
    expect(pool.client.query).toHaveBeenCalledWith("COMMIT");
    expect(pool.client.release).toHaveBeenCalledOnce();
  });

  it("marks a claimed durable event published only after Kafka confirms delivery", async () => {
    const pool = buildPool([durableRow]);
    mocks.getPool.mockReturnValue(pool);
    mocks.kafkaProduce.mockResolvedValue(true);

    await expect(processDurableOutbox()).resolves.toBe(1);

    const markPublishedCall = pool.query.mock.calls.find(([sql]) => String(sql).includes("status = 'published'"));
    expect(markPublishedCall).toBeDefined();
    expect(markPublishedCall?.[1]).toEqual([durableRow.id]);
  });

  it("refuses to publish when PostgreSQL is unavailable instead of using memory", async () => {
    mocks.getPool.mockReturnValue(null);
    await expect(publishEvent("breach.created", "42", "breach_incident", { orgId: 7 })).rejects.toThrow(
      /PostgreSQL pool is unavailable/
    );
    expect(mocks.kafkaProduce).not.toHaveBeenCalled();
  });
});
