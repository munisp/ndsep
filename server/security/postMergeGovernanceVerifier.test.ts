import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyPostMergeGovernance } from "../../scripts/ci/verify-post-merge-governance.mjs";

const temporaryDirectories: string[] = [];

async function createFixtureDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "ndsep-post-merge-governance-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFixture(directory: string, filename: string, value: unknown) {
  await writeFile(join(directory, filename), `${JSON.stringify(value, null, 2)}\n`);
}

async function writePassingFixtures(directory: string) {
  await writeFixture(directory, "codeowners.json", { path: ".github/CODEOWNERS", content: "LyAqIEBtdW5pc3A=" });
  await writeFixture(directory, "codeowners-errors.json", { errors: [] });
  await writeFixture(directory, "production-protection.json", {
    required_pull_request_reviews: {
      required_approving_review_count: 2,
      require_code_owner_reviews: true,
      dismiss_stale_reviews: true,
      require_last_push_approval: true,
    },
    required_status_checks: { strict: true },
    enforce_admins: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  });
  await writeFixture(directory, "production-release-environment.json", {
    name: "production-release",
    protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User", id: 123 }] }],
    prevent_self_review: true,
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
  });
  await writeFixture(directory, "pr19.json", {
    number: 19,
    merged_at: "2026-08-31T16:00:00Z",
    base: { ref: "production" },
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("post-merge governance verifier", () => {
  it("passes only when the bootstrap is merged and every required control is enforced", async () => {
    const directory = await createFixtureDirectory();
    await writePassingFixtures(directory);

    expect(verifyPostMergeGovernance({ repository: "munisp/ndsep", branch: "production", pullRequest: 19, fixtureDirectory: directory })).toEqual({
      status: "passed",
      repository: "munisp/ndsep",
      branch: "production",
      pullRequest: 19,
      errors: [],
    });
  });

  it("fails closed when the live policy does not require CODEOWNER review", async () => {
    const directory = await createFixtureDirectory();
    await writePassingFixtures(directory);
    await writeFixture(directory, "production-protection.json", {
      required_pull_request_reviews: {
        required_approving_review_count: 2,
        require_code_owner_reviews: false,
        dismiss_stale_reviews: true,
        require_last_push_approval: true,
      },
      required_status_checks: { strict: true },
      enforce_admins: { enabled: true },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
    });

    const result = verifyPostMergeGovernance({ repository: "munisp/ndsep", branch: "production", pullRequest: 19, fixtureDirectory: directory });
    expect(result.status).toBe("blocked");
    expect(result.errors).toContain("production: required CODEOWNER review is disabled");
  });

  it("fails closed when the bootstrap pull request is not merged", async () => {
    const directory = await createFixtureDirectory();
    await writePassingFixtures(directory);
    await writeFixture(directory, "pr19.json", { number: 19, merged_at: null, base: { ref: "production" } });

    const result = verifyPostMergeGovernance({ repository: "munisp/ndsep", branch: "production", pullRequest: 19, fixtureDirectory: directory });
    expect(result.status).toBe("blocked");
    expect(result.errors).toContain("PR #19: bootstrap pull request is not merged");
  });
});
