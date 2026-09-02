import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("production GO evidence workflow source contract", () => {
  it("is manually invoked only from production through the protected release environment", () => {
    const workflow = read(".github/workflows/production-go-evidence-verification.yml");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("github.ref == 'refs/heads/production'");
    expect(workflow).toContain("VERIFY_PRODUCTION_GO_EVIDENCE");
    expect(workflow).toContain("name: production-release");
    expect(workflow).toContain("actions: read");
    expect(workflow).not.toContain("packages: write");
    expect(workflow).not.toContain("docker/build-push-action");
  });

  it("requires evidence from a successful staging acceptance run for the same production commit", () => {
    const workflow = read(".github/workflows/production-go-evidence-verification.yml");
    expect(workflow).toContain("Staging Production GO Acceptance");
    expect(workflow).toContain(".headSha == $sha");
    expect(workflow).toContain('.headBranch == "production"');
    expect(workflow).toContain('.conclusion == "success"');
    expect(workflow).toContain('"staging-go-evidence-$SOURCE_COMMIT"');
  });

  it("uses the anti-tampering collector and blocks unless the 95-point verifier passes", () => {
    const workflow = read(".github/workflows/production-go-evidence-verification.yml");
    expect(workflow).toContain("collect-staging-release-evidence.mjs");
    expect(workflow).toContain("--confirm COLLECT_REAL_EVIDENCE");
    expect(workflow).toContain("verify-production-go-evidence.mjs");
    expect(workflow).toContain("production-go-verification.json");
  });
});
