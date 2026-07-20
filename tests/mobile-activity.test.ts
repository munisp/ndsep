import { describe, expect, it } from "vitest";

import { buildActivityInteractionProfile, defaultActivityFeed, filterActivities, rankActivitiesForInbox } from "../lib/mobile-activity";

describe("mobile activity layer", () => {
  it("exposes seeded audit history for each alert", () => {
    expect(defaultActivityFeed[0]?.auditHistory.length).toBeGreaterThan(0);
    expect(defaultActivityFeed[0]?.auditHistory[0]?.kind).toBe("created");
  });

  it("builds an interaction profile across categories", () => {
    const profile = buildActivityInteractionProfile([
      {
        ...defaultActivityFeed[0]!,
        auditHistory: [
          { id: "a1", kind: "opened", label: "Opened", actor: "user", timestamp: "2026-07-20T05:00:00Z", detail: "Opened in detail sheet." },
          { id: "a2", kind: "marked_read", label: "Read", actor: "user", timestamp: "2026-07-20T05:01:00Z", detail: "Marked as read." },
          ...defaultActivityFeed[0]!.auditHistory,
        ],
      },
      {
        ...defaultActivityFeed[1]!,
        auditHistory: [
          { id: "b1", kind: "action_completed", label: "Action", actor: "user", timestamp: "2026-07-20T05:02:00Z", detail: "Approved from inbox." },
          ...defaultActivityFeed[1]!.auditHistory,
        ],
      },
    ]);

    expect(profile.totalOpened).toBe(1);
    expect(profile.totalActioned).toBe(1);
    expect(profile.unreadResolvedByCategory.field).toBe(1);
  });

  it("ranks high-priority unread alerts ahead of lower-priority items and excludes dismissed alerts from filtering", () => {
    const ranked = rankActivitiesForInbox([
      {
        ...defaultActivityFeed[2]!,
        dismissedAt: null,
      },
      {
        ...defaultActivityFeed[1]!,
        dismissedAt: null,
      },
      {
        ...defaultActivityFeed[0]!,
        dismissedAt: "2026-07-20T05:10:00Z",
      },
    ]);

    expect(ranked[0]?.id).toBe(defaultActivityFeed[1]?.id);

    const filtered = filterActivities(
      [
        {
          ...defaultActivityFeed[0]!,
          dismissedAt: "2026-07-20T05:10:00Z",
        },
        defaultActivityFeed[1]!,
      ],
      "all",
      "",
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe(defaultActivityFeed[1]?.id);
  });
});
