import { describe, expect, it } from "vitest";
import { deriveModelPipelineStatus, MODEL_DEFINITIONS } from "./mlPipeline";

const model = MODEL_DEFINITIONS[0];
const result = {
  modelName: model.name,
  status: "success" as const,
  trainingRows: 100,
  trainingTimeMs: 750,
  completedAt: "2026-08-01T00:00:00.000Z",
  modelVersion: "v-test",
};

describe("deriveModelPipelineStatus", () => {
  it("preserves the actual completion timestamp instead of presenting the current time as the last training time", () => {
    const status = deriveModelPipelineStatus(model, result, new Date("2026-08-01T01:00:00.000Z"));
    expect(status.lastTrained).toBe("2026-08-01T00:00:00.000Z");
    expect(status.nextTraining).toBe("2026-08-08T00:00:00.000Z");
    expect(status.status).toBe("ready");
  });

  it("marks a successful model stale after its configured retraining interval", () => {
    const status = deriveModelPipelineStatus(model, result, new Date("2026-08-08T00:00:00.001Z"));
    expect(status.status).toBe("stale");
  });

  it("does not present malformed or absent completion evidence as a trained model", () => {
    expect(deriveModelPipelineStatus(model, undefined, new Date("2026-08-01T00:00:00.000Z")).status).toBe("untrained");
    expect(deriveModelPipelineStatus(model, { ...result, completedAt: "not-a-date" }, new Date("2026-08-01T00:00:00.000Z")).status).toBe("untrained");
  });
});
