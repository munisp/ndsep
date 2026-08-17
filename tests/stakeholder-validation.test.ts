import { describe, expect, it } from "vitest";
import { validateStakeholderProfile } from "../lib/stakeholder-validation";

const valid = { companyName: "Kaduna Housing Cooperative", cacNumber: "RC1234567", tinNumber: "12345678901", businessEmail: "contact@kadunahousing.ng", businessPhone: "+2348012345678", businessAddress: "12 Independence Way, Kaduna", contactPerson: "Amina Bello" };
describe("stakeholder profile validation", () => {
  it("accepts syntactically complete stakeholder data without treating it as verified", () => expect(validateStakeholderProfile(valid)).toEqual({}));
  it("returns field-specific errors for malformed regulatory and contact inputs", () => {
    const result = validateStakeholderProfile({ ...valid, cacNumber: "invalid", tinNumber: "12", businessEmail: "not-an-email", businessPhone: "555", businessAddress: "short", contactPerson: "Amina" });
    expect(Object.keys(result)).toEqual(expect.arrayContaining(["cacNumber", "tinNumber", "businessEmail", "businessPhone", "businessAddress", "contactPerson"]));
  });
});
