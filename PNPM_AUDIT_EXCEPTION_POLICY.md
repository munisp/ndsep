# NDSEP pnpm Audit Exception Review Policy

**Policy owner:** Security Engineering
**Applies to:** `.github/security/pnpm-audit-exceptions.json` and the required `security-gate` status check
**Effective condition:** The policy takes effect when `security-gate` is required on the protected `production` branch.
**Default decision:** **Deny.** An exception is valid only when every requirement in this policy, the registry schema, and the automated gate is satisfied.

> An exception is a temporary, documented authorization to merge or promote a candidate that still contains a specific high- or critical-severity GitHub Security Advisory. It is not acceptance of the vulnerability, does not remove the remediation obligation, and never substitutes for a patch plan.

## 1. Non-negotiable rules

| Rule | Policy requirement |
|---|---|
| One advisory per record | Every entry references one exact `GHSA-...` advisory. Package-wide, version-wide, or blanket exceptions are prohibited. |
| No silent bypass | The registry is version controlled, is included in the protected-path rules, and has no wildcard/implicit allow rule. |
| No self-approval | The requester, service owner, and approving Security Engineering reviewer must be different people. The release approver must not be the requester. |
| Least duration | An exception expires on the earliest date that is technically feasible; extensions require a new ticket, renewed evidence, and full reapproval. |
| Patch first | An exception is permitted only after the owner documents why a patched direct parent, transitive override, package replacement, or component removal cannot be completed safely before the requested expiry. |
| Artifact-specific | Evidence must identify the candidate source SHA, lockfile, direct parent, resolved vulnerable version, and whether the package enters a deployable artifact. |
| Compensating controls | The controls must be concrete, enabled for the full exception interval, owned, and testable. “Monitoring” alone is insufficient. |
| Revocation | Security Engineering may revoke an exception immediately for new exploitability information, new attack paths, missed milestones, expiry, failed controls, or inaccurate evidence. |

## 2. Eligibility and maximum duration

The `pnpm-audit-exceptions.json` registry covers only findings that the `security-gate` would otherwise block. The following rule is mandatory for every entry.

| Finding class | Eligible? | Maximum expiry | Required approvers | Minimum additional evidence |
|---|---|---:|---|---|
| Critical, deployable/runtime reachable | **No** | 0 days | N/A | Patch or remove before release. |
| Critical, not in any deployable artifact | Yes, exceptional | 7 calendar days | Security Engineering Lead, service owner, release manager | SBOM plus reproducible artifact inspection proving absence; a scheduled removal PR. |
| High, deployable/runtime or unknown scope | Yes, exceptional | 14 calendar days | Security Engineering Lead and service owner; release manager acknowledges | Reachability analysis, proof of boundary controls, test evidence, remediation PR/ticket. |
| High, development/build-only and not carried into runtime image | Yes, exceptional | 30 calendar days | Security Engineering reviewer and service owner | CI/workstation exposure analysis, isolation controls, remediation PR/ticket. |
| Moderate or low | Out of scope | N/A | N/A | Track separately; do not use this registry. |
| Known exploited / active exploitation affecting NDSEP | **No** | 0 days | N/A | Contain, patch/remove, investigate, and follow incident response. |

No exception may be used where an available patched version can be adopted within the standard release window without a demonstrated material compatibility or availability impact. “Insufficient time” and “the audit is noisy” are not acceptable justifications.

## 3. Required registry record

Each approved exception must use this exact record shape. The automated gate verifies the base fields and the policy duration; reviewers verify the evidence and classification fields.

```json
{
  "advisory": "GHSA-example-1234-5678",
  "severity": "high",
  "module": "example-package",
  "resolved_version": "1.2.3",
  "direct_parent": "parent-package@4.5.6",
  "scope": "development",
  "candidate_sha": "40-character Git commit SHA",
  "expires_on": "YYYY-MM-DD",
  "approved_by": "security-engineering-lead@example.org",
  "service_owner": "named-owner@example.org",
  "release_approver": "release-manager@example.org",
  "ticket": "SEC-1234",
  "remediation_pr": "https://github.com/munisp/ndsep/pull/123",
  "justification": "Why a patch, override, removal, or replacement cannot be safely completed before expiry.",
  "reachability_assessment": "Exact call path and deployable-artifact conclusion, with SBOM reference.",
  "compensating_controls": "Specific deployed prevention/detection controls and tests that remain active until the patch is released.",
  "reviewed_at": "YYYY-MM-DD"
}
```

The `candidate_sha` must identify the exact code revision assessed. The `scope` value must be one of `runtime`, `development`, or `unknown`; `unknown` is governed as runtime. `resolved_version` and `direct_parent` must be taken from the audited lockfile/SBOM—not inferred from `package.json` ranges.

## 4. Approval workflow

The following sequence is required. A failure at any stage means the finding remains blocking.

| Step | Responsible role | Required action and evidence | Control point |
|---:|---|---|---|
| 1 | Service owner | Open a security ticket; assign the dependency owner; state affected service, candidate SHA, advisory, resolved version, direct parent, scope, and deadline. | Ticket must exist before any registry PR. |
| 2 | Dependency owner | Attempt patch, override, package upgrade, replacement, or removal in a separate remediation branch. Attach compatibility/build/test results. | Exception cannot be a substitute for attempting an available fix. |
| 3 | Service owner + security engineer | Produce an SBOM/artifact mapping and reachability assessment. Identify data, ingress, execution path, boundary controls, and realistic impact. | Runtime or unknown findings without this evidence are denied. |
| 4 | Service owner | Propose one registry entry in a pull request limited to the exception file, relevant test/control changes, and ticket evidence. | No direct pushes; no unrelated refactors in exception PR. |
| 5 | Automated `security-gate` | Validate JSON syntax, required fields, advisory identity, severity, expiry, and duration. Fail the candidate unless an exact valid exception exists. | Required, non-bypassable status check. |
| 6 | Security Engineering reviewer | Verify GHSA identity, severity, scope, reachability, compensating controls, remediation plan, and requested duration. Record an explicit approval in the ticket and PR. | Reviewer cannot be the requester or service owner. |
| 7 | Service owner | Confirm service impact and accept the operational/remediation plan. | Required approval; owner cannot self-approve Security review. |
| 8 | Release manager | Confirm the candidate SHA, image digest, required checks, and exception expiry are recorded in the release manifest. | Acknowledgement is required; it is not a security approval. |
| 9 | Merge authority | Merge only after branch protection, CODEOWNERS review, two approvals, and every required check passes. | Use protected `production` branch policy. |
| 10 | Security Engineering | Recheck the exception weekly and at least two business days before expiry; close it after the patched candidate is released. | Expired entries cause automated CI failure. |

## 5. Required evidence checklist

Before approval, the security ticket and pull request must contain every item below.

| Evidence | Why it is required |
|---|---|
| Raw `pnpm audit --json` output and date | Preserves the reported advisory, resolved dependency state, and severity. |
| Candidate source SHA and artifact/image digest | Ties the decision to one release candidate. |
| SPDX or CycloneDX SBOM | Shows the direct parent and whether the vulnerable package exists in a deployable artifact. |
| Reachability assessment | Establishes whether untrusted input can reach the vulnerable code path. |
| Patch/override/replacement attempt | Demonstrates that the least-risk remediation was attempted first. |
| Test results | Shows the candidate and compensating controls work. |
| Remediation PR or dated work item | Makes the exception temporary and accountable. |
| Compensating-control test | Verifies controls such as disabled UI exposure, blocked ingress, package isolation, strict input limits, or runtime image exclusion. |
| Explicit approvals | Records Security Engineering, service-owner, and release-manager decisions with separation of duties. |

## 6. Governance controls outside the registry

The following GitHub controls are mandatory, because JSON validation alone cannot verify human authority or independence.

```text
# .github/CODEOWNERS — replace with the actual security team slug.
/.github/security/ @munisp/security-engineering
/.github/workflows/security-gate.yml @munisp/security-engineering
/scripts/ci/assert-pnpm-audit.mjs @munisp/security-engineering
```

Branch protection for `production` must require `security-gate`, require two approving reviews, require CODEOWNER review, dismiss stale approvals, require approval of the most recent push, and disallow force pushes and administrator bypasses. The exception file must never be modified in the same pull request as an unreviewed application dependency change unless the PR is treated as a high-risk security change and receives the same independent review.

## 7. Expiry, extension, and revocation

The automated gate must reject a record on the day after `expires_on`. There is no automatic renewal. To extend an exception, the owner must open a new ticket or renewal section, rerun the current audit and SBOM, update the reachability assessment, show progress on the patch plan, and obtain the same independent approvals. The total duration may not exceed the relevant class maximum; a different candidate or a material change in affected dependency tree requires a new assessment.

Security Engineering must revoke the entry immediately if a patch becomes practical, the vulnerability becomes known exploited, exploitability/reachability changes, the asserted compensating control fails, the affected package enters a runtime artifact, or evidence is found to be inaccurate.

## 8. Audit and reporting

Security Engineering maintains a weekly exception register with advisory, package, service, owner, scope, candidate SHA, expiry, ticket, remediation status, and status of compensating-control tests. Open exceptions are reported to engineering and release governance weekly. An exception past its expiry or without a linked remediation change is escalated as a release blocker.

## References

1. [GitHub Docs — Dependency review action configuration](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/configure-dependency-review-action)
2. [GitHub Docs — Protected branch required status checks](https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/about-protected-branches)
