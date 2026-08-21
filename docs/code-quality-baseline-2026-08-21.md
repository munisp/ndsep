# Code Quality and Coverage Baseline

**Assessment date:** 21 August 2026  
**Scope:** Source as checked out in `/home/ubuntu/idlr_pts_mobile`, including a disposable local PostgreSQL 16 payment-audit test database; native-device and external-provider execution remain outside this assessment.

> **This is a measured engineering baseline, not a production certification or a claim of complete feature coverage.**

## Measured results

| Check | Result | Meaning |
|---|---:|---|
| `pnpm run check` | Passed | TypeScript has no reported errors. |
| `pnpm run build` | Passed | The server bundle builds successfully. |
| `pnpm run lint` | Passed with 0 warnings | Lint configuration and all previously reported source warnings were resolved without rule suppression. |
| Full PostgreSQL-backed tests | 149 passed, 1 skipped | Includes payment audit, webhook reconciliation, dual-control approval, recovery-controller fail-closed, and two-passkey drill tests against the dedicated `idlr_payment_test` database. |
| Full core coverage | ~57% statements/lines, ~67% functions, ~63% branches | Measured over server and library TypeScript, excluding app UI, native configuration, generated files, and deployment manifests. Recovery-controller and WebAuthn enrollment code paths are partially covered; the real KMS/WebAuthn success path requires external staging evidence. |

## High-assurance controls covered by deterministic tests

The current tests exercise fail-closed OIDC configuration and login readiness, rejected refresh-token cleanup, revocation cleanup, tamper-evident security audit verification, malformed Keycloak administrative configuration rejection, dual-approval recovery status and unavailable-controller safeguards, WebAuthn enrollment challenge generation and role authorization, durable recovery authorization creation and retrieval, credential listing and revocation, PostgreSQL-backed payment audit and webhook controls, offline queue validation and retry rules, audit receipt cryptography, WAF preset filtering, and policy/threshold domain behavior.

## Explicit gaps

The coverage percentage cannot safely be treated as an overall quality score. Native Expo UI, device biometrics, maps/camera, browser-only flows, external Keycloak/NIMC/CAC/Docling services, live payment gateways, SIEM/WAF telemetry, and deployment controls require device, integration, and target-environment evidence. The repository now includes `test:coverage` for PostgreSQL-enabled environments and `test:coverage:local` for transparent non-payment evidence; neither command may be used to claim 100% feature correctness.

## Next quality work

The isolated PostgreSQL dependency has been restored and the full suite passes. The deterministic drill tests exercise enrollment challenge generation, authorization creation, role enforcement, credential lifecycle, and configuration-completeness boundaries. The highest-value remaining evidence is a live Keycloak staging drill with real WebAuthn assertions, followed by native-device integration testing for OIDC biometrics, file encryption, camera, maps, and push notification behavior.

## Preview verification limitation

Two browser checks of the sandbox PWA `/login` route returned the sandbox “page currently unavailable” response while the managed development process reported itself as running and TypeScript reported no errors. The revised login and recovery flows therefore have compilation, lint, and deterministic readiness-test evidence, but **do not yet have independent browser-render evidence from this sandbox proxy**. This limitation must not be represented as visual acceptance.
