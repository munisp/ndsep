/**
 * Round-9 tests: USSD → web complaint category mapping (FIX 2a).
 *
 * USSD intake now lands complaints directly in public_complaints, whose
 * category CHECK constraint only accepts the web vocabulary. The mapping
 * must be explicit, total over the USSD menu vocabulary, and must never
 * pass an unmapped value through.
 */
import { describe, it, expect } from "vitest";
import {
  USSD_TO_WEB_CATEGORY,
  mapUssdCategoryToWeb,
  COMPLAINT_CATEGORIES,
} from "../../server/services/complaintLogic";
import { USSD_CATEGORIES } from "../../server/routers/ussdStateMachine";

describe("USSD → web category mapping", () => {
  it("maps every USSD menu category", () => {
    for (const cat of USSD_CATEGORIES) {
      expect(mapUssdCategoryToWeb(cat), `unmapped USSD category: ${cat}`).not.toBeNull();
    }
  });

  it("maps only into the canonical web vocabulary", () => {
    for (const web of Object.values(USSD_TO_WEB_CATEGORY)) {
      expect(COMPLAINT_CATEGORIES).toContain(web);
    }
  });

  it("returns null for unmapped/unknown values (no pass-through)", () => {
    expect(mapUssdCategoryToWeb("breach")).toBeNull(); // web term must not leak in via USSD
    expect(mapUssdCategoryToWeb("")).toBeNull();
    expect(mapUssdCategoryToWeb("DATA_BREACH")).toBeNull(); // case-sensitive, explicit
    expect(mapUssdCategoryToWeb("garbage")).toBeNull();
  });

  it("maps the documented pairs", () => {
    expect(mapUssdCategoryToWeb("data_breach")).toBe("breach");
    expect(mapUssdCategoryToWeb("consent_violation")).toBe("consent");
    expect(mapUssdCategoryToWeb("unauthorized_access")).toBe("breach");
    expect(mapUssdCategoryToWeb("unlawful_processing")).toBe("other");
    expect(mapUssdCategoryToWeb("other")).toBe("other");
  });

  it("mapping table keys exactly match the USSD state-machine vocabulary", () => {
    expect(Object.keys(USSD_TO_WEB_CATEGORY).sort()).toEqual([...USSD_CATEGORIES].sort());
  });
});
