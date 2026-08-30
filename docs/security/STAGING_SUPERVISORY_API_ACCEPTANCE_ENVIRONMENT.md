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


## 8. Exact operator walkthrough — configure and execute the live staging gate

> **Prerequisites:** complete this procedure only after PR #17 is approved and merged through the protected review workflow. Use a staging-only gateway, a staging-only PostgreSQL projection, a non-production private CA, non-production test fixtures and a restricted staging runner. Do not use a production CBN endpoint, production CA, production user certificate, customer record, or production delivery credential.

### 8.1 Establish the protected GitHub environment

1. In the repository, open **Settings → Environments → New environment** and create exactly `staging-supervisory-acceptance`. The workflow name and environment name must match.
2. In the environment’s deployment-protection settings, restrict permitted branches/tags to the organization’s controlled `staging` deployment flow. Do not enable all branches.
3. Add at least two designated reviewers from separate functions: one platform-security approver and one compliance approver. Enable prevention of self-review. Record their approved role names in the change ticket, not their personal contact details in the workflow.
4. Bind the self-hosted runner used by the job to an isolated runner group with the labels `self-hosted`, `linux`, and `ndsep-staging-internal`. Restrict that runner’s network egress to the staging supervisory gateway, test identity service and required audit/evidence dependencies. It must have no production Kubernetes, database or regulatory-delivery credential.
5. Confirm that the staging deployment controller creates a GitHub deployment event with `environment: staging`, the candidate commit SHA, and a JSON payload containing the immutable published index digest as `image_digest`. A tag, a source SHA, or a digest that differs from the deployed gateway’s header must fail the gate.

GitHub environment protection rules control access to environment secrets; a job that requires approval cannot access its environment secrets until a required reviewer approves the deployment.[5]

### 8.2 Provision redacted staging test fixtures

6. Deploy the candidate from the exact `sha256:<64 hexadecimal characters>` OCI index digest to the controlled staging namespace. Configure the API gateway to return that same value in `X-NDSEP-Release-Digest` for successful supervisory API responses.
7. Using the staging evidence service—not a browser or direct database update—create three **redacted non-production** fixtures: (a) one event inside the test client’s claim-derived supervisory portfolio, (b) one event outside it, and (c) one controlled fixture whose integrity verifier returns `503`/unavailable. Record their UUIDs in the approved change record.
8. Obtain three short-lived staging-only OAuth tokens from the identity system: `ndsep.supervisory.read` bound to the acceptance client certificate; an otherwise valid mTLS-bound token with no read scope; and an expired/invalid test token. The gateway must enforce the RFC 8705 `cnf.x5t#S256` binding for all protected calls.[3]
9. Issue a short-lived client certificate with the exact acceptance workload URI SAN and a separate staging-only gateway certificate. Keep both current and next valid gateway issuer/server SPKI pins in the active-plus-next rotation state. Confirm that the CA bundle, client certificate and client key are non-production material.

### 8.3 Prepare values without leaking sensitive material

On the restricted PKI/operator workstation, derive the current/next SPKI pins from the two approved staging gateway certificates. The following command computes one base64 SHA-256 SPKI pin; run it once for the active certificate and once for the pre-approved next certificate, then join the two values with a comma.

```bash
openssl x509 -in gateway-active.crt -pubkey -noout \
  | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 -binary \
  | base64
```

Encode PEM **files** without printing their contents to terminal history. On GNU/Linux use:

```bash
base64 --wrap=0 staging-ca.pem > staging-ca.pem.b64
base64 --wrap=0 acceptance-client.crt > acceptance-client.crt.b64
base64 --wrap=0 acceptance-client.key > acceptance-client.key.b64
chmod 600 staging-ca.pem.b64 acceptance-client.crt.b64 acceptance-client.key.b64
```

Prepare an intentionally invalid SPKI pin only for the negative test. It must be valid base64 but must not equal any active, next, retired or production pin. Do not generate it from production key material.

### 8.4 Add secrets with the GitHub CLI

The following commands read values from files/stdin and do not put PEM material into source control. Run them from the protected operator workstation after authenticating the CLI with a least-privilege administrative identity. Replace bracketed values only with staging values. Never paste the values into a chat, command shell history, workflow dispatch input or GitHub Actions variable.

```bash
# Fixed non-secret target/fixture configuration is still stored as secrets so that
# staging topology and record identifiers are not exposed in pull-request logs.
gh secret set CBN_STAGING_SUPERVISORY_API_URL \
  --repo munisp/ndsep --env staging-supervisory-acceptance \
  --body 'https://supervisory-api.staging.internal'

gh secret set CBN_STAGING_SUPERVISORY_API_SPKI_PINS \
  --repo munisp/ndsep --env staging-supervisory-acceptance \
  --body "$(cat staging-active-plus-next-pins.txt)"

gh secret set CBN_STAGING_SUPERVISORY_API_EVENT_ID_AUTHORIZED \
  --repo munisp/ndsep --env staging-supervisory-acceptance \
  --body '[authorized-redacted-fixture-uuid]'
gh secret set CBN_STAGING_SUPERVISORY_API_EVENT_ID_OUT_OF_SCOPE \
  --repo munisp/ndsep --env staging-supervisory-acceptance \
  --body '[out-of-scope-redacted-fixture-uuid]'
gh secret set CBN_STAGING_SUPERVISORY_API_EVENT_ID_INTEGRITY_UNAVAILABLE \
  --repo munisp/ndsep --env staging-supervisory-acceptance \
  --body '[integrity-unavailable-redacted-fixture-uuid]'

gh secret set CBN_STAGING_SUPERVISORY_API_CA_PEM_B64 \
  --repo munisp/ndsep --env staging-supervisory-acceptance < staging-ca.pem.b64
gh secret set CBN_STAGING_SUPERVISORY_API_CLIENT_CERT_PEM_B64 \
  --repo munisp/ndsep --env staging-supervisory-acceptance < acceptance-client.crt.b64
gh secret set CBN_STAGING_SUPERVISORY_API_CLIENT_KEY_PEM_B64 \
  --repo munisp/ndsep --env staging-supervisory-acceptance < acceptance-client.key.b64

gh secret set CBN_STAGING_SUPERVISORY_API_BOUND_TOKEN \
  --repo munisp/ndsep --env staging-supervisory-acceptance < read-scope-bound-token.txt
gh secret set CBN_STAGING_SUPERVISORY_API_WRONG_SCOPE_TOKEN \
  --repo munisp/ndsep --env staging-supervisory-acceptance < wrong-scope-bound-token.txt
gh secret set CBN_STAGING_SUPERVISORY_API_INVALID_TOKEN \
  --repo munisp/ndsep --env staging-supervisory-acceptance < invalid-token.txt
gh secret set CBN_STAGING_SUPERVISORY_API_BAD_SPKI_PINS \
  --repo munisp/ndsep --env staging-supervisory-acceptance < intentionally-invalid-pins.txt
```

After setting them, use `gh secret list --repo munisp/ndsep --env staging-supervisory-acceptance` only to confirm **secret names**. The CLI cannot retrieve secret values, and no person should attempt to do so through GitHub.

### 8.5 Execute the mandatory live mTLS acceptance job

10. Trigger the normal staging deployment for the candidate digest. After the deployment controller marks that exact deployment successful, GitHub starts **Staging Supervisory API Acceptance**. A reviewer approves the protected `staging-supervisory-acceptance` environment only after confirming the deployment SHA/digest/change ticket.
11. To repeat the test without a redeploy, use a reviewed manual revalidation from a branch containing the approved workflow. Supply only the full digest—not a URL, token, pin, certificate or event ID—in the dispatch input:

```bash
gh workflow run staging-supervisory-api-acceptance.yml \
  --repo munisp/ndsep \
  --ref production \
  -f expected_release_digest='sha256:[64 lowercase hexadecimal characters]'
```

12. Approve the environment when GitHub prompts the designated reviewers. The job first runs the dependency-free schema tests, validates required configuration, materializes the short-lived staging PEM files under the runner’s temporary directory with `0600` key permissions, and runs the live read-only test suite.
13. The suite passes only if the gateway performs TLS 1.3 mTLS, the server key is one of the active/next pins, client URI-SAN/token binding is accepted, response headers attest the exact candidate digest, authorized results meet schema/minimization rules, and mandatory negative requests return the expected `401`, `403`, `404`, `405`, `400` and `503` behavior. It must also show SPKI mismatch failure before HTTP processing.
14. Review the protected job log for the test result and runner cleanup. Retain only the accepted run URL/ID, deployment SHA/digest, timestamps, sanitized request IDs, result, and operator approvals in the evidence ledger. Do not attach test responses, raw evidence, private keys, certificates or tokens to the change ticket.
15. Confirm the job’s `Remove mTLS key material` step ran under `always()`, and revoke/expire the issued test token/certificate after the test window. Review gateway and PostgreSQL audit records to prove that requests were read-only and claim-scoped.
16. Mark the candidate eligible for the next promotion only if the complete acceptance run succeeds for the **same** source SHA and OCI digest, the final digest scan/signatures/attestations remain valid, and any required evidence record has passed verification. A missing, skipped, expired or failed live test is a blocked promotion—not an exception.

### 8.6 Current implementation status

As of the PR #17 review, the repository has no GitHub environment configured. The pull-request run therefore completed the unit test job but marked **Staging mTLS supervisory API acceptance** as **skipped**, which is expected because it only runs for a successful `staging` deployment or an approved manual dispatch. It is inaccurate to attest that the live mTLS gate has completed until the environment, runner, secret inventory, staging gateway, fixtures and approved deployment are present and a run succeeds.

[5] [GitHub Docs: Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
