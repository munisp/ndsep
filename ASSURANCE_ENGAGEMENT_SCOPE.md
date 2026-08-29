# NDSEP Mission-Critical Assurance Engagement Scope

**Engagement revision:** `security/weekly-exception-governance` at the repository state present when this document was created.
**Objective:** Produce an evidence-based release decision by inspecting the actual NDSEP source, deployment configuration, build/test systems, data flows, and in-scope remediations.

> Source comments, documentation, dashboards, tests, workflows, and configuration are treated as claims—not proof. A releaseable decision requires reproducible execution evidence at the reviewed revision.

## Endorsed requirements distilled from the supplied instructions

| Requirement area | Assurance requirement applied to NDSEP |
|---|---|
| Ground truth | Record source revision, working-tree state, build manifests, deployment topology, service entry points, data stores, trust boundaries, environment defaults, and delivery pipelines. |
| Claim verification | Build a claim-and-coverage inventory for material capabilities and distinguish verified, blocked, incomplete, retired, and not-applicable claims. |
| Defect discovery | Examine incomplete/simulated paths, authn/authz, input handling, secrets, durable state, async events, operational controls, build/deploy wiring, and polyglot components. |
| Safety | Do not use production data, live funds, intrusive scans, external credential changes, or deployment actions without explicit authorization and a safe non-production environment. |
| Remediation | Fix defects that are technically determinable, localized, and safe to validate in the checked-out repository. Do not weaken tests or security controls to make checks pass. |
| Validation | Re-run directly affected checks and record exact commands/results. A passing narrow test suite is not proof of full integration or production readiness. |
| Release policy | `RELEASEABLE` is permitted only when all mandatory gates and material claims are verified, all critical/high issues are fixed and retested, and no blocker remains. Otherwise the decision is `NO-GO` or `CONDITIONALLY READY`, with evidence and residual risk. |

## Current engagement boundaries

This engagement may execute static analysis, local builds, dependency/security checks, unit and non-production integration tests that are available in the repository, and configuration validation. It will not deploy the system, access real governmental/financial/identity-provider environments, send real external communications, mutate production secrets, or transact live funds. Missing isolated dependencies, sandbox accounts, or credentials are release-evidence gaps and will be reported explicitly rather than simulated.

## Required deliverables

1. A repository ground-truth and change-set record.
2. A claim-and-coverage inventory and functional equivalence matrix.
3. An evidence-based defect register, including confirmed versus suspected findings and release severity.
4. In-scope code/configuration remediations with commits and re-validation evidence.
5. A final release-decision report that states what was and was not verified, plus minimal actions to close residual blockers.
