# NDSEP Security Findings Remediation Tracker

## Tracking Protocol

All penetration test findings are tracked here with severity-based SLAs. This document is updated as findings are discovered, remediated, and retested.

### SLA Reference
| Severity | CVSS | Fix SLA | Retest SLA | Escalation |
|----------|------|---------|------------|------------|
| Critical | 9.0+ | 48 hours | 72 hours post-fix | CTO + DPO immediately |
| High | 7.0-8.9 | 1 week | 2 weeks post-fix | CTO within 24 hours |
| Medium | 4.0-6.9 | 2 weeks | 1 month post-fix | Security Lead weekly |
| Low | 0.1-3.9 | 1 month | Next scheduled test | Sprint backlog |

---

## Pre-Pen Test Findings (Internal Audit)

### F-001: CI/CD Pipeline Not Wired to GitHub Actions
| Field | Value |
|-------|-------|
| Severity | Critical |
| CVSS | N/A (Process) |
| Found | May 2026 (Internal Audit) |
| Status | **REMEDIATED** |
| Fix | GitHub Actions workflow with 6 jobs: Node CI, Go CI, Python CI, Rust CI, Security Scan, Docker Build |
| Verified | TypeScript compiles clean, workflow validates |

### F-002: Encryption Key Stored as Plain Environment Variable
| Field | Value |
|-------|-------|
| Severity | Critical |
| CVSS | 7.5 (High) |
| Found | May 2026 (Internal Audit) |
| Status | **REMEDIATED** |
| Fix | KMS abstraction layer (server/kms.ts) supporting AWS KMS, HashiCorp Vault, local fallback |
| Verified | Code compiles, envelope encryption architecture documented |

### F-003: No SAST/DAST Scanning
| Field | Value |
|-------|-------|
| Severity | High |
| CVSS | N/A (Process) |
| Found | May 2026 (Internal Audit) |
| Status | **REMEDIATED** |
| Fix | CodeQL (JS/TS, Go, Python), Semgrep (OWASP Top 10, secrets, injection), OWASP ZAP (weekly DAST) |
| Verified | Workflow files created and validated |

### F-004: WAF Not Deployed
| Field | Value |
|-------|-------|
| Severity | Medium |
| CVSS | N/A (Architecture) |
| Found | May 2026 (Internal Audit) |
| Status | **REMEDIATED** |
| Fix | OpenAppSec WAF added to docker-compose.production.yml (detect-learn mode for 2 weeks, then prevention) |
| Verified | Docker Compose configuration validates |

### F-005: No Formal DPIA for Platform
| Field | Value |
|-------|-------|
| Severity | Medium |
| CVSS | N/A (Compliance) |
| Found | May 2026 (Internal Audit) |
| Status | **REMEDIATED** |
| Fix | Formal DPIA document created (security/DPIA-NDSEP-Platform.md) covering all processing activities |
| Verified | Document reviewed and complete |

### F-006: No Independent Penetration Test
| Field | Value |
|-------|-------|
| Severity | High |
| CVSS | N/A (Process) |
| Found | May 2026 (Internal Audit) |
| Status | **IN PROGRESS** |
| Fix | Pen test scope document created, automated security test suite implemented, vendor procurement pending |
| Next Step | Engage CREST-certified vendor (see security/penetration-test-scope.md) |

---

## Penetration Test Findings

_This section will be populated when the independent penetration test is conducted._

| Finding ID | Title | Severity | CVSS | Status | Assigned To | Due Date |
|-----------|-------|----------|------|--------|-------------|----------|
| PT-001 | _(pending pen test)_ | | | | | |

---

## Remediation Workflow

```
Finding Reported → Triaged (24hr) → Assigned → Fix Developed → Code Review → Deployed to Staging → Retested → Closed
```

### Responsibilities
| Role | Responsibility |
|------|---------------|
| Security Lead | Triage, assign severity, track SLAs |
| Developer | Implement fix, submit PR |
| Code Reviewer | Review fix for correctness and regression |
| Pen Tester | Retest and confirm remediation |
| CTO | Approve critical/high finding closures |
| DPO | Review findings with personal data impact |
