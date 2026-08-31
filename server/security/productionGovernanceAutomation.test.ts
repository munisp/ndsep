import { describe, expect, it } from "vitest";
import {
  assessRootGaps,
  buildEnvironmentPayload,
  buildPlan,
  buildReviewProtectionPayload,
} from "../../scripts/ci/apply-production-governance.mjs";

function passingState() {
  return {
    pullRequest: { merged_at: "2026-08-31T17:00:00Z" },
    codeowners: { path: ".github/CODEOWNERS", content: "LyAqIEBtdW5pc3A=" },
    codeownersErrors: { errors: [] },
    protection: {
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
    },
    environment: {
      name: "production-release",
      protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User", id: 42 }] }],
      prevent_self_review: true,
      deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
    },
  };
}

describe("production governance automation", () => {
  it("builds a narrow review-protection payload without replacing status-check configuration", () => {
    expect(buildReviewProtectionPayload()).toEqual({
      dismiss_stale_reviews: true,
      require_code_owner_reviews: true,
      required_approving_review_count: 2,
      require_last_push_approval: true,
    });
  });

  it("builds a protected production-release environment payload with self-review prevention", () => {
    expect(buildEnvironmentPayload(42)).toEqual({
      wait_timer: 0,
      reviewers: [{ type: "User", id: 42 }],
      deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
      prevent_self_review: true,
    });
    expect(() => buildEnvironmentPayload(0)).toThrow("Reviewer ID must be a positive integer");
  });

  it("reports every root governance gap in plan mode", () => {
    const state = passingState();
    state.pullRequest.merged_at = null;
    state.codeowners = null;
    state.codeownersErrors = null;
    state.protection.required_pull_request_reviews.required_approving_review_count = 1;
    state.protection.required_pull_request_reviews.require_code_owner_reviews = false;
    state.environment = null;

    const gaps = assessRootGaps(state);
    expect(gaps).toEqual(
      expect.arrayContaining([
        "pr-not-merged",
        "codeowners-missing",
        "codeowners-invalid",
        "two-approvals-disabled",
        "codeowner-review-disabled",
        "production-release-missing",
        "production-release-reviewers-missing",
        "production-release-self-review-denial-disabled",
        "production-release-branch-policy-disabled",
      ])
    );
    expect(buildPlan({ repository: "munisp/ndsep", branch: "production", environment: "production-release", pullRequest: 19, state }).mode).toBe("plan");
  });

  it("reports no gaps only when every governance control is present", () => {
    expect(assessRootGaps(passingState())).toEqual([]);
  });
});
