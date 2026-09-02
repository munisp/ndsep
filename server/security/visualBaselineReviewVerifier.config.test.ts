import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), "utf8");

describe("visual baseline review verifier source contract", () => {
  it("declares exactly the 12 existing Chromium visual contracts without approval evidence", () => {
    const contract = JSON.parse(read("e2e/visual-baseline-contract.json"));
    const pendingReview = JSON.parse(read("e2e/visual-baseline-review.json"));
    expect(contract.schemaVersion).toBe(1);
    expect(contract.project).toBe("chromium");
    expect(contract.matrix).toEqual({ workers: 1, retries: 0 });
    expect(contract.snapshots).toHaveLength(12);
    expect(
      new Set(contract.snapshots.map((item: { id: string }) => item.id)).size
    ).toBe(12);
    expect(
      new Set(
        contract.snapshots.map((item: { snapshot: string }) => item.snapshot)
      ).size
    ).toBe(12);
    expect(pendingReview.status).toBe("PENDING_INDEPENDENT_HUMAN_REVIEW");
    expect(pendingReview.candidateCommit).toBe("");
    expect(pendingReview.snapshots).toHaveLength(12);
    expect(
      pendingReview.snapshots.every(
        (item: { decision: string; sha256: string }) =>
          item.decision === "pending" && item.sha256 === ""
      )
    ).toBe(true);
    expect(
      pendingReview.approvals.every(
        (item: { decision: string; actor: string }) =>
          item.decision === "pending" && item.actor === ""
      )
    ).toBe(true);
  });

  it("requires all approved snapshot hashes and four distinct independent role approvals at the source head", () => {
    const script = read("scripts/ci/verify-visual-baseline-review.mjs");
    expect(script).toContain("VISUAL_REVIEW_HEAD_COMMIT");
    expect(script).toContain("event?.pull_request?.head?.sha !== candidate");
    expect(script).toContain("review?.candidateCommit !== candidate");
    expect(script).toContain("review.snapshots.length !== 12");
    expect(script).toContain('entry?.decision !== "accepted"');
    expect(script).toContain(
      "sha256(file) !== reviewById.get(entry.id).sha256"
    );
    for (const role of [
      "product-ux-owner",
      "qa-lead",
      "accessibility-owner",
      "independent-engineering-reviewer",
    ])
      expect(script).toContain(`"${role}"`);
    expect(script).toContain("actors.has(approval.actor)");
    expect(script).toContain("review?.commit_id === candidate");
  });

  it("is read-only and cannot update snapshots, reviews, pull requests, workflows, or deployments", () => {
    const script = read("scripts/ci/verify-visual-baseline-review.mjs");
    expect(script).toContain('"api"');
    expect(script).toContain(
      "repos/${repository}/pulls/${prNumber}/reviews?per_page=100"
    );
    expect(script).not.toContain('"pr", "review"');
    expect(script).not.toContain('"pr", "merge"');
    expect(script).not.toContain('"workflow", "run"');
    expect(script).not.toContain('"--update-snapshots"');
    expect(script).not.toContain("writeFileSync");
    expect(script).not.toContain("rmSync");
  });

  it("runs before the visual Playwright shard with PR read-only permissions and unchanged zero retries", () => {
    const workflow = read(".github/workflows/extended-e2e-matrix.yml");
    expect(workflow).toContain("pull-requests: read");
    expect(workflow).toContain(
      "VISUAL_REVIEW_HEAD_COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}"
    );
    const gateOffset = workflow.indexOf(
      "Require independently reviewed visual baseline"
    );
    const runnerOffset = workflow.indexOf(
      "Run release-grade E2E shard without retry masking"
    );
    expect(gateOffset).toBeGreaterThan(-1);
    expect(runnerOffset).toBeGreaterThan(gateOffset);
    expect(workflow).toContain("--workers=1");
    expect(workflow).toContain("--retries=0");
  });
});
