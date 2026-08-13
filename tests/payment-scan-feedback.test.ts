import { describe, expect, it } from "vitest";

import { paymentScanFeedback } from "../lib/payment-scan-feedback";

describe("payment receipt scan feedback", () => {
  it("uses a success cue only for administratively approved receipt records", () => {
    expect(paymentScanFeedback("approved")).toBe("success");
    expect(paymentScanFeedback("pending_review")).toBe("error");
    expect(paymentScanFeedback("rejected")).toBe("error");
    expect(paymentScanFeedback("not_found")).toBe("error");
  });
});
