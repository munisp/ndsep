import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { replayStakeholderSubmission } from "../server/mobilePlatformRepository";

const storePath = path.join(process.cwd(), "server", "data", "mobile-platform-store.json");
const original = fs.existsSync(storePath) ? fs.readFileSync(storePath, "utf8") : null;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function restoreStore() {
  if (original === null) fs.rmSync(storePath, { force: true });
  else fs.writeFileSync(storePath, original);
}
afterEach(restoreStore);

describe("stakeholder replay idempotency", () => {
  it("commits one profile submission and returns an idempotent receipt on replay", async () => {
    const payload = { kind: "profile" as const, profile: { stakeholderType: "business" as const, companyName: "Lagos BuildCo Limited", cacNumber: "RC1234567", tinNumber: "12345678901", businessEmail: "contact@buildco.ng", businessPhone: "+2348012345678", businessAddress: "10 Marina Road, Lagos", contactPerson: "Amina Bello", onboardingStatus: "draft" as const, cacStatus: "pending" as const, tinStatus: "pending" as const, submittedAt: null, verifiedAt: null, documents: [] } };
    const payloadHash = crypto.createHash("sha256").update(canonical(payload)).digest("hex");
    const first = await replayStakeholderSubmission({ idempotencyKey: "0a4fa0d9-94e1-43cb-8a41-cbed538c3e50", payloadHash, payload });
    const repeated = await replayStakeholderSubmission({ idempotencyKey: "0a4fa0d9-94e1-43cb-8a41-cbed538c3e50", payloadHash, payload });
    expect(first.status).toBe("accepted");
    expect(repeated.status).toBe("already_processed");
  });

  it("rejects reuse of an idempotency key with a different payload", async () => {
    const firstPayload = { kind: "profile" as const, profile: { stakeholderType: "business" as const, companyName: "Kano Estates Limited", cacNumber: "RC2345678", tinNumber: "12345678901", businessEmail: "contact@kanoestates.ng", businessPhone: "+2348012345678", businessAddress: "14 Murtala Way, Kano", contactPerson: "Sadiq Musa", onboardingStatus: "draft" as const, cacStatus: "pending" as const, tinStatus: "pending" as const, submittedAt: null, verifiedAt: null, documents: [] } };
    const secondPayload = { ...firstPayload, profile: { ...firstPayload.profile, companyName: "Changed name" } };
    const key = "d50464dc-ff3c-4fa7-a6c6-734d00a418af";
    await replayStakeholderSubmission({ idempotencyKey: key, payloadHash: crypto.createHash("sha256").update(canonical(firstPayload)).digest("hex"), payload: firstPayload });
    await expect(replayStakeholderSubmission({ idempotencyKey: key, payloadHash: crypto.createHash("sha256").update(canonical(secondPayload)).digest("hex"), payload: secondPayload })).rejects.toThrow("IDEMPOTENCY_KEY_COLLISION");
  });
});
