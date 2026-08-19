import { getGatewayActivationStatus } from "./paymentGatewayConfig";
import { getIntegrationExecutionMode, getIntegrationSettingsStatus, isSimulationModeAllowed } from "./integrationSettingsRepository";
import { objectStorageConfig, objectStorageMode } from "./objectStorageConfig";
import { readinessReport } from "./productionRuntime";
import { getProviderHealth } from "./trustProviders";

export async function getAdministratorInfrastructureStatus() {
  const readiness = readinessReport();
  const providers = getProviderHealth();
  const settings = getIntegrationSettingsStatus();
  const objectStorage = objectStorageConfig();
  const gateway = getGatewayActivationStatus();
  const simulationAllowed = isSimulationModeAllowed();
  const executionMode = getIntegrationExecutionMode();
  return {
    generatedAt: new Date().toISOString(),
    runtime: readiness,
    executionMode,
    simulationAllowed,
    services: [
      { id: "application_runtime", label: "Application runtime", state: readiness.ok ? "ready" : "blocked", detail: readiness.ok ? "Required runtime configuration is present." : `Missing required controls: ${readiness.missingRequiredChecks.join(", ")}.`, authoritative: true },
      { id: "object_storage", label: "Evidence object storage", state: objectStorage ? "ready" : "unavailable", detail: objectStorage ? `${objectStorageMode()} storage configured for bucket ${objectStorage.bucket}.` : "S3-compatible object storage is not configured.", authoritative: true },
      { id: "payment_gateway", label: "Payment gateway", state: gateway.ready ? "ready" : "unavailable", detail: gateway.ready ? "Gateway activation is configured; settlement remains subject to independent provider re-verification." : (gateway.reason ?? "Gateway activation is unavailable."), authoritative: true },
      ...providers.map((provider) => ({ id: provider.provider, label: provider.provider.replace(/_/g, " "), state: provider.state, detail: provider.reason ?? "Configured at runtime.", authoritative: provider.state === "ready" })),
      { id: "provider_emulator_lab", label: "Development provider emulator lab", state: simulationAllowed ? "emulator" : "disabled", detail: simulationAllowed ? "Simulation may be selected only in this non-production environment; responses are non-authoritative." : "Disabled. Production use is prohibited.", authoritative: false },
    ],
    secureSettings: { available: settings.secureStorageAvailable, reason: settings.reason },
  };
}
