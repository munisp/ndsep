import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const workflowPath = resolve(root, ".github/workflows/ci.yml");
const makefilePath = resolve(root, "Makefile");
const lockVerifierPath = resolve(
  root,
  "scripts/security/verify-production-image-lock.sh"
);
const evidenceVerifierPath = resolve(
  root,
  "scripts/security/verify-release-image-evidence.sh"
);
const digest = "a".repeat(64);

function verifyRenderedCompose(contents: string): string {
  const directory = mkdtempSync(resolve(tmpdir(), "ndsep-image-lock-"));
  const composePath = resolve(directory, "rendered-compose.yml");
  try {
    writeFileSync(composePath, contents, "utf8");
    return execFileSync("bash", [lockVerifierPath, composePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function verifyReleaseEvidence(report: object): object {
  const directory = mkdtempSync(resolve(tmpdir(), "ndsep-release-evidence-"));
  const trivyPath = resolve(directory, "trivy.json");
  const sbomPath = resolve(directory, "sbom.cdx.json");
  const outputPath = resolve(directory, "release-evidence.json");
  try {
    writeFileSync(trivyPath, JSON.stringify(report), "utf8");
    writeFileSync(
      sbomPath,
      JSON.stringify({
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        components: [],
      }),
      "utf8"
    );
    execFileSync(
      "bash",
      [
        evidenceVerifierPath,
        "ghcr.io/munisp/ndsep",
        `sha256:${digest}`,
        "b".repeat(40),
        trivyPath,
        sbomPath,
        outputPath,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return JSON.parse(readFileSync(outputPath, "utf8"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("production release artifact hardening", () => {
  it("accepts only lower-case immutable SHA-256 image references in rendered production compose", () => {
    const result = verifyRenderedCompose(
      `services:\n  api:\n    image: ghcr.io/munisp/ndsep@sha256:${digest}\n`
    );
    expect(result).toContain("verified 1 immutable OCI image digests");
  });

  it("rejects mutable or tag-only production image references", () => {
    expect(() =>
      verifyRenderedCompose(
        "services:\n  api:\n    image: ghcr.io/munisp/ndsep:latest\n"
      )
    ).toThrow(/immutable lowercase OCI SHA-256 reference/);
  });

  it("rejects local build directives in rendered production Compose", () => {
    expect(() =>
      verifyRenderedCompose("services:\n  api:\n    build: .\n")
    ).toThrow(
      /production configuration must not contain local build directives/
    );
  });

  it("binds clean scan and SBOM evidence to the immutable digest before release signing", () => {
    const evidence = verifyReleaseEvidence({
      Results: [{ Vulnerabilities: [] }],
    }) as {
      image: { reference: string };
      trivy: { high_critical_count: number };
    };
    expect(evidence.image.reference).toBe(
      `ghcr.io/munisp/ndsep@sha256:${digest}`
    );
    expect(evidence.trivy.high_critical_count).toBe(0);
  });

  it("blocks signing when direct image scan reports a HIGH or CRITICAL finding", () => {
    expect(() =>
      verifyReleaseEvidence({
        Results: [
          {
            Vulnerabilities: [
              { VulnerabilityID: "CVE-test", Severity: "HIGH" },
            ],
          },
        ],
      })
    ).toThrow(/release image scan found 1 HIGH\/CRITICAL/);
  });

  it("keeps the Docker release job restricted to protected production pushes", async () => {
    const workflow = await import("node:fs/promises").then(({ readFile }) =>
      readFile(workflowPath, "utf8")
    );
    expect(workflow).toMatch(
      /docker:\s*\n\s+name: Docker Build & Push[\s\S]*?if: github\.ref == 'refs\/heads\/production'/
    );
    expect(workflow).toMatch(
      /needs:\s*\[\s*node-ci,\s*go-ci,\s*go-orchestration-ci,\s*python-ci,\s*rust-ci,\s*security,\s*integration,\s*schema-drift-verification,?\s*\]/
    );
    expect(workflow).toMatch(
      /docker:\s*\n\s+name: Docker Build & Push[\s\S]*?environment:\s*\n\s+name: production-release/
    );
  });

  it("routes exception and release-control changes to an accountable code owner", async () => {
    const codeownersPath = resolve(root, ".github/CODEOWNERS");
    const codeowners = await import("node:fs/promises").then(({ readFile }) =>
      readFile(codeownersPath, "utf8")
    );
    for (const ownedPath of [
      "/.github/security/pnpm-audit-exceptions.json @munisp",
      "/PNPM_AUDIT_EXCEPTION_POLICY.md @munisp",
      "/scripts/ci/weekly-pnpm-exception-audit.mjs @munisp",
      "/.github/workflows/security-gate.yml @munisp",
      "/.github/workflows/ci.yml @munisp",
    ]) {
      expect(codeowners).toContain(ownedPath);
    }
  });

  it("refuses direct registry publication and validates image locks before production Compose startup", async () => {
    const makefile = await import("node:fs/promises").then(({ readFile }) =>
      readFile(makefilePath, "utf8")
    );
    expect(makefile).toContain(
      "docker-push: ## Refuse direct image publication; use the protected production workflow"
    );
    expect(makefile).toContain("Direct image publishing is disabled");
    expect(makefile).toContain(
      "Set PRODUCTION_ENV_FILE to an approved production environment file"
    );
    expect(makefile).toContain("verify-production-image-lock.sh");
  });

  it("requires digest-bound image scanning and retained evidence before signing", async () => {
    const workflow = await import("node:fs/promises").then(({ readFile }) =>
      readFile(workflowPath, "utf8")
    );
    const dockerJob = workflow.slice(workflow.indexOf("  docker:"));
    expect(dockerJob).toContain("id: build_image");
    expect(dockerJob).toContain("provenance: mode=max");
    expect(dockerJob).toContain("sbom: true");
    expect(dockerJob).toContain("image-ref: ${{ steps.image.outputs.ref }}");
    expect(dockerJob).toContain("severity: HIGH,CRITICAL");
    expect(dockerJob).toContain('exit-code: "1"');
    expect(dockerJob).toContain("verify-release-image-evidence.sh");
    expect(dockerJob).toContain("cosign sign --yes");
    expect(dockerJob).toContain("cosign verify");
    expect(dockerJob).toContain("normalize-release-evidence.mjs");
    expect(dockerJob).toContain("--out-dir release-evidence");
    expect(dockerJob.indexOf("verify-release-image-evidence.sh")).toBeLessThan(
      dockerJob.indexOf("cosign sign --yes")
    );
    expect(dockerJob.indexOf("cosign verify")).toBeLessThan(
      dockerJob.indexOf("normalize-release-evidence.mjs")
    );
    expect(dockerJob.indexOf("normalize-release-evidence.mjs")).toBeLessThan(
      dockerJob.indexOf("Upload release evidence")
    );
    expect(dockerJob).toContain("release-evidence");
    expect(dockerJob).toContain(
      "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25"
    );
    expect(dockerJob).toContain(
      "actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a"
    );
    expect(dockerJob).toContain(
      "sigstore/cosign-installer@ba7bc0a3fef59531c69a25acd34668d6d3fe6f22"
    );
  });
});
