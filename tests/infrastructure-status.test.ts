import { describe, expect, it } from "vitest";
import { getAdministratorInfrastructureStatus } from "../server/infrastructureStatus";

describe("administrator infrastructure status", () => {
  it("labels simulation services as non-authoritative and never exposes secrets", async () => {
    const status = await getAdministratorInfrastructureStatus();
    const emulator = status.services.find((service) => service.id === "provider_emulator_lab");
    expect(emulator?.authoritative).toBe(false);
    expect(status.services.some((service) => service.id === "application_runtime")).toBe(true);
    expect(JSON.stringify(status)).not.toContain("SECRET_ACCESS_KEY");
  });
});
