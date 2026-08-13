import { describe, expect, it, vi } from "vitest";

vi.mock("@temporalio/client", () => ({
  Connection: {
    connect: vi.fn().mockRejectedValue(new Error("Connection refused")),
  },
  Client: vi.fn(),
}));

import {
  getTemporalConfig,
  startWorkflow,
  describeWorkflow,
  listWorkflows,
  temporalSmokeTest,
} from "./temporal";

describe("Temporal configuration", () => {
  it("reports the required address, namespace, task queue, and authentication mode", () => {
    const config = getTemporalConfig();
    expect(typeof config.address).toBe("string");
    expect(typeof config.namespace).toBe("string");
    expect(typeof config.taskQueue).toBe("string");
    expect(["mtls", "apikey", "none"]).toContain(config.authMethod);
  });
});

describe("Temporal fail-closed behavior", () => {
  it("rejects workflow starts when the configured broker cannot be reached", async () => {
    await expect(startWorkflow("penalty_enforcement", {
      workflowId: "offline-workflow",
      input: { penaltyId: "penalty-1" },
    })).rejects.toThrow("Connection refused");
  });

  it("rejects workflow descriptions when the broker cannot be reached", async () => {
    await expect(describeWorkflow("offline-workflow")).rejects.toThrow("Connection refused");
  });

  it("rejects workflow listings when the broker cannot be reached", async () => {
    await expect(listWorkflows({ pageSize: 5 })).rejects.toThrow("Connection refused");
  });

  it("reports a failed smoke test with latency and error metadata", async () => {
    const result = await temporalSmokeTest();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Connection refused");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
