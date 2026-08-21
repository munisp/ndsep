# Code Quality and Coverage Baseline

**Assessment date:** 21 August 2026  
**Scope:** Source as checked out in `/home/ubuntu/idlr_pts_mobile`, excluding native-device execution and unavailable local PostgreSQL payment integration.

> **This is a measured engineering baseline, not a production certification or a claim of complete feature coverage.**

## Measured results

| Check | Result | Meaning |
|---|---:|---|
| `pnpm run check` | Passed | TypeScript has no reported errors. |
| `pnpm run build` | Passed | The server bundle builds successfully. |
| `pnpm run lint` | Passed with 23 warnings | The two React hook-order errors were fixed. Remaining warnings are tracked style/dependency hygiene items, not lint errors. |
| Local runnable tests | 128 passed, 1 skipped | Includes current security, OIDC lifecycle, receipts, offline queue, recovery-invariant, and domain tests. |
| Full test suite in this sandbox | Blocked by 10 payment tests | The PostgreSQL payment audit socket is absent; this is an environment dependency, not an assertion that payment behavior passed. |
| Locally runnable core coverage | 55.42% statements/lines, 56.63% functions, 64.24% branches | Measured over server and library TypeScript, excluding app UI, native configuration, generated files, and deployment manifests. |

## High-assurance controls covered by deterministic tests

The current tests exercise fail-closed OIDC configuration, rejected refresh-token cleanup, revocation cleanup, tamper-evident security audit verification, malformed Keycloak administrative configuration rejection, distinct-principal dual-approval recovery invariants, offline queue validation and retry rules, audit receipt cryptography, WAF preset filtering, and policy/threshold domain behavior.

## Explicit gaps

The coverage percentage cannot safely be treated as an overall quality score. Native Expo UI, device biometrics, maps/camera, browser-only flows, external Keycloak/NIMC/CAC/Docling services, payment PostgreSQL integration, payment gateways, SIEM/WAF telemetry, and deployment controls require device, integration, and target-environment evidence. The repository now includes `test:coverage` for target environments with PostgreSQL and `test:coverage:local` for transparent local-only evidence; neither command may be used to claim 100% feature correctness.

## Next quality work

The most valuable remaining code-test investment is an isolated PostgreSQL test service to make all payment integration tests deterministic, followed by native-device integration testing for OIDC biometrics, file encryption, camera, maps, and push notification behavior. UI component and end-to-end route tests should then exercise the remaining user-facing paths that unit coverage intentionally does not execute.
