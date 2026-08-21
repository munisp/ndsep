import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Temporal fail-closed contract", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@temporalio/client", () => ({
      Connection: { connect: vi.fn().mockRejectedValue(new Error("broker unavailable")) },
      Client: class Client {},
    }));
  });

  it("rejects workflow acknowledgement when the configured Temporal broker cannot be reached", async () => {
    const { startWorkflow } = await import("./temporal");
    await expect(startWorkflow("accreditationWorkflow", {
      workflowId: "contract-test-workflow",
      input: { applicationId: "application-1" },
      taskQueue: "ndsep-main",
    })).rejects.toThrow("broker unavailable");
  });
});
