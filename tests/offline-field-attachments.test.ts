import { describe, expect, it } from "vitest";
import { MAX_OFFLINE_ATTACHMENTS_PER_MANIFEST, MAX_OFFLINE_ATTACHMENT_BYTES } from "../lib/offline-field-attachment-policy";

describe("offline field attachment limits", () => {
  it("defines bounded offline storage limits for field evidence", () => {
    expect(MAX_OFFLINE_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_OFFLINE_ATTACHMENTS_PER_MANIFEST).toBe(10);
  });
});
