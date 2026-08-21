# Post-Incident Review: OPA Infrastructure-Denial Event

**Incident ID:** `INC-YYYY-NNNN`
**Exercise ID (if simulated):** `opa-p1-drill-YYYYMMDDTHHMMSSZ`
**Severity:** `P1 / SEV-1`
**Status:** Draft / Under Review / Approved
**Incident Commander:**
**Technical Lead:**
**Security Lead:**
**Communications Lead:**
**Review date:**
**Author:** Manus AI

> This PIR describes an authorization-availability event in which NDSEP correctly failed closed because OPA configuration, availability, response validity, or timing was impaired. It must not characterize the deliberate denial as an access-control defect unless evidence proves an authorization bypass or incorrect policy decision.

## 1. Executive Summary

Describe what happened, why it mattered, how long it lasted, whether this was a simulation, and the final customer/system effect. State clearly whether the control denied privileged operations as designed.

| Item                                | Record                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------- |
| Start / end time (UTC)              |                                                                         |
| Detection source                    | Alert / drill / operator / customer report                              |
| Primary OPA outcome(s)              | `unconfigured` / `unavailable` / `timeout` / `http_error` / `malformed` |
| Affected operations                 | Approvals / exports / deletes / administrative actions / other          |
| Customer impact                     |                                                                         |
| Data integrity impact               | None / describe and link evidence                                       |
| Data confidentiality impact         | None / describe and escalate under breach process                       |
| Was fail-closed behavior preserved? | Yes / No — explain                                                      |
| Was this a controlled drill?        | Yes / No                                                                |

## 2. Detection and Timeline

Use UTC, distinguish observed fact from inference, and link every consequential event to a redacted log, Prometheus snapshot, deployment event, or approved communication.

| UTC time | Event                                   | Evidence reference | Owner / decision |
| -------- | --------------------------------------- | ------------------ | ---------------- |
|          | Alert/drill initiated                   |                    |                  |
|          | On-call acknowledged                    |                    |                  |
|          | OPA/service/policy state verified       |                    |                  |
|          | Containment started                     |                    |                  |
|          | Root cause identified                   |                    |                  |
|          | Recovery action applied                 |                    |                  |
|          | Normal canaries passed                  |                    |                  |
|          | Alert resolved after stable observation |                    |                  |

## 3. Impact Assessment

State the authoritative basis for each estimate. Do not use plausible invented counts.

| Dimension                            | Measurement / conclusion | Evidence                                     |
| ------------------------------------ | ------------------------ | -------------------------------------------- |
| Privileged requests denied           |                          | `prometheus/opa-outcomes-5m.json`            |
| Normal API availability              |                          | `prometheus/normal-api-up.json`              |
| OPA availability                     |                          | `prometheus/opa-up.json`                     |
| OPA timeout / mean decision duration |                          | `prometheus/opa-mean-decision-duration.json` |
| APISIX 429 effect                    |                          | `prometheus/apisix-429-ratio.json`           |
| Records changed incorrectly          |                          | Audit/database verification                  |
| External reporting required          |                          | Legal/compliance assessment                  |

## 4. Technical Analysis

### 4.1 Trigger and fault domain

Identify the immediate trigger and classify it: deployment configuration drift, OPA process/resource exhaustion, service discovery/DNS/network policy, policy bundle/image change, malformed response, or other.

### 4.2 Control-path analysis

Explain the complete path: Keycloak signed MFA assurance → NDSEP PBAC/Permify → OPA decision client → OPA policy → 403 or allow response. Confirm which layers executed and whether any layer was bypassed.

### 4.3 Five Whys

1. Why did the OPA infrastructure-denial outcome occur?
2. Why was that dependency/configuration state present?
3. Why was it not prevented by deployment validation or health checks?
4. Why was earlier detection/alerting insufficient, if applicable?
5. What durable system/process change prevents recurrence?

## 5. Containment and Recovery

| Action                                              | UTC time | Owner | Result | Rollback / safety check |
| --------------------------------------------------- | -------: | ----- | ------ | ----------------------- |
| Freeze privileged policy/deployment changes         |          |       |        |                         |
| Preserve policy/image/config hashes                 |          |       |        |                         |
| Restore approved OPA dependency/bundle/config       |          |       |        |                         |
| Internal OPA `mfaVerified:false` literal deny check |          |       |        |                         |
| External no-MFA 403 canary                          |          |       |        |                         |
| External fresh-MFA positive control                 |          |       |        |                         |
| 15-minute stable observation                        |          |       |        |                         |

Document any forbidden shortcut considered or attempted, including disabling OPA, bypassing PBAC/Permify, relaxing MFA, exposing internal metrics, or globally raising rate limits. Each requires Security review even if rejected.

## 6. Evidence and Chain of Custody

Attach the restricted evidence package produced by `scripts/security/capture-opa-p1-evidence.sh`. Do not paste bearer tokens, Keycloak claims, OTP seeds, raw request bodies, Secret values, or personal data into this PIR.

| Artifact                            | SHA-256 / reference | Storage location          | Access reviewer |
| ----------------------------------- | ------------------- | ------------------------- | --------------- |
| Evidence `SHA256SUMS` manifest      |                     | Restricted incident store |                 |
| Prometheus snapshots                |                     |                           |                 |
| Redacted API/OPA logs               |                     |                           |                 |
| Deployment/pod metadata             |                     |                           |                 |
| APISIX/Caddy/OPA config hash        |                     |                           |                 |
| Alertmanager / PagerDuty timeline   |                     |                           |                 |
| Normal authorization canary results |                     |                           |                 |

## 7. Corrective and Preventive Actions

| ID      | Action | Type                       | Owner | Due date | Verification / closure criterion | Status |
| ------- | ------ | -------------------------- | ----- | -------- | -------------------------------- | ------ |
| CAPA-01 |        | Prevent / detect / respond |       |          |                                  | Open   |
| CAPA-02 |        | Prevent / detect / respond |       |          |                                  | Open   |
| CAPA-03 |        | Prevent / detect / respond |       |          |                                  | Open   |

## 8. Lessons and Follow-up

Record what worked, what delayed diagnosis, alert noise or coverage gaps, client/business communications improvement, and whether the APISIX/OPA canary or P1 drill needs to change. Schedule the PIR review within five business days and track each CAPA in the engineering governance system.

## 9. Approvals

| Role                          | Name | Decision | Date |
| ----------------------------- | ---- | -------- | ---- |
| Incident Commander            |      |          |      |
| Platform Lead                 |      |          |      |
| Security Lead                 |      |          |      |
| Compliance/Legal, if required |      |          |      |
| Service Owner                 |      |          |      |
