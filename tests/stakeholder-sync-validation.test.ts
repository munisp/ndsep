import { describe, expect, it } from "vitest";
import { validateDeadLetterEdit } from "../lib/stakeholder-sync-validation";

describe("dead-letter stakeholder edit validation", () => {
  it("rejects incomplete stakeholder corrections before retry", () => {
    expect(validateDeadLetterEdit({ kind: "profile", profile: { companyName: "", cacNumber: "", tinNumber: "", businessEmail: "", businessPhone: "", businessAddress: "", contactPerson: "" } })).toMatchObject({ companyName: expect.any(String), cacNumber: expect.any(String), tinNumber: expect.any(String) });
  });
  it("accepts a complete Nigerian business correction", () => {
    expect(validateDeadLetterEdit({ kind: "profile", profile: { companyName: "Abuja Survey Services Limited", cacNumber: "RC1234567", tinNumber: "12345678901", businessEmail: "ops@survey.ng", businessPhone: "+2348012345678", businessAddress: "10 Independence Avenue, Abuja", contactPerson: "Amina Bello" } })).toEqual({});
  });
  it("requires usable document metadata", () => {
    expect(validateDeadLetterEdit({ kind: "identity_document", document: { type: "", fileName: "", mimeType: "text" } })).toMatchObject({ type: expect.any(String), fileName: expect.any(String), mimeType: expect.any(String) });
  });
});
