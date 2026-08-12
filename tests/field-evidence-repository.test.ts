import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { listFieldEvidence, recordFieldEvidence, reviewFieldEvidence } from "../server/fieldEvidenceRepository";

const storePath = path.join(process.cwd(), "server", "data", "field-evidence.json");

afterEach(() => {
  if (fs.existsSync(storePath)) fs.rmSync(storePath);
});

describe("field evidence repository", () => {
  it("records an offline manifest once and preserves its unverified trust state", () => {
    const input = {
      id: "field-evidence-test-001",
      missionId: "mission-lagos-001",
      parcelId: 101,
      observationType: "boundary_marker" as const,
      notes: "Boundary marker observed beside the local access road.",
      capturedAt: "2026-08-12T10:00:00.000Z",
      coordinateSource: "parcel_reference" as const,
      latitude: 6.5244,
      longitude: 3.3792,
      attachmentCount: 0,
      attachments: [{ id: "attachment-test-001", kind: "photo" as const, name: "boundary.jpg", mimeType: "image/jpeg", size: 1024, localUri: "file:///evidence/boundary.jpg", persistence: "app_document_directory" as const, capturedAt: "2026-08-12T10:00:00.000Z" }],
      verificationState: "unverified" as const,
      origin: "offline_queue" as const,
    };

    expect(recordFieldEvidence(input)).toMatchObject({ status: "recorded", evidence: { verificationState: "unverified", origin: "offline_queue", attachmentCount: 1 } });
    expect(recordFieldEvidence(input)).toMatchObject({ status: "duplicate" });
    expect(reviewFieldEvidence({ id: input.id, decision: "approved", reviewer: "admin-subject", reason: "Boundary photo and note are internally consistent." })).toMatchObject({ status: "reviewed", evidence: { verificationState: "approved", reviewedBy: "admin-subject" } });
    expect(reviewFieldEvidence({ id: input.id, decision: "rejected", reviewer: "admin-subject", reason: "Should not overwrite the first review." })).toMatchObject({ status: "already_reviewed", evidence: { verificationState: "approved" } });
    expect(listFieldEvidence("mission-lagos-001")).toHaveLength(1);
  });
});
