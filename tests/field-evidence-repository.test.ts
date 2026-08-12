import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { listFieldEvidence, recordFieldEvidence } from "../server/fieldEvidenceRepository";

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
      verificationState: "unverified" as const,
      origin: "offline_queue" as const,
    };

    expect(recordFieldEvidence(input)).toMatchObject({ status: "recorded", evidence: { verificationState: "unverified", origin: "offline_queue" } });
    expect(recordFieldEvidence(input)).toMatchObject({ status: "duplicate" });
    expect(listFieldEvidence("mission-lagos-001")).toHaveLength(1);
  });
});
