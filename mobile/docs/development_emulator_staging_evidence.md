# Development Emulator Staging Evidence

## Scope

This evidence covers a **test-only** local flow between the built-in Keycloak-compatible development emulator and the Docling-compatible development emulator. It is not evidence of a live Keycloak deployment, a real Docling service, a production identity, document authenticity, KYC/KYB approval, NIMC verification, CAC verification, or title verification.

## Executed flow

| Step | Result | Trust meaning |
|---|---|---|
| Development emulators enabled under test runtime | Passed | The runtime requires explicit opt-in and excludes production. |
| Keycloak-compatible discovery endpoint requested | Passed | Returned an emulator-labelled OIDC discovery document. |
| Short-lived RS256 test token issued | Passed | Token includes `emulator: true` and `verified: false`; it is non-verifying by design. |
| Docling-compatible conversion called with bearer token | Passed | The emulator accepted only the test-only token and returned a document marked `emulator: true` and `verified: false`. |
| Emulator endpoint requested in production runtime | Rejected | Route returned `404`; production use is prohibited. |

## Validation command

```sh
pnpm run check && pnpm exec vitest run tests/integration-settings-and-emulators.test.ts
```

The command passed with **4 tests passed**. The staging conversion output is deliberately a warning-bearing development artifact and must never be persisted as a genuine Docling result or used to authorize a land, identity, business, or permit decision.

## Production configuration status

| Service | Status |
|---|---|
| Server encryption key | Unconfigured by user decision |
| Bootstrap administrator identity | Unconfigured by user decision |
| NIMC NVS bridge | Unconfigured by user decision |
| CAC bridge | Unconfigured by user decision |
| Keycloak / Docling emulators | Test-only, disabled unless explicitly enabled outside production |
