import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { registerDevelopmentProviderEmulators } from "../server/developmentProviderEmulators";
import { getIntegrationSettingsStatus, saveIntegrationSettings } from "../server/integrationSettingsRepository";

const originalNodeEnv = process.env.NODE_ENV;
const originalEmulatorFlag = process.env.ENABLE_DEVELOPMENT_PROVIDER_EMULATORS;
const originalEncryptionKey = process.env.INTEGRATION_SETTINGS_ENCRYPTION_KEY;

afterEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  if (originalEmulatorFlag) process.env.ENABLE_DEVELOPMENT_PROVIDER_EMULATORS = originalEmulatorFlag;
  else delete process.env.ENABLE_DEVELOPMENT_PROVIDER_EMULATORS;
  if (originalEncryptionKey) process.env.INTEGRATION_SETTINGS_ENCRYPTION_KEY = originalEncryptionKey;
  else delete process.env.INTEGRATION_SETTINGS_ENCRYPTION_KEY;
});

async function withEmulatorServer(run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  registerDevelopmentProviderEmulators(app);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to start test server");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe("integration settings and development emulators", () => {
  it("does not permit application-side credential storage without a server encryption key", () => {
    delete process.env.INTEGRATION_SETTINGS_ENCRYPTION_KEY;
    const status = getIntegrationSettingsStatus();
    expect(status.secureStorageAvailable).toBe(false);
    expect(status.reason).toContain("INTEGRATION_SETTINGS_ENCRYPTION_KEY");
    expect(() => saveIntegrationSettings({ DOCLING_SERVICE_API_KEY: "never-store-insecurely" })).toThrow("Secure integration settings storage is unavailable");
  });

  it("keeps development emulators disabled unless explicitly enabled outside production", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    delete process.env.ENABLE_DEVELOPMENT_PROVIDER_EMULATORS;
    await withEmulatorServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/dev-emulators/docling/v1/convert/source`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_sources: [] }) });
      expect(response.status).toBe(404);
    });
  });

  it("returns explicit test-only labels when the local Keycloak and Docling emulators are opted in", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.ENABLE_DEVELOPMENT_PROVIDER_EMULATORS = "true";
    await withEmulatorServer(async (baseUrl) => {
      const discovery = await fetch(`${baseUrl}/api/dev-emulators/keycloak/.well-known/openid-configuration`);
      const document = await fetch(`${baseUrl}/api/dev-emulators/docling/v1/convert/source`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_sources: [{ filename: "sample.pdf", base64_string: "dGVzdA==" }] }) });
      await expect(discovery.json()).resolves.toMatchObject({ emulator: true, productionUseProhibited: true });
      await expect(document.json()).resolves.toMatchObject({ emulator: true, productionUseProhibited: true, documents: [{ emulator: true, verified: false }] });
    });
  });

  it("refuses emulator routes in production even when an opt-in flag is present", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.ENABLE_DEVELOPMENT_PROVIDER_EMULATORS = "true";
    await withEmulatorServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/dev-emulators/keycloak/certs`);
      expect(response.status).toBe(404);
    });
  });
});
