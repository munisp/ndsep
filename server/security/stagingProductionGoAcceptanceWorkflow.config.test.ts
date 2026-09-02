import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("staging production-GO acceptance workflow source contract", () => {
  it("is production-commit scoped and runs only in the protected staging environment", () => {
    const workflow = read(".github/workflows/staging-production-go-acceptance.yml");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("github.ref == 'refs/heads/production'");
    expect(workflow).toContain("COLLECT_PROTECTED_STAGING_GO_EVIDENCE");
    expect(workflow).toContain("name: staging");
    expect(workflow).toContain("[self-hosted, linux, ndsep-staging-internal]");
    expect(workflow).not.toContain("docker/build-push-action");
    expect(workflow).not.toContain("packages: write");
  });

  it("requires a successful same-commit upstream staging acceptance artifact", () => {
    const workflow = read(".github/workflows/staging-production-go-acceptance.yml");
    expect(workflow).toContain("Staging Integration Acceptance");
    expect(workflow).toContain(".headSha == $sha");
    expect(workflow).toContain('.headBranch == "production"');
    expect(workflow).toContain('.conclusion == "success"');
    expect(workflow).toContain('"staging-upstream-evidence-$SOURCE_COMMIT"');
  });

  it("collects validated evidence through the anti-tampering collector only", () => {
    const workflow = read(".github/workflows/staging-production-go-acceptance.yml");
    expect(workflow).toContain("collect-staging-release-evidence.mjs");
    expect(workflow).toContain("--confirm COLLECT_REAL_EVIDENCE");
    expect(workflow).toContain("name: staging-go-evidence-${{ github.sha }}");
    expect(workflow).not.toContain("gh pr review");
  });
});
