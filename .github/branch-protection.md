# Branch Protection Rules — NDSEP

Apply these rules in GitHub Repository Settings → Branches → Branch protection rules.

## `main` branch

| Setting | Value |
|---------|-------|
| **Require a pull request before merging** | Yes |
| Required approving reviews | **2** |
| Dismiss stale pull request approvals | Yes |
| Require review from code owners | Yes |
| **Require status checks to pass before merging** | Yes |
| Required checks: | `Node.js CI (TypeScript + Tests)` |
| | `Go CI (Build + Vet + Test)` |
| | `Security Scan` |
| | `CodeQL — JavaScript/TypeScript` |
| | `Semgrep SAST` |
| **Require branches to be up to date before merging** | Yes |
| **Require signed commits** | Recommended |
| **Require linear history** | Yes (squash merge) |
| **Include administrators** | Yes |
| **Restrict pushes** | Only deploy bots and release managers |
| **Allow force pushes** | No |
| **Allow deletions** | No |

## `develop` branch

| Setting | Value |
|---------|-------|
| Require a pull request before merging | Yes |
| Required approving reviews | **1** |
| Required status checks | `Node.js CI (TypeScript + Tests)` |
| Require branches to be up to date | Yes |

## `staging` branch

| Setting | Value |
|---------|-------|
| Require a pull request before merging | Yes |
| Required approving reviews | **1** |
| Required status checks | `Node.js CI (TypeScript + Tests)`, `Security Scan` |
| Require branches to be up to date | Yes |
