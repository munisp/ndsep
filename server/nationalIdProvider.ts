import { z } from "zod";

const providerResponseSchema = z.object({
  verified: z.boolean(),
  provider_reference: z.string().min(1).max(255),
  status: z.string().min(1).max(64),
  subject_reference: z.string().min(1).max(255).optional(),
});

export type NationalIdType =
  | "nin"
  | "bvn"
  | "passport"
  | "drivers_license"
  | "voter_card";

export type NationalIdVerification = {
  verified: boolean;
  providerReference: string;
  providerStatus: string;
  subjectReference?: string;
  provenance: "nimc_nvs_bridge" | "test_emulator";
};

export class NationalIdProviderError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "configuration"
      | "unavailable"
      | "invalid_response"
      | "simulation_forbidden"
  ) {
    super(message);
    this.name = "NationalIdProviderError";
  }
}

function configuredBridge(): { baseUrl: URL; token: string } {
  const rawUrl = process.env.NIMC_NVS_URL?.trim();
  const token = process.env.NIMC_NVS_TOKEN?.trim();
  if (!rawUrl || !token) {
    throw new NationalIdProviderError(
      "NIMC NVS bridge is not configured",
      "configuration"
    );
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawUrl);
  } catch {
    throw new NationalIdProviderError(
      "NIMC NVS bridge URL is invalid",
      "configuration"
    );
  }
  if (baseUrl.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new NationalIdProviderError(
      "NIMC NVS bridge must use HTTPS in production",
      "configuration"
    );
  }
  if (
    process.env.NODE_ENV === "production" &&
    /(^|\.)localhost$|^127\.0\.0\.1$|^0\.0\.0\.0$/i.test(baseUrl.hostname)
  ) {
    throw new NationalIdProviderError(
      "NIMC NVS bridge must not use a local address in production",
      "configuration"
    );
  }
  return { baseUrl, token };
}

function testEmulatorAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NDSEP_ALLOW_TEST_PROVIDER_EMULATORS === "true"
  );
}

/**
 * Verifies a national identifier through the configured NIMC NVS bridge. It never
 * derives verification from the supplied identifier and does not degrade to a
 * plausible local result when the bridge is absent or unavailable.
 */
export async function verifyNationalId(
  input: {
    idType: NationalIdType;
    idValue: string;
    purpose: string;
    correlationId?: string;
  },
  requestTimeoutMs = 8_000
): Promise<NationalIdVerification> {
  const { baseUrl, token } = configuredBridge();
  const endpoint = new URL("/v1/identity/verify", baseUrl);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(input.correlationId
          ? { "X-Correlation-ID": input.correlationId }
          : {}),
      },
      body: JSON.stringify({
        id_type: input.idType,
        id_value: input.idValue,
        purpose: input.purpose,
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    throw new NationalIdProviderError(
      `NIMC NVS bridge is unavailable: ${error instanceof Error ? error.name : "request failed"}`,
      "unavailable"
    );
  }

  const simulation = response.headers.get("X-NDSEP-Simulation") === "true";
  if (simulation && !testEmulatorAllowed()) {
    throw new NationalIdProviderError(
      "Test-only NIMC emulator response is forbidden outside an explicitly enabled non-production environment",
      "simulation_forbidden"
    );
  }
  if (!response.ok) {
    throw new NationalIdProviderError(
      `NIMC NVS bridge returned HTTP ${response.status}`,
      "unavailable"
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new NationalIdProviderError(
      "NIMC NVS bridge returned a non-JSON response",
      "invalid_response"
    );
  }
  const parsed = providerResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new NationalIdProviderError(
      "NIMC NVS bridge returned an invalid verification response",
      "invalid_response"
    );
  }

  return {
    verified: parsed.data.verified,
    providerReference: parsed.data.provider_reference,
    providerStatus: parsed.data.status,
    ...(parsed.data.subject_reference
      ? { subjectReference: parsed.data.subject_reference }
      : {}),
    provenance: simulation ? "test_emulator" : "nimc_nvs_bridge",
  };
}
