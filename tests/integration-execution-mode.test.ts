import { describe, expect, it } from "vitest";
import { isSimulationModeAllowed } from "../server/integrationSettingsRepository";

describe("integration execution mode policy", () => {
  it("permits the simulator only when explicitly enabled outside production", () => {
    expect(isSimulationModeAllowed({ NODE_ENV: "development", ENABLE_DEVELOPMENT_PROVIDER_EMULATORS: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isSimulationModeAllowed({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isSimulationModeAllowed({ NODE_ENV: "production", ENABLE_DEVELOPMENT_PROVIDER_EMULATORS: "true" } as NodeJS.ProcessEnv)).toBe(false);
  });
});
