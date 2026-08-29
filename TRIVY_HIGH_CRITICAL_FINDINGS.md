# NDSEP Trivy High/Critical SARIF Finding Breakdown

**Source:** trivy-results.sarif. **Result count:** 111. **Method:** Each Trivy SARIF result filtered by the security gate is shown below; repeated advisories across separate manifests/targets remain distinct findings.

## Summary by Remediation Layer

| Layer | Findings | Unique advisories | Affected targets |
|---|---:|---:|---:|
| Application / Node | 73 | 60 | 1 |
| Go | 23 | 23 | 1 |
| Python | 8 | 4 | 2 |
| Rust | 7 | 7 | 1 |

## Application / Node

| Advisory | Severity | Dependency | Installed | Fixed version | Target | Required remediation |
|---|---|---|---|---|---|---|
| CVE-2025-68130 | HIGH | @trpc/server | 11.7.2 | 10.45.3, 11.8.0 | mobile/pnpm-lock.yaml | Update or converge @trpc/server to 10.45.3, 11.8.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-34601 | HIGH | @xmldom/xmldom | 0.8.11 | 0.8.12, 0.9.9 | mobile/pnpm-lock.yaml | Update or converge @xmldom/xmldom to 0.8.12, 0.9.9, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-41672 | HIGH | @xmldom/xmldom | 0.8.11 | 0.8.13, 0.9.10 | mobile/pnpm-lock.yaml | Update or converge @xmldom/xmldom to 0.8.13, 0.9.10, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-41673 | HIGH | @xmldom/xmldom | 0.8.11 | 0.8.13, 0.9.10 | mobile/pnpm-lock.yaml | Update or converge @xmldom/xmldom to 0.8.13, 0.9.10, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-41674 | HIGH | @xmldom/xmldom | 0.8.11 | 0.8.13, 0.9.10 | mobile/pnpm-lock.yaml | Update or converge @xmldom/xmldom to 0.8.13, 0.9.10, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-41675 | HIGH | @xmldom/xmldom | 0.8.11 | 0.8.13, 0.9.10 | mobile/pnpm-lock.yaml | Update or converge @xmldom/xmldom to 0.8.13, 0.9.10, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-25639 | HIGH | axios | 1.13.2 | 1.13.5, 0.30.3 | mobile/pnpm-lock.yaml | Update or converge axios to 1.13.5, 0.30.3, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-42033 | HIGH | axios | 1.13.2 | 1.15.1, 0.31.1 | mobile/pnpm-lock.yaml | Update or converge axios to 1.15.1, 0.31.1, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-42035 | HIGH | axios | 1.13.2 | 1.15.1, 0.31.1 | mobile/pnpm-lock.yaml | Update or converge axios to 1.15.1, 0.31.1, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-42043 | HIGH | axios | 1.13.2 | 1.15.1, 0.31.1 | mobile/pnpm-lock.yaml | Update or converge axios to 1.15.1, 0.31.1, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-42264 | HIGH | axios | 1.13.2 | 1.15.2 | mobile/pnpm-lock.yaml | Update or converge axios to 1.15.2, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-44486 | HIGH | axios | 1.13.2 | 1.16.0, 0.32.0 | mobile/pnpm-lock.yaml | Update or converge axios to 1.16.0, 0.32.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-44487 | HIGH | axios | 1.13.2 | 1.16.0, 0.32.0 | mobile/pnpm-lock.yaml | Update or converge axios to 1.16.0, 0.32.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-44488 | HIGH | axios | 1.13.2 | 1.16.0 | mobile/pnpm-lock.yaml | Update or converge axios to 1.16.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-44494 | HIGH | axios | 1.13.2 | 1.16.0 | mobile/pnpm-lock.yaml | Update or converge axios to 1.16.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-44495 | HIGH | axios | 1.13.2 | 1.15.2, 0.31.1 | mobile/pnpm-lock.yaml | Update or converge axios to 1.15.2, 0.31.1, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-44496 | HIGH | axios | 1.13.2 | 1.16.0, 0.32.0 | mobile/pnpm-lock.yaml | Update or converge axios to 1.16.0, 0.32.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-13149 | HIGH | brace-expansion | 1.1.12 | 5.0.7, 1.1.16, 2.1.2 | mobile/pnpm-lock.yaml | Update or converge brace-expansion to 5.0.7, 1.1.16, 2.1.2, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-13149 | HIGH | brace-expansion | 2.0.2 | 5.0.7, 1.1.16, 2.1.2 | mobile/pnpm-lock.yaml | Update or converge brace-expansion to 5.0.7, 1.1.16, 2.1.2, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-14257 | HIGH | brace-expansion | 1.1.12 | 5.0.8, 3.0.3, 2.1.3, 1.1.17 | mobile/pnpm-lock.yaml | Update or converge brace-expansion to 5.0.8, 3.0.3, 2.1.3, 1.1.17, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-14257 | HIGH | brace-expansion | 2.0.2 | 5.0.8, 3.0.3, 2.1.3, 1.1.17 | mobile/pnpm-lock.yaml | Update or converge brace-expansion to 5.0.8, 3.0.3, 2.1.3, 1.1.17, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-69152 | HIGH | brace-expansion | 1.1.12 | 1.1.18, 2.1.4, 3.0.6, 5.0.9 | mobile/pnpm-lock.yaml | Update or converge brace-expansion to 1.1.18, 2.1.4, 3.0.6, 5.0.9, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-69152 | HIGH | brace-expansion | 2.0.2 | 1.1.18, 2.1.4, 3.0.6, 5.0.9 | mobile/pnpm-lock.yaml | Update or converge brace-expansion to 1.1.18, 2.1.4, 3.0.6, 5.0.9, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-39356 | HIGH | drizzle-orm | 0.44.7 | 0.45.2, 1.0.0-beta.20 | mobile/pnpm-lock.yaml | Update or converge drizzle-orm to 0.45.2, 1.0.0-beta.20, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-13676 | HIGH | fast-uri | 3.1.0 | 4.0.1, 3.1.3, 2.4.2 | mobile/pnpm-lock.yaml | Update or converge fast-uri to 4.0.1, 3.1.3, 2.4.2, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-16221 | HIGH | fast-uri | 3.1.0 | 2.4.3, 3.1.4, 4.1.1 | mobile/pnpm-lock.yaml | Update or converge fast-uri to 2.4.3, 3.1.4, 4.1.1, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-18446 | HIGH | fast-uri | 3.1.0 | 2.4.4, 3.1.5, 4.1.2 | mobile/pnpm-lock.yaml | Update or converge fast-uri to 2.4.4, 3.1.5, 4.1.2, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-6321 | HIGH | fast-uri | 3.1.0 | 3.1.1, 2.4.1 | mobile/pnpm-lock.yaml | Update or converge fast-uri to 3.1.1, 2.4.1, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-6322 | HIGH | fast-uri | 3.1.0 | 3.1.2, 2.4.1 | mobile/pnpm-lock.yaml | Update or converge fast-uri to 3.1.2, 2.4.1, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-12143 | HIGH | form-data | 4.0.5 | 2.5.6, 3.0.5, 4.0.6 | mobile/pnpm-lock.yaml | Update or converge form-data to 2.5.6, 3.0.5, 4.0.6, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2025-71329 | HIGH | image-size | 1.2.1 | Link: [CVE-2025-71329](https://avd.aquasec.com/nvd/cve-2025-71329) | mobile/pnpm-lock.yaml | Update or converge image-size to Link: [CVE-2025-71329](https://avd.aquasec.com/nvd/cve-2025-71329), regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2025-71330 | HIGH | image-size | 1.2.1 | Link: [CVE-2025-71330](https://avd.aquasec.com/nvd/cve-2025-71330) | mobile/pnpm-lock.yaml | Update or converge image-size to Link: [CVE-2025-71330](https://avd.aquasec.com/nvd/cve-2025-71330), regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-59869 | HIGH | js-yaml | 3.14.2 | 3.15.0, 4.3.0 | mobile/pnpm-lock.yaml | Update or converge js-yaml to 3.15.0, 4.3.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-59869 | HIGH | js-yaml | 4.1.1 | 3.15.0, 4.3.0 | mobile/pnpm-lock.yaml | Update or converge js-yaml to 3.15.0, 4.3.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| GHSA-5p4m-2wfm-xmqj | HIGH | js-yaml | 3.14.2 | 4.3.1, 3.15.1 | mobile/pnpm-lock.yaml | Update or converge js-yaml to 4.3.1, 3.15.1, regenerate the lockfile, and re-run the applicable build and scanner. |
| GHSA-5p4m-2wfm-xmqj | HIGH | js-yaml | 4.1.1 | 4.3.1, 3.15.1 | mobile/pnpm-lock.yaml | Update or converge js-yaml to 4.3.1, 3.15.1, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-26996 | HIGH | minimatch | 3.1.2 | 10.2.1, 9.0.6, 8.0.5, 7.4.7, 6.2.1, 5.1.7, 4.2.4, 3.1.3 | mobile/pnpm-lock.yaml | Update or converge minimatch to 10.2.1, 9.0.6, 8.0.5, 7.4.7, 6.2.1, 5.1.7, 4.2.4, 3.1.3, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-26996 | HIGH | minimatch | 9.0.5 | 10.2.1, 9.0.6, 8.0.5, 7.4.7, 6.2.1, 5.1.7, 4.2.4, 3.1.3 | mobile/pnpm-lock.yaml | Update or converge minimatch to 10.2.1, 9.0.6, 8.0.5, 7.4.7, 6.2.1, 5.1.7, 4.2.4, 3.1.3, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-27903 | HIGH | minimatch | 3.1.2 | 10.2.3, 9.0.7, 8.0.6, 7.4.8, 6.2.2, 5.1.8, 4.2.5, 3.1.3 | mobile/pnpm-lock.yaml | Update or converge minimatch to 10.2.3, 9.0.7, 8.0.6, 7.4.8, 6.2.2, 5.1.8, 4.2.5, 3.1.3, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-27903 | HIGH | minimatch | 9.0.5 | 10.2.3, 9.0.7, 8.0.6, 7.4.8, 6.2.2, 5.1.8, 4.2.5, 3.1.3 | mobile/pnpm-lock.yaml | Update or converge minimatch to 10.2.3, 9.0.7, 8.0.6, 7.4.8, 6.2.2, 5.1.8, 4.2.5, 3.1.3, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-27904 | HIGH | minimatch | 3.1.2 | 10.2.3, 9.0.7, 8.0.6, 7.4.8, 6.2.2, 5.1.8, 4.2.5, 3.1.4 | mobile/pnpm-lock.yaml | Update or converge minimatch to 10.2.3, 9.0.7, 8.0.6, 7.4.8, 6.2.2, 5.1.8, 4.2.5, 3.1.4, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-27904 | HIGH | minimatch | 9.0.5 | 10.2.3, 9.0.7, 8.0.6, 7.4.8, 6.2.2, 5.1.8, 4.2.5, 3.1.4 | mobile/pnpm-lock.yaml | Update or converge minimatch to 10.2.3, 9.0.7, 8.0.6, 7.4.8, 6.2.2, 5.1.8, 4.2.5, 3.1.4, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-67213 | HIGH | nanoid | 3.3.11 | 3.3.18, 5.1.6 | mobile/pnpm-lock.yaml | Update or converge nanoid to 3.3.18, 5.1.6, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-67214 | HIGH | nanoid | 3.3.11 | 3.3.16, 5.1.16 | mobile/pnpm-lock.yaml | Update or converge nanoid to 3.3.16, 5.1.16, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-33891 | HIGH | node-forge | 1.3.3 | 1.4.0 | mobile/pnpm-lock.yaml | Update or converge node-forge to 1.4.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-33894 | HIGH | node-forge | 1.3.3 | 1.4.0 | mobile/pnpm-lock.yaml | Update or converge node-forge to 1.4.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-33895 | HIGH | node-forge | 1.3.3 | 1.4.0 | mobile/pnpm-lock.yaml | Update or converge node-forge to 1.4.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-33896 | HIGH | node-forge | 1.3.3 | 1.4.0 | mobile/pnpm-lock.yaml | Update or converge node-forge to 1.4.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-4867 | HIGH | path-to-regexp | 0.1.12 | 0.1.13 | mobile/pnpm-lock.yaml | Update or converge path-to-regexp to 0.1.13, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-33671 | HIGH | picomatch | 2.3.1 | 4.0.4, 3.0.2, 2.3.2 | mobile/pnpm-lock.yaml | Update or converge picomatch to 4.0.4, 3.0.2, 2.3.2, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-33671 | HIGH | picomatch | 4.0.3 | 4.0.4, 3.0.2, 2.3.2 | mobile/pnpm-lock.yaml | Update or converge picomatch to 4.0.4, 3.0.2, 2.3.2, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-45623 | HIGH | postcss | 8.4.49 | 8.5.12 | mobile/pnpm-lock.yaml | Update or converge postcss to 8.5.12, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-45623 | HIGH | postcss | 8.5.6 | 8.5.12 | mobile/pnpm-lock.yaml | Update or converge postcss to 8.5.12, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-73646 | HIGH | postcss | 8.4.49 | 8.5.18 | mobile/pnpm-lock.yaml | Update or converge postcss to 8.5.18, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-73646 | HIGH | postcss | 8.5.6 | 8.5.18 | mobile/pnpm-lock.yaml | Update or converge postcss to 8.5.18, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-13311 | HIGH | shell-quote | 1.8.3 | 1.9.0 | mobile/pnpm-lock.yaml | Update or converge shell-quote to 1.9.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-9277 | CRITICAL | shell-quote | 1.8.3 | 1.8.4 | mobile/pnpm-lock.yaml | Update or converge shell-quote to 1.8.4, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-23745 | HIGH | tar | 7.5.2 | 7.5.3 | mobile/pnpm-lock.yaml | Update or converge tar to 7.5.3, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-23950 | HIGH | tar | 7.5.2 | 7.5.4 | mobile/pnpm-lock.yaml | Update or converge tar to 7.5.4, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-24842 | HIGH | tar | 7.5.2 | 7.5.7 | mobile/pnpm-lock.yaml | Update or converge tar to 7.5.7, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-26960 | HIGH | tar | 7.5.2 | 7.5.8 | mobile/pnpm-lock.yaml | Update or converge tar to 7.5.8, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-29786 | HIGH | tar | 7.5.2 | 7.5.10 | mobile/pnpm-lock.yaml | Update or converge tar to 7.5.10, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-31802 | HIGH | tar | 7.5.2 | 7.5.11 | mobile/pnpm-lock.yaml | Update or converge tar to 7.5.11, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-59873 | CRITICAL | tar | 7.5.2 | 7.5.19 | mobile/pnpm-lock.yaml | Update or converge tar to 7.5.19, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-59874 | HIGH | tar | 7.5.2 | 7.5.18 | mobile/pnpm-lock.yaml | Update or converge tar to 7.5.18, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-73566 | HIGH | tar | 7.5.2 | 7.5.21 | mobile/pnpm-lock.yaml | Update or converge tar to 7.5.21, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-12151 | HIGH | undici | 6.22.0 | 6.27.0, 7.28.0, 8.5.0 | mobile/pnpm-lock.yaml | Update or converge undici to 6.27.0, 7.28.0, 8.5.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-1526 | HIGH | undici | 6.22.0 | 6.24.0, 7.24.0 | mobile/pnpm-lock.yaml | Update or converge undici to 6.24.0, 7.24.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-1528 | HIGH | undici | 6.22.0 | 6.24.0, 7.24.0 | mobile/pnpm-lock.yaml | Update or converge undici to 6.24.0, 7.24.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-2229 | HIGH | undici | 6.22.0 | 6.24.0, 7.24.0 | mobile/pnpm-lock.yaml | Update or converge undici to 6.24.0, 7.24.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-48779 | HIGH | ws | 6.2.3 | 5.2.5, 6.2.4, 7.5.11, 8.21.0 | mobile/pnpm-lock.yaml | Update or converge ws to 5.2.5, 6.2.4, 7.5.11, 8.21.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-48779 | HIGH | ws | 7.5.10 | 5.2.5, 6.2.4, 7.5.11, 8.21.0 | mobile/pnpm-lock.yaml | Update or converge ws to 5.2.5, 6.2.4, 7.5.11, 8.21.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-48779 | HIGH | ws | 8.18.3 | 5.2.5, 6.2.4, 7.5.11, 8.21.0 | mobile/pnpm-lock.yaml | Update or converge ws to 5.2.5, 6.2.4, 7.5.11, 8.21.0, regenerate the lockfile, and re-run the applicable build and scanner. |

## Go

| Advisory | Severity | Dependency | Installed | Fixed version | Target | Required remediation |
|---|---|---|---|---|---|---|
| CVE-2025-30204 | HIGH | github.com/golang-jwt/jwt/v5 | v5.0.0 | 5.2.2 | orchestration/go/go.mod | Update or converge github.com/golang-jwt/jwt/v5 to 5.2.2, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2024-45337 | HIGH | golang.org/x/crypto | v0.21.0 | 0.31.0 | orchestration/go/go.mod | Update or converge golang.org/x/crypto to 0.31.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2025-22869 | HIGH | golang.org/x/crypto | v0.21.0 | 0.35.0 | orchestration/go/go.mod | Update or converge golang.org/x/crypto to 0.35.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2025-47913 | HIGH | golang.org/x/crypto | v0.21.0 | 0.43.0 | orchestration/go/go.mod | Update or converge golang.org/x/crypto to 0.43.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-39828 | HIGH | golang.org/x/crypto | v0.21.0 | 0.52.0 | orchestration/go/go.mod | Update or converge golang.org/x/crypto to 0.52.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-39829 | HIGH | golang.org/x/crypto | v0.21.0 | 0.52.0 | orchestration/go/go.mod | Update or converge golang.org/x/crypto to 0.52.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-39830 | HIGH | golang.org/x/crypto | v0.21.0 | 0.52.0 | orchestration/go/go.mod | Update or converge golang.org/x/crypto to 0.52.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-39831 | HIGH | golang.org/x/crypto | v0.21.0 | 0.52.0 | orchestration/go/go.mod | Update or converge golang.org/x/crypto to 0.52.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-39832 | HIGH | golang.org/x/crypto | v0.21.0 | 0.52.0 | orchestration/go/go.mod | Update or converge golang.org/x/crypto to 0.52.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-39835 | HIGH | golang.org/x/crypto | v0.21.0 | 0.52.0 | orchestration/go/go.mod | Update or converge golang.org/x/crypto to 0.52.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-42508 | HIGH | golang.org/x/crypto | v0.21.0 | 0.52.0 | orchestration/go/go.mod | Update or converge golang.org/x/crypto to 0.52.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-46595 | HIGH | golang.org/x/crypto | v0.21.0 | 0.52.0 | orchestration/go/go.mod | Update or converge golang.org/x/crypto to 0.52.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-46597 | HIGH | golang.org/x/crypto | v0.21.0 | 0.52.0 | orchestration/go/go.mod | Update or converge golang.org/x/crypto to 0.52.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2023-45288 | HIGH | golang.org/x/net | v0.22.0 | 0.23.0 | orchestration/go/go.mod | Update or converge golang.org/x/net to 0.23.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2024-45338 | HIGH | golang.org/x/net | v0.22.0 | 0.33.0 | orchestration/go/go.mod | Update or converge golang.org/x/net to 0.33.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-25681 | HIGH | golang.org/x/net | v0.22.0 | 0.55.0 | orchestration/go/go.mod | Update or converge golang.org/x/net to 0.55.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-27136 | HIGH | golang.org/x/net | v0.22.0 | 0.55.0 | orchestration/go/go.mod | Update or converge golang.org/x/net to 0.55.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-33814 | HIGH | golang.org/x/net | v0.22.0 | 0.53.0 | orchestration/go/go.mod | Update or converge golang.org/x/net to 0.53.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-39821 | HIGH | golang.org/x/net | v0.22.0 | 0.55.0 | orchestration/go/go.mod | Update or converge golang.org/x/net to 0.55.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-46600 | HIGH | golang.org/x/net | v0.22.0 | 0.56.0 | orchestration/go/go.mod | Update or converge golang.org/x/net to 0.56.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-56852 | HIGH | golang.org/x/text | v0.14.0 | 0.39.0 | orchestration/go/go.mod | Update or converge golang.org/x/text to 0.39.0, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-33186 | CRITICAL | google.golang.org/grpc | v1.62.1 | 1.79.3 | orchestration/go/go.mod | Update or converge google.golang.org/grpc to 1.79.3, regenerate the lockfile, and re-run the applicable build and scanner. |
| GHSA-hrxh-6v49-42gf | HIGH | google.golang.org/grpc | v1.62.1 | 1.82.1 | orchestration/go/go.mod | Update or converge google.golang.org/grpc to 1.82.1, regenerate the lockfile, and re-run the applicable build and scanner. |

## Python

| Advisory | Severity | Dependency | Installed | Fixed version | Target | Required remediation |
|---|---|---|---|---|---|---|
| CVE-2026-45830 | HIGH | chromadb | 0.5.23 | Link: [CVE-2026-45830](https://avd.aquasec.com/nvd/cve-2026-45830) | services/python/compliance-ai/requirements.txt | Update or converge chromadb to Link: [CVE-2026-45830](https://avd.aquasec.com/nvd/cve-2026-45830), regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-45831 | HIGH | chromadb | 0.5.23 | Link: [CVE-2026-45831](https://avd.aquasec.com/nvd/cve-2026-45831) | services/python/compliance-ai/requirements.txt | Update or converge chromadb to Link: [CVE-2026-45831](https://avd.aquasec.com/nvd/cve-2026-45831), regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-45833 | CRITICAL | chromadb | 0.5.23 | Link: [CVE-2026-45833](https://avd.aquasec.com/nvd/cve-2026-45833) | services/python/compliance-ai/requirements.txt | Update or converge chromadb to Link: [CVE-2026-45833](https://avd.aquasec.com/nvd/cve-2026-45833), regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-45134 | HIGH | langchain | 0.3.13 | 0.3.30 | services/python/compliance-ai/requirements.txt | Update or converge langchain to 0.3.30, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-45830 | HIGH | chromadb | 0.5.23 | Link: [CVE-2026-45830](https://avd.aquasec.com/nvd/cve-2026-45830) | services/python/requirements.txt | Update or converge chromadb to Link: [CVE-2026-45830](https://avd.aquasec.com/nvd/cve-2026-45830), regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-45831 | HIGH | chromadb | 0.5.23 | Link: [CVE-2026-45831](https://avd.aquasec.com/nvd/cve-2026-45831) | services/python/requirements.txt | Update or converge chromadb to Link: [CVE-2026-45831](https://avd.aquasec.com/nvd/cve-2026-45831), regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-45833 | CRITICAL | chromadb | 0.5.23 | Link: [CVE-2026-45833](https://avd.aquasec.com/nvd/cve-2026-45833) | services/python/requirements.txt | Update or converge chromadb to Link: [CVE-2026-45833](https://avd.aquasec.com/nvd/cve-2026-45833), regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-45134 | HIGH | langchain | 0.3.13 | 0.3.30 | services/python/requirements.txt | Update or converge langchain to 0.3.30, regenerate the lockfile, and re-run the applicable build and scanner. |

## Rust

| Advisory | Severity | Dependency | Installed | Fixed version | Target | Required remediation |
|---|---|---|---|---|---|---|
| CVE-2026-41676 | HIGH | openssl | 0.10.75 | 0.10.78 | workers/rust/Cargo.lock | Update or converge openssl to 0.10.78, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-41678 | HIGH | openssl | 0.10.75 | 0.10.78 | workers/rust/Cargo.lock | Update or converge openssl to 0.10.78, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-41681 | HIGH | openssl | 0.10.75 | 0.10.78 | workers/rust/Cargo.lock | Update or converge openssl to 0.10.78, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-41898 | HIGH | openssl | 0.10.75 | 0.10.78 | workers/rust/Cargo.lock | Update or converge openssl to 0.10.78, regenerate the lockfile, and re-run the applicable build and scanner. |
| CVE-2026-42327 | HIGH | openssl | 0.10.75 | 0.10.79 | workers/rust/Cargo.lock | Update or converge openssl to 0.10.79, regenerate the lockfile, and re-run the applicable build and scanner. |
| GHSA-5x78-73v4-xg6w | HIGH | postgres-protocol | 0.6.10 | 0.6.12 | workers/rust/Cargo.lock | Update or converge postgres-protocol to 0.6.12, regenerate the lockfile, and re-run the applicable build and scanner. |
| GHSA-82j2-j2ch-gfr8 | HIGH | rustls-webpki | 0.103.9 | 0.103.13, 0.104.0-alpha.7 | workers/rust/Cargo.lock | Update or converge rustls-webpki to 0.103.13, 0.104.0-alpha.7, regenerate the lockfile, and re-run the applicable build and scanner. |
