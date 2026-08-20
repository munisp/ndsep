# Enterprise Security Activation Artifacts

These files provide a **target-environment contract**, not running protection in the sandbox. Caddy is the public TLS edge; APISIX is the API gateway; Keycloak is the OIDC/MFA authority; OPA is the deny-by-default policy decision point; OpenAppSec is a separately validated WAF attachment; Kubernetes network policy limits pod communication.

Activation requires change approval, pinned image versions/digests, secret-manager references, independent security review, APISIX configuration validation, OPA policy tests, Keycloak MFA enrollment, WAF tuning, DDoS exercise evidence, and SIEM/on-call verification. Do not expose APISIX Admin, OPA management, Keycloak Admin, Prometheus, or internal probes to the public network.
