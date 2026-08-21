import { describe, expect, it } from "vitest";

import { validateSharedSupervisorFilterPreset } from "../lib/supervisor-filter-presets";

describe("shared supervisor preset validation", () => {
  it("accepts a compatible local-only shared preset payload", () => {
    const preset = validateSharedSupervisorFilterPreset(JSON.stringify({ type: "idlr_pts_supervisor_filter_preset", localOnly: true, name: "Overdue queue", filter: "overdue", sort: "priority" }));
    expect(preset).toMatchObject({ name: "Overdue queue", filter: "overdue", sort: "priority" });
  });

  it("rejects malformed, non-local, and unsupported filter payloads", () => {
    expect(validateSharedSupervisorFilterPreset("not json")).toBeNull();
    expect(validateSharedSupervisorFilterPreset(JSON.stringify({ type: "idlr_pts_supervisor_filter_preset", localOnly: false, name: "Unsafe", filter: "all", sort: "priority" }))).toBeNull();
    expect(validateSharedSupervisorFilterPreset(JSON.stringify({ type: "idlr_pts_supervisor_filter_preset", localOnly: true, name: "Unsafe", filter: "admin", sort: "priority" }))).toBeNull();
  });
});
