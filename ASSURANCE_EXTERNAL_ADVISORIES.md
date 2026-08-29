# External Advisory Evidence Used in NDSEP Remediation

## ChromaDB

The National Vulnerability Database records **CVE-2026-45833** as a critical code-injection issue in ChromaDB. It affects versions 0.4.17 and later, including the NDSEP-pinned 0.5.23. The described exploit requires authenticated `UPDATE_COLLECTION` access and a malicious model-repository value with `trust_remote_code=true`.

Source: <https://nvd.nist.gov/vuln/detail/CVE-2026-45833>

The GitHub Advisory Database records **CVE-2026-45830 / GHSA-2wm9-hf6c-p5cr** as an authorization flaw affecting ChromaDB versions 0.4.17 through 1.5.9. As of its 2026-08-24 update, the advisory records **no patched version**. This means a version-only upgrade cannot close the issue.

Source: <https://github.com/advisories/GHSA-2wm9-hf6c-p5cr>

The NVD records **CVE-2026-45831** as a cross-tenant authorization flaw in `SimpleRBACAuthorizationProvider`, affecting ChromaDB 0.5.0 and later, including the NDSEP-pinned version.

Source: <https://nvd.nist.gov/vuln/detail/CVE-2026-45831>

## Go Module Compatibility

The Go module metadata for the minimum fixed versions recorded in the Trivy SARIF evidence declares Go 1.25.0: `google.golang.org/grpc` v1.82.1, `golang.org/x/crypto` v0.52.0, `golang.org/x/net` v0.56.0, and `golang.org/x/text` v0.39.0. The orchestration module and its CI toolchain must therefore move from Go 1.22/1.21 to a compatible Go 1.25 toolchain before applying those fixed versions.

Sources: <https://proxy.golang.org/google.golang.org/grpc/@v/v1.82.1.mod>, <https://proxy.golang.org/golang.org/x/crypto/@v/v0.52.0.mod>, <https://proxy.golang.org/golang.org/x/net/@v/v0.56.0.mod>, <https://proxy.golang.org/golang.org/x/text/@v/v0.39.0.mod>
