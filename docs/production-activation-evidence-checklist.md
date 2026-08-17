# Production Activation Evidence Checklist

The platform must not be declared production-ready until every required control has evidence, owner, validation date, expiry/renewal date, and incident contact.

| Gate | Required evidence | Cannot be supplied by local code |
|---|---|---|
| PostgreSQL ledger | HA topology, backups, PITR restore drill, migrations, reconciliation report | Managed database account and staging/production data |
| KMS and device recovery | HSM/KMS key policy, OIDC workload identity, key ceremony, rewrap drill | Cloud KMS and enterprise device identities |
| Native mobile security | SQLCipher custom build, SecureStore invalidation tests, MDM/device attestation | iOS/Android build/signing/MDM infrastructure |
| Identity and approvals | Enterprise IdP claims, WebAuthn MDS/AAGUID allowlist, credential lifecycle drill | IdP, FIDO policy, enrolled authenticators |
| Trust providers | Approved NIMC/CAC/document/liveness contracts and redacted staging evidence | Provider contracts/credentials |
| Payment integrity | Gateway contracts, signed webhook, reconciliation, ledger/settlement audit | Gateway credentials and regulated operational approvals |
| Audit and operations | KMS-signed stream, broker retention, Prometheus/Grafana/Alertmanager, on-call test | Broker/monitoring tenancy and on-call team |
| Governance | Penetration test, DPIA, data retention, change approval, incident table-top | Legal/security/compliance sign-offs |

The repository now includes dependency updates and a CI security-hygiene workflow. This improves code delivery hygiene but does not replace the external evidence gates above.
