# Data Protection Impact Assessment (DPIA)
# National Data Sovereignty Enforcement Platform (NDSEP)

## Document Control

| Field | Value |
|-------|-------|
| Document Title | DPIA for NDSEP Platform Operations |
| Version | 1.0 |
| Classification | CONFIDENTIAL |
| Prepared By | NDSEP Platform Team |
| Reviewed By | _(Data Protection Officer — to be appointed)_ |
| Approved By | _(NDPC Commissioner — pending)_ |
| Date | May 2026 |
| Review Date | May 2027 (annual review or upon significant change) |
| Legal Basis | NDPA 2023 Section 39; GDPR Article 35 (for EU adequacy) |

---

## 1. Overview of Processing

### 1.1 Purpose
The NDSEP platform is the technology layer that operationalizes Nigeria's Data Protection Act (NDPA) 2023. It processes personal data to:

1. **Register and monitor** 500,000+ data controllers and processors operating in Nigeria
2. **License and oversee** 291+ Data Protection Compliance Organizations (DPCOs)
3. **Receive and process** Data Subject Access Requests (DSARs) from 200M+ Nigerian citizens
4. **Track and investigate** data breach incidents within the statutory 72-hour notification window
5. **Manage enforcement** actions, penalties, and compliance audits
6. **Facilitate cross-border** data transfer assessments and adequacy determinations

### 1.2 Why This DPIA Is Required
Under NDPA 2023 Section 39, a DPIA is required when processing is "likely to result in a high risk to the rights and freedoms of data subjects." NDSEP meets this threshold because:

- **National scale**: Processing involves data from every registered data controller in Nigeria
- **Sensitive categories**: NIN (National Identification Number), BVN (Bank Verification Number), contact details of DPOs and citizens
- **Regulatory power**: Processing directly enables enforcement actions, penalties, and compliance determinations
- **Vulnerable populations**: Citizens exercising data protection rights may include whistleblowers and victims of data breaches

---

## 2. Data Inventory

### 2.1 Categories of Personal Data Processed

| Category | Data Elements | Data Subjects | Volume (Est.) | Retention |
|----------|--------------|---------------|--------------|-----------|
| Controller Registration | Organization name, contact email, contact phone, address, sector, size | Data controller representatives | 500,000+ orgs | Active + 7 years |
| DPCO Licensing | Full name, email, phone, firm address, qualifications, license number | DPCOs and their staff | 300+ individuals | License period + 5 years |
| DPO Registry | Full name, email, phone, organization, appointment date | Data Protection Officers | 2,000+ individuals | Appointment period + 3 years |
| Citizen DSARs | Full name, email, NIN, request details, correspondence | Nigerian citizens | Potentially 200M+ | Resolution + 5 years |
| Breach Incidents | Affected subject email/NIN, breach details, timeline, remediation | Breach victims | Variable | Incident + 7 years |
| Audit Returns | DPO contact info, audit findings, compliance scores | Audited organizations | 3,000+ annually | Filing + 7 years |
| Enforcement Cases | Organization reps, witness info, penalty details | Subjects of enforcement | Variable | Case closure + 10 years |
| Platform Users | Username (email), name, role, login history, session data | NDPC staff, DPCOs, controller admins | 5,000+ users | Account + 1 year |

### 2.2 Special Category Data
- **National Identification Numbers (NIN)**: Classified as highly sensitive under NDPA. Used for citizen DSAR verification.
- **Bank Verification Numbers (BVN)**: Used in financial sector controller identification.
- **Health data**: May appear in breach incident reports involving health sector controllers.

### 2.3 Data Flows

```
                    ┌───────────────┐
                    │  Citizens     │
                    │  (DSAR Portal)│
                    └───────┬───────┘
                            │ HTTPS/TLS
                            ▼
┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│  Controllers │───▶│    NDSEP      │◀───│    DPCOs     │
│  (Portal)    │    │  (API Layer)  │    │  (Workspace) │
└──────────────┘    └───────┬───────┘    └──────────────┘
                            │
                    ┌───────┼───────────────┐
                    │       │               │
                    ▼       ▼               ▼
             ┌──────────┐ ┌─────┐ ┌────────────────┐
             │PostgreSQL│ │Redis│ │Background      │
             │(Encrypted│ │     │ │Workers (Go,    │
             │ PII at   │ │     │ │Rust, Python)   │
             │ rest)    │ │     │ │                │
             └──────────┘ └─────┘ └────────────────┘
```

**Cross-border data flows**: The platform facilitates cross-border transfer assessments but does not itself transfer personal data outside Nigeria. Transfer instruments and adequacy determinations are managed within the platform.

---

## 3. Legal Basis for Processing

| Processing Activity | Legal Basis (NDPA) | Justification |
|---------------------|-------------------|---------------|
| Controller registration | S.44 (Statutory obligation) | NDPA mandates registration of controllers of major importance |
| DPCO licensing | S.33 (Statutory obligation) | NDPA requires DPCO licensing by NDPC |
| DSAR processing | S.34-38 (Data subject rights) | Platform facilitates exercise of statutory rights |
| Breach notification | S.41 (Statutory obligation) | 72-hour notification requirement |
| Enforcement | S.46-49 (Statutory obligation) | NDPC enforcement powers under NDPA |
| Audit management | S.42 (Statutory obligation) | Annual compliance audit filing |
| Platform user accounts | Legitimate interest | Necessary for system operation and security |

---

## 4. Risk Assessment

### 4.1 Risk Matrix

| # | Risk | Likelihood | Severity | Inherent Risk | Mitigating Controls | Residual Risk |
|---|------|-----------|----------|---------------|--------------------:|---------------|
| R1 | Unauthorized access to citizen PII (NIN, email) | Low | Critical | **High** | AES-256-GCM encryption, RBAC, PBAC, RLS, session management, brute-force protection | **Low** |
| R2 | Data breach — mass exfiltration | Low | Critical | **Critical** | 7-tier rate limiting, ransomware detection (50 ops/60s threshold), bulk export monitoring, WAF, hash-chained audit log | **Low** |
| R3 | SQL injection leading to data exposure | Very Low | Critical | **High** | 2,250 Zod validations, parameterized queries, suspicious request guard, body sanitizer, Go SQL audit worker | **Very Low** |
| R4 | Insider threat — NDPC staff misuse | Low | High | **High** | RBAC (5 roles), PBAC policies, immutable audit log, session concurrency limit (5), security event alerting | **Medium** |
| R5 | Cross-site attacks (XSS, CSRF) | Low | Medium | **Medium** | CSP (no unsafe-inline), body sanitizer, CSRF double-submit cookie, helmet.js security headers | **Low** |
| R6 | Encryption key compromise | Very Low | Critical | **High** | KMS envelope encryption (AWS KMS / Vault), env-var isolation, key rotation scripts, no keys in source code | **Low** |
| R7 | Denial of service | Medium | Medium | **Medium** | DDoS progressive slow-down, connection flood guard, bot detection, Slowloris timeout, WAF rate limiting | **Low** |
| R8 | Supply chain attack (npm/Go/Rust dependency) | Low | High | **Medium** | 0 high/critical npm vulns, Trivy scanning, cargo-audit, bandit, automated CI dependency auditing | **Low** |
| R9 | Loss of audit trail integrity | Very Low | High | **Medium** | SHA-256 hash-chained log entries, verification endpoint, file integrity monitoring, canary detection | **Very Low** |
| R10 | Inadequate data retention / over-retention | Low | Medium | **Medium** | Automated retention policies, data anonymization after retention period, purge logging | **Low** |
| R11 | Unauthorized cross-border data transfer | Low | High | **Medium** | Transfer instruments module, adequacy registry, TIA (Transfer Impact Assessment), no automatic external transfers | **Low** |

### 4.2 Risk Rating Summary
- **Critical risks**: 0 (all critical inherent risks mitigated to Low/Very Low)
- **High residual risks**: 0
- **Medium residual risks**: 1 (R4 — insider threat, requires procedural controls beyond technology)
- **Low residual risks**: 8
- **Very Low residual risks**: 2

---

## 5. Security Measures

### 5.1 Technical Controls

| Control Domain | Implementation | Evidence |
|---------------|---------------|----------|
| **Encryption at Rest** | AES-256-GCM field-level encryption for 27 PII fields across 13 tables | `server/encryption.ts`, `drizzle/0019_field_encryption.sql` |
| **Encryption in Transit** | TLS 1.2+ for all connections. PostgreSQL SSL (sslmode=require). HSTS 2yr + preload. | `server/dbSslConfig.ts`, Helmet.js CSP |
| **Key Management** | KMS abstraction (AWS KMS / Vault / local). Envelope encryption. Key rotation scripts. | `server/kms.ts`, `scripts/rotate-encryption-key.ts` |
| **Authentication** | OAuth 2.0 + Keycloak SSO. Session cookies (httpOnly, Secure, SameSite). 30-min idle timeout. | `server/authMiddleware.ts`, session config |
| **Authorization** | RBAC (5 roles x 18 permissions) + PBAC + PostgreSQL RLS. 91% procedure protection ratio. | `server/rbac.ts`, `server/security/pbac.ts` |
| **Input Validation** | 2,250 Zod schema validations on all 1,451 tRPC procedures. Body sanitization. Parameter pollution guard. | `server/security.ts`, all router files |
| **Rate Limiting** | 7-tier system: global (1000/15min), auth (20/15min), mutations (200/15min), uploads (50/hr), DSAR (10/hr), dev API (500/hr), DDoS progressive. | `server/security/threatProtection.ts` |
| **Audit Logging** | Hash-chained SHA-256 immutable audit log. Security event logger. Structured Pino JSON logging. | `server/consentAuditChain.ts`, `server/auditVerification.ts` |
| **WAF** | OpenAppSec with OWASP CRS ruleset (Paranoia Level 2). Bot protection. Anti-automation. | `docker-compose.production.yml` (waf service) |
| **Network Isolation** | K8s default-deny-all NetworkPolicy + 8 explicit allow rules. Docker internal/public network separation. | `infra/k8s/network-policy.yaml` |
| **Backup & Recovery** | Automated hourly pg_dump. WAL archiving for PITR. RPO < 15min, RTO < 1hr. S3 backup with encryption. | `infra/backup/`, Docker backup service |
| **SAST** | CodeQL (JS/TS, Go, Python), Semgrep (OWASP, secrets, injection, JWT, crypto). Weekly + PR-triggered. | `.github/workflows/codeql-analysis.yml`, `semgrep.yml` |
| **DAST** | OWASP ZAP full scan + API scan. Weekly scheduled + on-demand. | `.github/workflows/owasp-zap.yml` |

### 5.2 Organizational Controls

| Control | Status | Responsibility |
|---------|--------|---------------|
| Data Protection Officer appointment | **Required** — must appoint DPO for platform operations | NDPC Management |
| Staff security training | Training module exists in platform | HR + Security Lead |
| Access review (quarterly) | Process defined, execution pending | Security Lead |
| Incident response plan | Breach notification workflow implemented (72hr) | Security Lead + DPO |
| Third-party vendor assessment | Template exists, vendor engagement pending | Procurement |
| Background checks for privileged users | Organizational policy required | HR |
| Acceptable use policy | To be drafted | Legal + DPO |

---

## 6. Data Subject Rights

The platform both **facilitates** data subject rights for citizens (DSAR portal) and must **comply** with them for its own processing:

| Right (NDPA Section) | Implementation for Platform Data | Status |
|------|--------------------------------------|--------|
| S.34 — Right of access | Users can view their account data. Audit log accessible to admin. | Implemented |
| S.35 — Right to rectification | Users can update profile. Controllers can update registration. | Implemented |
| S.36 — Right to erasure | Account deletion available. Data anonymization after retention. | Implemented |
| S.37 — Right to data portability | Data export in JSON format. Bulk export functionality. | Implemented |
| S.38 — Right to object | Consent management module. Processing basis documented. | Implemented |

---

## 7. Consultation

### 7.1 Stakeholders Consulted

| Stakeholder | Role | Input |
|------------|------|-------|
| NDPC Technical Team | Platform owner | Requirements, architecture review |
| Platform Security Auditor | Independent | Security posture assessment (this DPIA) |
| _(DPO — to be appointed)_ | Data protection oversight | Pending formal review |
| _(Legal Counsel)_ | Legal compliance | Pending formal review |
| _(CREST Pen Tester)_ | Independent security testing | Pending engagement |

### 7.2 NDPC Supervisory Consultation
Under NDPA S.39(3), if the DPIA indicates that processing would result in high risk without mitigation measures, the data controller must consult the NDPC prior to processing. As NDSEP is operated by NDPC itself, this constitutes internal review and approval by the Commission.

---

## 8. DPIA Outcome & Decision

### 8.1 Conclusion
Based on the risk assessment (Section 4), technical controls (Section 5), and the current state of the platform:

**The processing CAN proceed**, subject to the following conditions:

1. **Appoint a DPO** for the NDSEP platform operations (separate from the general NDPC DPO if needed)
2. **Complete independent penetration test** before production launch
3. **Implement KMS** (AWS KMS or Vault) — do not use local env var for encryption keys in production
4. **Conduct staff training** on data handling procedures specific to the platform
5. **Establish quarterly access review** process for all privileged user accounts
6. **Draft and publish** privacy notice for platform users (controllers, DPCOs, citizens)
7. **Schedule annual DPIA review** (or upon significant platform changes)

### 8.2 Residual Risk Acceptance
The single medium residual risk (R4 — insider threat) requires ongoing organizational controls:
- Quarterly access reviews
- Audit log monitoring
- Separation of duties for enforcement actions
- Background checks for NDPC staff with platform admin access

These are accepted as residual risks managed through organizational policy rather than technology alone.

---

## 9. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Data Controller Representative | _________________ | _________________ | ____/____/____ |
| Data Protection Officer | _________________ | _________________ | ____/____/____ |
| NDPC Commissioner | _________________ | _________________ | ____/____/____ |
| IT Security Lead | _________________ | _________________ | ____/____/____ |

---

## 10. Review Schedule

This DPIA will be reviewed:
- **Annually** (next review: May 2027)
- **Upon significant platform changes** (new data categories, new processing purposes, architecture changes)
- **After a security incident** involving personal data
- **After penetration test findings** that change the risk profile
- **Upon changes to NDPA** or its implementing regulations

---

## Appendix A: Encrypted PII Fields

| Table | Encrypted Fields | Algorithm |
|-------|-----------------|-----------|
| users | email, name | AES-256-GCM |
| organizations | contact_email | AES-256-GCM |
| portal_submissions | contact_name, contact_email, contact_phone | AES-256-GCM |
| citizen_requests | citizen_email, citizen_nin | AES-256-GCM |
| breach_incidents | data_subject_email, data_subject_nin | AES-256-GCM |
| dpo_appointments | dpo_email, dpo_phone | AES-256-GCM |
| compliance_audit_returns | dpo_contact_info | AES-256-GCM |
| automated_decision_records | data_subject_email | AES-256-GCM |
| parental_consent_records | parent_email | AES-256-GCM |
| data_export_jobs | data_subject_email | AES-256-GCM |
| dpco_registrations | email, phone, dpo_email, contact_name, contact_email, contact_phone | AES-256-GCM |
| dpco_clients | contact_name, contact_email, contact_phone | AES-256-GCM |
| dpco_licensed_firms | email, phone | AES-256-GCM |

**Total: 27 fields across 13 tables**

## Appendix B: Related Documents

| Document | Location |
|----------|----------|
| Penetration Test Scope | `security/penetration-test-scope.md` |
| Remediation Tracker | `security/remediation-tracker.md` |
| Automated Security Tests | `security/automated-security-tests.ts` |
| Security Posture Assessment | Delivered as interactive HTML report |
| KMS Integration | `server/kms.ts` |
| Encryption Implementation | `server/encryption.ts` |
| CI/CD Pipeline | `.github/workflows/ci.yml` |
| SAST Configuration | `.github/workflows/codeql-analysis.yml`, `.github/workflows/semgrep.yml` |
| DAST Configuration | `.github/workflows/owasp-zap.yml` |
| WAF Configuration | `docker-compose.production.yml` (waf service) |
| Network Policies | `infra/k8s/network-policy.yaml` |
