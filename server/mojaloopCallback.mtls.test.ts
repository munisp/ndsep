import { afterEach, describe, expect, it } from "vitest";
import { isApprovedMtlsClient } from "./mojaloopCallback";

const originalNodeEnv = process.env.NODE_ENV;
const originalSubjectAllowlist = process.env.MOJALOOP_CALLBACK_MTLS_SUBJECT_DN;
const originalGatewayAttestation =
  process.env.MOJALOOP_CALLBACK_GATEWAY_ATTESTATION;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalSubjectAllowlist === undefined)
    delete process.env.MOJALOOP_CALLBACK_MTLS_SUBJECT_DN;
  else process.env.MOJALOOP_CALLBACK_MTLS_SUBJECT_DN = originalSubjectAllowlist;
  if (originalGatewayAttestation === undefined)
    delete process.env.MOJALOOP_CALLBACK_GATEWAY_ATTESTATION;
  else
    process.env.MOJALOOP_CALLBACK_GATEWAY_ATTESTATION =
      originalGatewayAttestation;
});

function requestWithHeaders(headers: Record<string, string | string[]>) {
  return { headers } as never;
}

describe("Mojaloop callback mTLS identity boundary", () => {
  it("accepts the ingress-verified subject in the configured allowlist", () => {
    process.env.NODE_ENV = "production";
    process.env.MOJALOOP_CALLBACK_MTLS_SUBJECT_DN =
      "CN=provider-a,O=Approved DFSP,C=NG;CN=provider-b,O=Approved DFSP,C=NG";
    process.env.MOJALOOP_CALLBACK_GATEWAY_ATTESTATION = "a".repeat(48);

    expect(
      isApprovedMtlsClient(
        requestWithHeaders({
          "x-ndsep-mtls-verified": "SUCCESS",
          "x-ndsep-mtls-subject": "CN=provider-a,O=Approved DFSP,C=NG",
          "x-ndsep-mtls-gateway-attestation": "a".repeat(48),
        })
      )
    ).toBe(true);
  });

  it("rejects a trusted certificate with a subject outside the allowlist", () => {
    process.env.NODE_ENV = "production";
    process.env.MOJALOOP_CALLBACK_MTLS_SUBJECT_DN =
      "CN=provider-a,O=Approved DFSP,C=NG";
    process.env.MOJALOOP_CALLBACK_GATEWAY_ATTESTATION = "a".repeat(48);

    expect(
      isApprovedMtlsClient(
        requestWithHeaders({
          "x-ndsep-mtls-verified": "SUCCESS",
          "x-ndsep-mtls-subject": "CN=attacker,O=Unknown,C=NG",
        })
      )
    ).toBe(false);
  });

  it("rejects a caller that supplies only spoofable identity headers", () => {
    process.env.NODE_ENV = "production";
    process.env.MOJALOOP_CALLBACK_MTLS_SUBJECT_DN =
      "CN=provider-a,O=Approved DFSP,C=NG";
    process.env.MOJALOOP_CALLBACK_GATEWAY_ATTESTATION = "a".repeat(48);

    expect(
      isApprovedMtlsClient(
        requestWithHeaders({
          "x-ndsep-mtls-subject": "CN=provider-a,O=Approved DFSP,C=NG",
        })
      )
    ).toBe(false);
  });

  it("rejects an identity header with SUCCESS but no approved subject", () => {
    process.env.NODE_ENV = "production";
    process.env.MOJALOOP_CALLBACK_MTLS_SUBJECT_DN =
      "CN=provider-a,O=Approved DFSP,C=NG";
    process.env.MOJALOOP_CALLBACK_GATEWAY_ATTESTATION = "a".repeat(48);

    expect(
      isApprovedMtlsClient(
        requestWithHeaders({ "x-ndsep-mtls-verified": "SUCCESS" })
      )
    ).toBe(false);
  });

  it("does not accept a non-first multi-value header as an alternate identity", () => {
    process.env.NODE_ENV = "production";
    process.env.MOJALOOP_CALLBACK_MTLS_SUBJECT_DN =
      "CN=provider-a,O=Approved DFSP,C=NG";
    process.env.MOJALOOP_CALLBACK_GATEWAY_ATTESTATION = "a".repeat(48);

    expect(
      isApprovedMtlsClient(
        requestWithHeaders({
          "x-ndsep-mtls-verified": ["FAILURE", "SUCCESS"],
          "x-ndsep-mtls-subject": [
            "CN=attacker,O=Unknown,C=NG",
            "CN=provider-a,O=Approved DFSP,C=NG",
          ],
        })
      )
    ).toBe(false);
  });

  it("allows the test-only non-production path without weakening production", () => {
    process.env.NODE_ENV = "test";
    process.env.MOJALOOP_CALLBACK_MTLS_SUBJECT_DN = "";
    expect(isApprovedMtlsClient(requestWithHeaders({}))).toBe(true);
  });
});
