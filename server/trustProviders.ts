export type ProviderState = "ready" | "unavailable" | "failed";

export type ProviderHealth = {
  provider: "docling" | "dojah_liveness" | "nimc_nvs_bridge" | "cac_vas_bridge" | "state_registry_bridge";
  state: ProviderState;
  reason: string | null;
  configuredAtRuntime: boolean;
};

type ProviderResult<T> =
  | { state: "ready"; provider: string; value: T }
  | { state: "unavailable" | "failed"; provider: string; reason: string };

type AuthoritativeBridgeResponse = {
  status: "verified" | "not_verified" | "requires_review";
  providerReference?: string | null;
  reason?: string | null;
  attributes?: Record<string, string | number | boolean | null>;
};

function nonEmpty(value: string | undefined | null) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function doclingConfig() {
  const baseUrl = nonEmpty(process.env.DOCLING_SERVICE_URL);
  const apiKey = nonEmpty(process.env.DOCLING_SERVICE_API_KEY);
  return { baseUrl, apiKey };
}

function dojahConfig() {
  const appId = nonEmpty(process.env.DOJAH_APP_ID);
  const secretKey = nonEmpty(process.env.DOJAH_SECRET_KEY);
  return { appId, secretKey };
}

function bridgeConfig(prefix: "NIMC_NVS" | "CAC_VAS" | "STATE_REGISTRY") {
  const endpoint = nonEmpty(process.env[`${prefix}_BRIDGE_URL`]);
  const token = nonEmpty(process.env[`${prefix}_BRIDGE_TOKEN`]);
  return { endpoint, token };
}

function firstText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["markdown", "text", "content"] as const) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  for (const key of ["document", "result", "conversion_result"] as const) {
    const nested = firstText(record[key]);
    if (nested) return nested;
  }
  if (Array.isArray(record.documents)) {
    for (const document of record.documents) {
      const nested = firstText(document);
      if (nested) return nested;
    }
  }
  return null;
}

export function getProviderHealth(): ProviderHealth[] {
  const docling = doclingConfig();
  const dojah = dojahConfig();
  const nimc = bridgeConfig("NIMC_NVS");
  const cac = bridgeConfig("CAC_VAS");
  const registry = bridgeConfig("STATE_REGISTRY");
  return [
    {
      provider: "docling",
      state: docling.baseUrl ? "ready" : "unavailable",
      reason: docling.baseUrl ? null : "Set DOCLING_SERVICE_URL to a secured Docling Serve endpoint.",
      configuredAtRuntime: Boolean(docling.baseUrl),
    },
    {
      provider: "dojah_liveness",
      state: dojah.appId && dojah.secretKey ? "ready" : "unavailable",
      reason: dojah.appId && dojah.secretKey ? null : "Set DOJAH_APP_ID and DOJAH_SECRET_KEY to enable provider liveness screening.",
      configuredAtRuntime: Boolean(dojah.appId && dojah.secretKey),
    },
    {
      provider: "nimc_nvs_bridge",
      state: nimc.endpoint && nimc.token ? "ready" : "unavailable",
      reason: nimc.endpoint && nimc.token ? null : "NIMC NVS access requires an approved VPN-connected bridge and its service token.",
      configuredAtRuntime: Boolean(nimc.endpoint && nimc.token),
    },
    {
      provider: "cac_vas_bridge",
      state: cac.endpoint && cac.token ? "ready" : "unavailable",
      reason: cac.endpoint && cac.token ? null : "CAC verification requires a contracted CAC VAS or authorized NIBSS/CAC bridge endpoint.",
      configuredAtRuntime: Boolean(cac.endpoint && cac.token),
    },
    {
      provider: "state_registry_bridge",
      state: registry.endpoint && registry.token ? "ready" : "unavailable",
      reason: registry.endpoint && registry.token ? null : "No official unified Nigerian land-registry API is configured; connect an authorized state registry bridge.",
      configuredAtRuntime: Boolean(registry.endpoint && registry.token),
    },
  ];
}

export async function convertWithDocling(input: {
  fileName: string;
  mimeType: string;
  base64Data: string;
}): Promise<ProviderResult<{ text: string; source: "docling" }>> {
  const config = doclingConfig();
  if (!config.baseUrl) {
    return { state: "unavailable", provider: "docling", reason: "Docling Serve is not configured." };
  }

  try {
    const response = await fetch(`${config.baseUrl}/v1/convert/source`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { "X-Api-Key": config.apiKey } : {}),
      },
      body: JSON.stringify({
        options: { to_formats: ["text", "md"], do_ocr: true, force_ocr: true, abort_on_error: true },
        file_sources: [{ base64_string: input.base64Data, filename: input.fileName }],
      }),
    });
    if (!response.ok) {
      return { state: "failed", provider: "docling", reason: `Docling Serve returned HTTP ${response.status}.` };
    }
    const payload = (await response.json()) as unknown;
    const text = firstText(payload);
    if (!text) {
      return { state: "failed", provider: "docling", reason: "Docling Serve returned no recognized text or Markdown conversion field." };
    }
    return { state: "ready", provider: "docling", value: { text, source: "docling" } };
  } catch (error) {
    return { state: "failed", provider: "docling", reason: `Docling request failed: ${error instanceof Error ? error.message : "unknown error"}` };
  }
}

export async function verifyDojahLiveness(input: {
  base64Data: string;
}): Promise<ProviderResult<{ passed: boolean; probability: number | null; faceDetected: boolean; providerReference: string | null }>> {
  const config = dojahConfig();
  if (!config.appId || !config.secretKey) {
    return { state: "unavailable", provider: "dojah_liveness", reason: "Dojah liveness credentials are not configured." };
  }
  try {
    const response = await fetch("https://api.dojah.io/api/v1/ml/liveness", {
      method: "POST",
      headers: { Authorization: config.secretKey, AppId: config.appId, "Content-Type": "application/json" },
      body: JSON.stringify({ image: input.base64Data.replace(/^data:[^;]+;base64,/, "") }),
    });
    if (!response.ok) {
      return { state: "failed", provider: "dojah_liveness", reason: `Dojah liveness returned HTTP ${response.status}.` };
    }
    const payload = (await response.json()) as {
      entity?: { liveness?: { liveness_check?: unknown; liveness_probability?: unknown }; face?: { face_detected?: unknown } };
    };
    const liveness = payload.entity?.liveness;
    if (typeof liveness?.liveness_check !== "boolean") {
      return { state: "failed", provider: "dojah_liveness", reason: "Dojah response did not contain a boolean liveness result." };
    }
    return {
      state: "ready",
      provider: "dojah_liveness",
      value: {
        passed: liveness.liveness_check,
        probability: typeof liveness.liveness_probability === "number" ? liveness.liveness_probability : null,
        faceDetected: payload.entity?.face?.face_detected === true,
        providerReference: null,
      },
    };
  } catch (error) {
    return { state: "failed", provider: "dojah_liveness", reason: `Dojah liveness request failed: ${error instanceof Error ? error.message : "unknown error"}` };
  }
}

async function callAuthoritativeBridge(
  provider: "nimc_nvs_bridge" | "cac_vas_bridge" | "state_registry_bridge",
  config: { endpoint: string | null; token: string | null },
  payload: Record<string, unknown>,
): Promise<ProviderResult<AuthoritativeBridgeResponse>> {
  if (!config.endpoint || !config.token) {
    return { state: "unavailable", provider, reason: `${provider} is not configured.` };
  }
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return { state: "failed", provider, reason: `${provider} returned HTTP ${response.status}.` };
    const result = (await response.json()) as Partial<AuthoritativeBridgeResponse>;
    if (result.status !== "verified" && result.status !== "not_verified" && result.status !== "requires_review") {
      return { state: "failed", provider, reason: `${provider} returned an invalid normalized verification status.` };
    }
    return {
      state: "ready",
      provider,
      value: {
        status: result.status,
        providerReference: typeof result.providerReference === "string" ? result.providerReference : null,
        reason: typeof result.reason === "string" ? result.reason : null,
        attributes: result.attributes && typeof result.attributes === "object" ? result.attributes : {},
      },
    };
  } catch (error) {
    return { state: "failed", provider, reason: `${provider} request failed: ${error instanceof Error ? error.message : "unknown error"}` };
  }
}

export function verifyNationalIdentity(input: { nin: string; legalName?: string | null; dateOfBirth?: string | null }) {
  return callAuthoritativeBridge("nimc_nvs_bridge", bridgeConfig("NIMC_NVS"), { verificationType: "nin", ...input });
}

export function verifyBusinessRegistration(input: { rcNumber: string; companyName?: string | null }) {
  return callAuthoritativeBridge("cac_vas_bridge", bridgeConfig("CAC_VAS"), { verificationType: "cac", ...input });
}

export function verifyRegistryTitle(input: { state: string; registryReference: string; parcelNumber?: string | null }) {
  return callAuthoritativeBridge("state_registry_bridge", bridgeConfig("STATE_REGISTRY"), { verificationType: "land_title", ...input });
}
