import { z } from "zod";

const responseSchema = z.object({
  verified: z.boolean(),
  provider_reference: z.string().min(1).max(255),
  status: z.string().min(1).max(64),
  legal_name: z.string().min(1).max(512).optional(),
  registration_type: z.string().min(1).max(64).optional(),
});

export type CacBusinessVerification = {
  verified: boolean;
  providerReference: string;
  providerStatus: string;
  legalName?: string;
  registrationType?: string;
  provenance: "cac_bridge" | "test_emulator";
};

export class CacProviderError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "configuration"
      | "unavailable"
      | "invalid_response"
      | "simulation_forbidden"
  ) {
    super(message);
    this.name = "CacProviderError";
  }
}

function configuredBridge(): { baseUrl: URL; token: string } {
  const rawUrl = process.env.CAC_BRIDGE_URL?.trim();
  const token = process.env.CAC_BRIDGE_TOKEN?.trim();
  if (!rawUrl || !token) {
    throw new CacProviderError("CAC bridge is not configured", "configuration");
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawUrl);
  } catch {
    throw new CacProviderError("CAC bridge URL is invalid", "configuration");
  }
  if (process.env.NODE_ENV === "production") {
    if (baseUrl.protocol !== "https:") {
      throw new CacProviderError(
        "CAC bridge must use HTTPS in production",
        "configuration"
      );
    }
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(baseUrl.hostname)) {
      throw new CacProviderError(
        "CAC bridge must not use a local address in production",
        "configuration"
      );
    }
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
 * Verifies a CAC business-registration number only through an approved configured
 * bridge. Missing, timed-out, malformed, or simulated-for-production responses
 * always fail closed and are never translated into a business-verification result.
 */
export async function verifyBusinessRegistration(
  input: {
    registrationNumber: string;
    purpose: string;
    correlationId?: string;
  },
  requestTimeoutMs = 8_000
): Promise<CacBusinessVerification> {
  const { baseUrl, token } = configuredBridge();
  const endpoint = new URL("/v1/business/verify", baseUrl);
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
        registration_number: input.registrationNumber,
        purpose: input.purpose,
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    throw new CacProviderError(
      `CAC bridge is unavailable: ${error instanceof Error ? error.name : "request failed"}`,
      "unavailable"
    );
  }

  const simulation = response.headers.get("X-NDSEP-Simulation") === "true";
  if (simulation && !testEmulatorAllowed()) {
    throw new CacProviderError(
      "Test-only CAC emulator response is forbidden outside an explicitly enabled non-production environment",
      "simulation_forbidden"
    );
  }
  if (!response.ok) {
    throw new CacProviderError(
      `CAC bridge returned HTTP ${response.status}`,
      "unavailable"
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CacProviderError(
      "CAC bridge returned a non-JSON response",
      "invalid_response"
    );
  }
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new CacProviderError(
      "CAC bridge returned an invalid verification response",
      "invalid_response"
    );
  }

  return {
    verified: parsed.data.verified,
    providerReference: parsed.data.provider_reference,
    providerStatus: parsed.data.status,
    ...(parsed.data.legal_name ? { legalName: parsed.data.legal_name } : {}),
    ...(parsed.data.registration_type
      ? { registrationType: parsed.data.registration_type }
      : {}),
    provenance: simulation ? "test_emulator" : "cac_bridge",
  };
}
