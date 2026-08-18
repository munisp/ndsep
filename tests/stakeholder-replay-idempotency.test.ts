import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { replayStakeholderSubmission } from "../server/mobilePlatformRepository";

const storePath = path.join(process.cwd(), "server", "data", "mobile-platform-store.json");
const snapshot = fs.existsSync(storePath) ? fs.readFileSync(storePath, "utf8") : null;
afterEach(() => { if (snapshot === null) fs.rmSync(storePath, { force: true }); else fs.writeFileSync(storePath, snapshot); });

describe("stakeholder replay idempotency", () => {
  it("accepts a profile once and returns an idempotent receipt on repeat", async () => {
    const payload = { kind: "profile" as const, profile: { stakeholderType: "business" as const, companyName: "Lagos BuildCo Limited", cacNumber: "RC1234567", tinNumber: "12345678901", businessEmail: "contact@buildco.ng", businessPhone: "+2348012345678", businessAddress: "10 Marina Road, Lagos", contactPerson: "Amina Bello", onboardingStatus: "draft" as const, cacStatus: "pending" as const, tinStatus: "pending" as const, submittedAt: null, verifiedAt: null, documents: [] } };
    const input = { idempotencyKey: "0a4fa0d9-94e1-43cb-8a41-cbed538c3e50", payload };
    await expect(replayStakeholderSubmission(input)).resolves.toMatchObject({ status: "accepted" });
    await expect(replayStakeholderSubmission(input)).resolves.toMatchObject({ status: "already_processed" });
  });
});
