# NDSEP Penetration Test Scope & Requirements

## Document Control
| Field | Value |
|-------|-------|
| Version | 1.0 |
| Classification | CONFIDENTIAL |
| Prepared for | Nigeria Data Protection Commission (NDPC) |
| Platform | National Data Sovereignty Enforcement Platform (NDSEP) |
| Date | May 2026 |

---

## 1. Executive Summary

The NDSEP platform requires independent penetration testing before production deployment as Nigeria's national data privacy regulatory platform. The platform will manage personal data compliance for 500,000+ data controllers processing the personal data of 200M+ Nigerian citizens. Given the national security significance, testing must be comprehensive, conducted by CREST-certified professionals, and follow internationally recognized methodologies.

## 2. Scope of Testing

### 2.1 In-Scope Systems

| Component | Technology | Port(s) | Description |
|-----------|-----------|---------|-------------|
| Web Application | Express/tRPC/React | 443 | Main platform UI + API |
| API Layer | tRPC over Express | 443/api/trpc | 1,451 typed RPC procedures |
| REST Endpoints | Express routes | 443/api/* | Health, webhooks, OpenAPI docs |
| Authentication | OAuth 2.0 / Keycloak SSO | 443/oauth, 8443 | Dual-provider auth system |
| Public DSAR Portal | React + tRPC | 443/dsar | Citizen data subject request submission |
| DPCO Portal | React + tRPC | 443/dpco/* | Licensed auditor workspace |
| OpenAPI Documentation | Swagger UI | 443/api/docs | Auto-generated API docs |
| Go Workers | Go HTTP servers | 8081-8091 | Background processing services |
| Rust Workers | CLI binaries | N/A | Security processing (API key hashing, CSP validation) |
| Python Workers | FastAPI/Flask | 8085-8087 | AI/ML analysis services |
| PostgreSQL | PostgreSQL 16 | 5432 (internal) | Primary database with field-level encryption |
| Redis | Redis 7 | 6379 (internal) | Session cache (password-protected) |
| Docker Infrastructure | Docker Compose | Various | Container orchestration |
| Kubernetes | K8s with NetworkPolicies | Various | Production orchestration |

### 2.2 Out-of-Scope

- Third-party services (Stripe, Keycloak SaaS, email providers)
- Physical security of data centers
- Social engineering against NDPC staff (separate engagement)
- DDoS testing (requires separate approval and coordination)

## 3. Testing Methodology

### 3.1 Standards
- **OWASP Testing Guide v4.2** — Web application methodology
- **OWASP API Security Top 10 (2023)** — API-specific testing
- **PTES (Penetration Testing Execution Standard)** — Framework
- **NIST SP 800-115** — Technical Guide to Information Security Testing

### 3.2 Test Categories

#### A. External Network Assessment
- Port scanning and service enumeration
- TLS/SSL configuration analysis
- DNS zone transfer attempts
- Email security (SPF, DKIM, DMARC)

#### B. Web Application Testing (OWASP Top 10)
1. **A01: Broken Access Control** — Privilege escalation between 5 RBAC roles, IDOR testing on all entity IDs, PBAC bypass attempts
2. **A02: Cryptographic Failures** — AES-256-GCM implementation review, key management assessment, TLS configuration
3. **A03: Injection** — SQL injection on all 1,451 tRPC inputs (Zod bypass attempts), XSS (reflected/stored/DOM), NoSQL injection, command injection
4. **A04: Insecure Design** — Business logic flaws, rate limiting bypass, workflow manipulation
5. **A05: Security Misconfiguration** — Header analysis, default credentials, error handling disclosure
6. **A06: Vulnerable Components** — Dependency vulnerability correlation (npm, Go modules, Rust crates, Python packages)
7. **A07: Authentication Failures** — OAuth flow manipulation, session hijacking, token replay, brute-force bypass
8. **A08: Software Integrity** — Supply chain assessment, CI/CD pipeline security
9. **A09: Logging & Monitoring** — Log injection, audit log tampering, hash-chain integrity
10. **A10: SSRF** — Internal service access via user-controlled URLs

#### C. API Security Testing
- Authentication bypass on 779 protected procedures
- Input validation bypass (Zod schema fuzzing)
- Mass assignment / parameter pollution
- Rate limiting circumvention
- CSRF token replay and prediction
- Broken object-level authorization (BOLA)
- Excessive data exposure in API responses

#### D. Infrastructure Testing
- Docker container escape attempts
- Kubernetes NetworkPolicy bypass
- Database access from non-authorized containers
- Redis unauthenticated access attempts
- Inter-service communication tampering

#### E. Encryption Assessment
- AES-256-GCM implementation correctness
- IV uniqueness verification (must never reuse)
- Key rotation procedure validation
- Encrypted data at rest verification (field-level)
- TLS certificate chain validation

## 4. Test Environment

| Environment | URL | Purpose |
|-------------|-----|---------|
| Staging | https://staging.ndsep.ng | Primary test target (mirrors production) |
| API Docs | https://staging.ndsep.ng/api/docs | OpenAPI specification for API testing |
| Production | https://ndsep.ng | Post-remediation verification only |

### 4.1 Test Accounts Provided
| Role | Username | Permissions |
|------|----------|-------------|
| Super Admin | pentest-admin@ndsep.ng | Full platform access |
| DPCO | pentest-dpco@ndsep.ng | Licensed auditor access |
| Controller Admin | pentest-controller@ndsep.ng | Organization admin |
| Read Only | pentest-readonly@ndsep.ng | View-only access |
| Unauthenticated | N/A | Public-facing endpoints |

## 5. Rules of Engagement

1. **Testing Window**: Monday-Friday, 08:00-18:00 WAT. Weekend testing by prior arrangement only.
2. **No Destructive Testing**: Do not delete production data, disable services, or cause denial of service.
3. **No Social Engineering**: This engagement covers technical testing only.
4. **Data Handling**: All test data and findings are classified CONFIDENTIAL. Encrypted storage required.
5. **Incident Reporting**: Critical vulnerabilities (CVSS >= 9.0) must be reported within 4 hours of discovery.
6. **Communication**: All communication via encrypted channels (Signal or PGP-encrypted email).
7. **Credentials**: Test credentials will be rotated after engagement completion.
8. **Legal Authorization**: Written authorization from NDPC CTO required before testing begins.

## 6. Deliverables

| Deliverable | Format | Due Date |
|-------------|--------|----------|
| Kick-off meeting | Virtual | Day 1 |
| Daily status reports | Email | Daily during testing |
| Critical finding alerts | Signal/PGP Email | Within 4 hours |
| Draft report | PDF (encrypted) | 5 business days after testing |
| Final report | PDF (encrypted) | 3 business days after review |
| Executive summary | PDF (1-2 pages) | With final report |
| Remediation retest | Report | 2 weeks after remediation |

### 6.1 Report Contents
- Executive summary with risk rating
- Methodology description
- Detailed findings with:
  - CVSS v3.1 score
  - Affected component and endpoint
  - Steps to reproduce
  - Evidence (screenshots, request/response pairs)
  - Remediation recommendation
  - Risk rating (Critical / High / Medium / Low / Informational)
- Statistical summary (findings by severity, by OWASP category)
- Remediation priority matrix

## 7. Vendor Requirements

### 7.1 Mandatory Qualifications
- **CREST Certified** (Penetration Testing or Simulated Attack certification)
- Minimum 5 years experience in web application penetration testing
- Experience with government/regulatory platforms
- Experience with Nigerian or African data protection regulations (preferred)
- Professional liability insurance (minimum $2M)

### 7.2 Team Composition
- Lead tester: CREST CRT or OSCP certified
- API specialist: Experience with tRPC/GraphQL testing
- Infrastructure specialist: Kubernetes and Docker security
- Report reviewer: Senior consultant sign-off

## 8. Remediation Tracking

Findings will be tracked in the platform's security findings table with the following severity-based SLAs:

| Severity | CVSS Score | Remediation SLA | Retest SLA |
|----------|-----------|-----------------|------------|
| Critical | 9.0 - 10.0 | 48 hours | 72 hours after fix |
| High | 7.0 - 8.9 | 1 week | 2 weeks after fix |
| Medium | 4.0 - 6.9 | 2 weeks | 1 month after fix |
| Low | 0.1 - 3.9 | 1 month | Next scheduled test |
| Info | 0.0 | As appropriate | N/A |

## 9. Budget Estimate

| Component | Estimated Days | Cost Range (USD) |
|-----------|---------------|-----------------|
| External network assessment | 2 | $5,000 - $8,000 |
| Web application testing | 5 | $15,000 - $25,000 |
| API security testing | 3 | $10,000 - $15,000 |
| Infrastructure testing | 2 | $5,000 - $10,000 |
| Encryption assessment | 1 | $3,000 - $5,000 |
| Report writing | 2 | $5,000 - $8,000 |
| Remediation retest | 2 | $5,000 - $8,000 |
| **Total** | **17** | **$48,000 - $79,000** |

## 10. Appendix: Platform Security Architecture

```
Internet → WAF (OpenAppSec) → Nginx (TLS) → Express/tRPC API
                                                    │
                                    ┌───────────────┼───────────────┐
                                    │               │               │
                              PostgreSQL 16     Redis 7      Go/Rust/Python
                              (AES-256-GCM)   (Password)      Workers
                              (SSL, RLS)      (No FLUSH)
```

**Key Security Controls**:
- 2,250 Zod input validations
- 7-tier rate limiting
- AES-256-GCM field encryption (27 PII fields, 13 tables)
- Hash-chained immutable audit log
- CSRF double-submit cookie pattern
- Zero-trust K8s NetworkPolicies
- RBAC (5 roles) + PBAC + Row-Level Security
