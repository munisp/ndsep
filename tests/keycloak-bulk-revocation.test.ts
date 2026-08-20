import { describe, expect, it } from "vitest";
import { bulkSessionConfirmationPhrase, validateBulkSessionRevocation } from "../lib/keycloak-bulk-revocation";

describe("bulk Keycloak session revocation safeguards", () => {
  it("requires a count-bound confirmation phrase and a meaningful reason", () => {
    expect(bulkSessionConfirmationPhrase(2)).toBe("TERMINATE 2");
    expect(validateBulkSessionRevocation({ sessionIds: ["session-one", "session-two"], confirmation: "TERMINATE 1", reason: "Suspected credential misuse" }).valid).toBe(false);
    expect(validateBulkSessionRevocation({ sessionIds: ["session-one", "session-two"], confirmation: "TERMINATE 2", reason: "suspect" }).valid).toBe(false);
    expect(validateBulkSessionRevocation({ sessionIds: ["session-one", "session-one", "session-two"], confirmation: "TERMINATE 2", reason: "Suspected credential misuse" })).toMatchObject({ valid: true, sessionIds: ["session-one", "session-two"] });
  });
});
