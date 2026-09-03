import { describe, expect, it, vi } from "vitest";

import { recordWebhookDeliveryAttempt } from "./webhookDelivery";

describe("webhookDelivery", () => {
  const event = {
    id: "3c4c3e98-1a87-4e84-9b6a-056e50e72c8d",
    type: "audit.completed",
    data: { auditId: "audit-synthetic-001", outcome: "completed" },
    timestamp: "2026-09-01T00:00:00.000Z",
  };

  it("persists the canonical signed-event delivery audit record before a delivery can be reported", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });

    await recordWebhookDeliveryAttempt({ query } as never, { id: 17 }, event, 202, true, 0);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO webhook_deliveries");
    expect(sql).toContain("(subscription_id, event, payload, response_status, response_body, attempt, delivered_at, success)");
    expect(sql).not.toContain("event_type");
    expect(sql).not.toContain("event_id");
    expect(parameters).toEqual([
      17,
      "audit.completed",
      JSON.stringify(event),
      202,
      1,
      true,
    ]);
    expect(sql).toContain("NULL");
  });

  it("records transport failure as an explicit null-status failed attempt", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });

    await recordWebhookDeliveryAttempt({ query } as never, { id: 17 }, event, null, false, 2);

    const [, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(parameters).toEqual([
      17,
      "audit.completed",
      JSON.stringify(event),
      null,
      3,
      false,
    ]);
  });

  it("propagates ledger failure so callers cannot report an unaudited delivery as successful", async () => {
    const query = vi.fn().mockRejectedValue(new Error("webhook ledger unavailable"));

    await expect(recordWebhookDeliveryAttempt({ query } as never, { id: 17 }, event, 202, true, 0))
      .rejects.toThrow("webhook ledger unavailable");
  });
});
