# Staging Supervisory API Acceptance Environment

This document configures the **external controls** required by `.github/workflows/staging-supervisory-api-acceptance.yml`. The workflow has been added to source control; the secrets, runner isolation, deployment payload and GitHub environment protection described below must be configured by authorized platform/security administrators before the live staging gate can run.

## 1. Release decision flow

A candidate is first published under an immutable OCI digest, validated by the existing final-digest scan/signature/attestation process, and deployed to the controlled staging environment. The staging deployment controller creates a GitHub deployment with `environment: staging`, the candidate commit SHA and `payload.image_digest` set to the exact full OCI digest. Only after that deployment reports `success` does the acceptance workflow receive environment secrets and run the mTLS contract suite.

A production deployment must treat **Staging mTLS supervisory API acceptance** as a required predecessor for the same candidate commit and OCI digest. A successful production image build, an Elastic event or a dashboard label is not a substitute for that result.

| Decision stage | Required proof | Block condition |
|---|---|---|
| Candidate build | Immutable image digest, direct final-image scan and signed release evidence. | Tag-only image reference, unsigned image/attestation, or unwaived HIGH/CRITICAL result. |
| Staging deploy | GitHub deployment has `environment: staging`, correct commit SHA and `payload.image_digest`. | Missing/malformed digest, arbitrary test URL, or environment other than staging. |
| Staging acceptance | Local response-schema suite and protected mTLS integration suite both pass against the same digest. | Missing secret, pin/certificate/token failure, schema/error mismatch, failed/omitted mandatory test. |
| Promotion | Production change record references candidate digest and successful staging acceptance run ID. | Digest mismatch, stale result, failed/cancelled test, or missing evidence reference. |

## 2. GitHub environment: `staging-supervisory-acceptance`

Create an environment named exactly `staging-supervisory-acceptance` in the repository settings. Restrict deployments to the staging branch/deployment workflow and require the designated platform-security and compliance reviewers. Environment protection is necessary because GitHub does not expose environment secrets to a job until its protection rules are satisfied.[1]

The `staging-mtls-contract` job must run only on an isolated runner group labeled:

```text
self-hosted, linux, ndsep-staging-internal
```

That runner group must have private network reachability only to the staging supervisory gateway and staging identity/evidence dependencies. It must not mount production Kubernetes credentials, production PostgreSQL passwords, production private-key material, or a production CBN delivery credential. Use disposable runner workspaces or explicit cleanup controls. The workflow removes the temporary mTLS directory in an `always()` step.

## 3. Required protected secrets

Store each listed value as an **environment secret** of `staging-supervisory-acceptance`, not as a repository variable, runner label, workflow input or source file.

| Secret name | Required value | Rule |
|---|---|---|
| `CBN_STAGING_SUPERVISORY_API_URL` | Staging gateway HTTPS origin. | Must resolve to a controlled non-production gateway. |
| `CBN_STAGING_SUPERVISORY_API_SPKI_PINS` | Comma-separated active and next base64 SHA-256 SPKI pins. | At least two values. Rotate using the mTLS recovery procedure. |
| `CBN_STAGING_SUPERVISORY_API_BOUND_TOKEN` | Short-lived OAuth access token with `ndsep.supervisory.read`, certificate-bound to the test client certificate. | Must expire promptly and be unusable without the matching mTLS private key. |
| `CBN_STAGING_SUPERVISORY_API_EVENT_ID_AUTHORIZED` | Redacted fixture UUID inside the test client’s portfolio. | No customer or production event. |
| `CBN_STAGING_SUPERVISORY_API_EVENT_ID_OUT_OF_SCOPE` | Redacted fixture UUID outside the test client’s portfolio. | Used only to verify non-enumerating `404`. |
| `CBN_STAGING_SUPERVISORY_API_EVENT_ID_INTEGRITY_UNAVAILABLE` | Safe test fixture UUID with controlled verifier-unavailable behavior. | Required before treating the `503` negative case as executed. |
| `CBN_STAGING_SUPERVISORY_API_WRONG_SCOPE_TOKEN` | Short-lived certificate-bound test token without `ndsep.supervisory.read`. | Used only to verify `403`. |
| `CBN_STAGING_SUPERVISORY_API_INVALID_TOKEN` | Expired/invalid, non-production token. | Used only to verify `401`. |
| `CBN_STAGING_SUPERVISORY_API_BAD_SPKI_PINS` | Deliberately incorrect base64 pins. | Must never equal an active/next production or staging pin. |
| `CBN_STAGING_SUPERVISORY_API_CA_PEM_B64` | Base64 encoded non-production CA trust bundle. | No production CA roots. |
| `CBN_STAGING_SUPERVISORY_API_CLIENT_CERT_PEM_B64` | Base64 encoded short-lived non-production client certificate. | Exact test workload URI SAN only. |
| `CBN_STAGING_SUPERVISORY_API_CLIENT_KEY_PEM_B64` | Base64 encoded corresponding client private key. | HSM/workload-identity issuance preferred; if file based, short-lived and runner-read-only. |

Do not publish any secret value, decoded PEM, response body, event record, raw evidence URI or CBN report content to a test artifact or job summary.

## 4. Required staging gateway behavior

The candidate gateway must use TLS 1.3, require a client certificate, validate private trust bundle and active-plus-next SPKI pin set, authorize only the expected workload URI SAN, and validate the certificate-bound token `cnf.x5t#S256`. The gateway returns the following headers on valid success responses:

```text
X-Request-ID: <server-generated UUID/correlation ID>
X-NDSEP-Evidence-As-Of: <RFC3339 UTC timestamp>
X-NDSEP-Release-Digest: sha256:<64 lowercase hexadecimal characters>
```

The release digest header must equal `deployment.payload.image_digest`. The gateway must never accept a request that uses the token with a different client certificate, missing pin, unauthenticated TLS connection, client-supplied `org_id`/`institution_id`, or forbidden supervisory write request. See `tests/supervisory-api-contract/README.md` for the complete acceptance matrix.

## 5. GitHub deployment payload contract

The staging deployment controller must create the deployment/status against the candidate commit, using a payload structurally equivalent to:

```json
{
  "environment": "staging",
  "ref": "<candidate commit SHA>",
  "payload": {
    "image_digest": "sha256:<64 lowercase hexadecimal characters>",
    "image_repository": "ghcr.io/munisp/ndsep",
    "release_evidence_id": "<verified release evidence ID>"
  }
}
```

The `image_digest` is required; a tag such as `latest` or a commit SHA is not an OCI digest and must cause the acceptance workflow to fail. The environment secret supplies the fixed staging gateway URL; the deployment payload cannot change the network target.

## 6. Required production-promotion rule

Configure the production deployment/GitOps controller so that it consumes only the OCI digest named in a successful staging acceptance record. The control plane must compare all three fields before promotion:

1. Candidate commit SHA.
2. Candidate OCI index digest.
3. GitHub Actions run URL/ID with a successful **Staging mTLS supervisory API acceptance** job.

Record those fields in the append-only release/evidence ledger. A retry or manual revalidation must name the same digest and staging deployment. A replacement digest requires a new staging deployment and new acceptance run; it cannot inherit a prior result.

## 7. Verification and emergency behavior

Before enabling production reliance, run the local unit suite, then staging mTLS suite against a deliberately valid fixture and each mandatory negative condition. Review the job log only through the protected run interface. Verify that the summary contains no secret/response content, that the temporary credential directory was removed, and that gateway/PostgreSQL audit records show read-only portfolio-scoped calls.

A missing/expired staging secret, pin mismatch, certificate/token mismatch, unavailable verifier, schema mismatch, response digest mismatch, or skipped mandatory negative test is a **failed promotion gate**. Follow the mTLS trust-bundle/pin disaster-recovery procedure; do not alter `failurePolicy: Fail`, remove mTLS, replace the staging URL, or substitute an unbound bearer token to force a pass.

## References

[1] [GitHub Docs: Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
[2] [GitHub Docs: Using secrets in GitHub Actions](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)
[3] [IETF RFC 8705: OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens](https://datatracker.ietf.org/doc/html/rfc8705)
[4] [NDSEP mTLS trust-bundle and pin disaster-recovery procedure](MTLS_TRUST_BUNDLE_AND_PIN_DISASTER_RECOVERY.md)
