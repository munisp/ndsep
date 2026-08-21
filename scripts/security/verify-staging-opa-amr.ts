#!/usr/bin/env tsx
/**
 * Staging-only OPA and Keycloak AMR verification.
 *
 * Required GitHub Environment secrets:
 *   STAGING_TEST_BASE_URL
 *   STAGING_NO_MFA_TOKEN
 *   STAGING_MFA_TOKEN
 *   STAGING_OPA_INTERNAL_URL
 *   STAGING_OPA_OUTAGE_CANARY_URL
 * Optional:
 *   STAGING_OPA_TEST_TOKEN
 *   STAGING_CANARY_PATH (defaults to a non-mutating admin query)
 *
 * The outage URL must route to an isolated canary API deployment whose OPA
 * dependency is intentionally unreachable. Never pause shared staging OPA from
 * CI and never target production.
 */

const acceptedMfaMethods = new Set(["mfa", "otp", "webauthn", "hwk", "fido2"]);
const canaryPath = process.env.STAGING_CANARY_PATH ?? "/trpc/securityAudit.getLatest?input=%7B%22json%22%3Anull%7D";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function ensureStagingUrl(name: string, raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
  if (!/staging/i.test(url.hostname)) throw new Error(`${name} must target a staging hostname`);
  return url;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("token is not a JWT");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
  const parsed: unknown = JSON.parse(Buffer.from(normalized, "base64url").toString("utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error("token payload is not an object");
  return parsed as Record<string, unknown>;
}

function containsAcceptedMfa(payload: Record<string, unknown>): boolean {
  const amr = payload.amr;
  return Array.isArray(amr) && amr.some((entry) => typeof entry === "string" && acceptedMfaMethods.has(entry.toLowerCase()));
}

async function request(url: string, token: string, requestId: string): Promise<{ status: number; body: string; elapsedMs: number }> {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Request-ID": requestId,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    return { status: response.status, body: await response.text(), elapsedMs: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timeout);
  }
}

function assertStatus(caseName: string, actual: number, expected: number, body: string): void {
  if (actual !== expected) {
    const boundedBody = body.slice(0, 500).replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]");
    throw new Error(`${caseName}: expected HTTP ${expected}, got ${actual}; body=${boundedBody}`);
  }
}

async function main(): Promise<void> {
  const base = ensureStagingUrl("STAGING_TEST_BASE_URL", required("STAGING_TEST_BASE_URL"));
  const outageBase = ensureStagingUrl("STAGING_OPA_OUTAGE_CANARY_URL", required("STAGING_OPA_OUTAGE_CANARY_URL"));
  const noMfaToken = required("STAGING_NO_MFA_TOKEN");
  const mfaToken = required("STAGING_MFA_TOKEN");
  const opaUrl = required("STAGING_OPA_INTERNAL_URL").replace(/\/$/, "");
  const opaToken = process.env.STAGING_OPA_TEST_TOKEN?.trim();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const noMfaPayload = decodeJwtPayload(noMfaToken);
  const mfaPayload = decodeJwtPayload(mfaToken);
  if (containsAcceptedMfa(noMfaPayload)) throw new Error("OPA-01 fixture token unexpectedly carries an accepted MFA AMR value");
  if (!containsAcceptedMfa(mfaPayload)) throw new Error("MFA fixture token has no accepted AMR value; do not bypass this gate");

  // OPA-01: application must deny privileged request despite valid prior authorization.
  const opa01 = await request(new URL(canaryPath, base).toString(), noMfaToken, `ci-opa01-${timestamp}`);
  assertStatus("OPA-01 password-only privileged denial", opa01.status, 403, opa01.body);
  if (!opa01.body.includes("Policy decision denied or unavailable")) {
    throw new Error("OPA-01 did not return the expected fail-closed policy denial envelope");
  }
  console.log(`PASS OPA-01: 403 in ${opa01.elapsedMs}ms`);

  // Positive control: proves the application cryptographically accepted a freshly
  // issued MFA session and passed it through the full authorization chain.
  const mfaExpectedStatus = Number(process.env.STAGING_MFA_EXPECTED_STATUS ?? "200");
  const amrPositive = await request(new URL(canaryPath, base).toString(), mfaToken, `ci-amr-${timestamp}`);
  assertStatus("Signed Keycloak AMR privileged positive control", amrPositive.status, mfaExpectedStatus, amrPositive.body);
  console.log(`PASS AMR positive control: ${mfaExpectedStatus} in ${amrPositive.elapsedMs}ms`);

  // OPA-02: internal policy-unit query is never exposed through Caddy/APISIX.
  const opa02Response = await fetch(`${opaUrl}/v1/data/ndsep/authz/allow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opaToken ? { Authorization: `Bearer ${opaToken}` } : {}),
    },
    body: JSON.stringify({
      input: {
        subject: { id: "ci-opa-nomfa", role: "admin", authenticated: true },
        action: "admin",
        resource: "securityAudit.getLatest",
        context: { environment: "production", mfaVerified: false, requestId: `ci-opa02-${timestamp}` },
      },
    }),
  });
  const opa02Body: unknown = await opa02Response.json().catch(() => null);
  if (!opa02Response.ok || !opa02Body || typeof opa02Body !== "object" || (opa02Body as { result?: unknown }).result !== false) {
    throw new Error(`OPA-02 expected a literal policy deny; HTTP ${opa02Response.status}`);
  }
  console.log("PASS OPA-02: direct policy decision denied without MFA");

  // OPA-03: predeployed outage canary uses a separate API instance with OPA_URL
  // deliberately black-holed. It protects shared staging availability.
  const opa03 = await request(new URL(canaryPath, outageBase).toString(), mfaToken, `ci-opa03-${timestamp}`);
  assertStatus("OPA-03 OPA outage denial", opa03.status, 403, opa03.body);
  if (!opa03.body.includes("Policy decision denied or unavailable")) {
    throw new Error("OPA-03 did not return the expected fail-closed policy denial envelope");
  }
  if (opa03.elapsedMs > 8_000) throw new Error(`OPA-03 exceeded the bounded test budget: ${opa03.elapsedMs}ms`);
  console.log(`PASS OPA-03: outage denied in ${opa03.elapsedMs}ms`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`STAGING SECURITY VERIFICATION FAILED: ${message}`);
  process.exitCode = 1;
});
