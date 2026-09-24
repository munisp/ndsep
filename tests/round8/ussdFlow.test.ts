/**
 * USSD complaint-intake state machine tests (round 8).
 *
 * Exercises the pure state machine in server/routers/ussdStateMachine.ts:
 * menu transitions in all supported languages, invalid-input handling,
 * controller lookup handshake (pick / skip / no-match), 180s session expiry,
 * and the NDPC-CMP-YYYY-NNNNNN reference format.
 *
 * No database required — DB persistence lives in server/routers/ussdChannel.ts.
 */
import { describe, it, expect } from "vitest";
import {
  advance,
  resolveControllerLookup,
  createSession,
  isSessionExpired,
  buildComplaintReference,
  buildControllerPickMenu,
  COMPLAINT_REFERENCE_RE,
  USSD_SESSION_TTL_SECONDS,
  type UssdSessionState,
} from "../../server/routers/ussdStateMachine";

const T0 = 1_800_000_000_000; // fixed epoch-ms for deterministic expiry tests

function fresh(): UssdSessionState {
  return createSession(T0);
}

/** Drive a session to CATEGORY_MENU with English selected. */
function toCategoryMenu(): UssdSessionState {
  let s = fresh();
  s = advance(s, "", T0).session; // first dial → language menu
  const r = advance(s, "1", T0 + 1000); // English
  expect(r.session.state).toBe("CATEGORY_MENU");
  return r.session;
}

/** Drive to CONTROLLER_LOOKUP with a category chosen. */
function toControllerLookup(): UssdSessionState {
  const s = toCategoryMenu();
  const r = advance(s, "2", T0 + 2000); // unlawful_processing
  expect(r.session.state).toBe("CONTROLLER_LOOKUP");
  return r.session;
}

/** Drive to CONTROLLER_PICK with two fake controller options. */
function toControllerPick(): UssdSessionState {
  const s = toControllerLookup();
  const lookup = advance(s, "acme", T0 + 3000);
  expect(lookup.lookupRequest).toBe("acme");
  const r = resolveControllerLookup(lookup.session, [
    { ref: "42", name: "Acme Telecom Ltd" },
    { ref: "77", name: "Acme Microfinance Bank" },
  ], T0 + 3500);
  expect(r.session.state).toBe("CONTROLLER_PICK");
  return r.session;
}

/** Drive to CONFIRM. */
function toConfirm(): UssdSessionState {
  let s = toControllerPick();
  s = advance(s, "1", T0 + 4000).session; // pick first controller
  expect(s.state).toBe("DESCRIPTION");
  const r = advance(s, "They exposed my BVN and phone number in a breach last week.", T0 + 5000);
  expect(r.session.state).toBe("CONFIRM");
  expect(r.response).toContain("Acme Telecom Ltd");
  return r.session;
}

describe("USSD state machine — transitions", () => {
  it("first dial shows the 4-language menu", () => {
    const r = advance(fresh(), "", T0);
    expect(r.session.state).toBe("LANG_SELECT");
    expect(r.endSession).toBe(false);
    for (const label of ["English", "Hausa", "Yoruba", "Igbo"]) {
      expect(r.response).toContain(label);
    }
  });

  it("rejects invalid language selection and stays on the menu", () => {
    const s = advance(fresh(), "", T0).session;
    const r = advance(s, "9", T0 + 1000);
    expect(r.session.state).toBe("LANG_SELECT");
    expect(r.response).toContain("Invalid");
  });

  it("selects each supported language", () => {
    for (const [input, lang] of [["1", "en"], ["2", "ha"], ["3", "yo"], ["4", "ig"]] as const) {
      const s = advance(fresh(), "", T0).session;
      const r = advance(s, input, T0 + 1000);
      expect(r.session.language).toBe(lang);
      expect(r.session.state).toBe("CATEGORY_MENU");
    }
  });

  it("maps menu numbers to complaint categories", () => {
    const cases: Array<[string, string]> = [
      ["1", "data_breach"],
      ["2", "unlawful_processing"],
      ["3", "consent_violation"],
      ["4", "unauthorized_access"],
      ["5", "other"],
    ];
    for (const [input, expected] of cases) {
      const r = advance(toCategoryMenu(), input, T0 + 2000);
      expect(r.session.payload.category).toBe(expected);
      expect(r.session.state).toBe("CONTROLLER_LOOKUP");
    }
  });

  it("rejects out-of-range category input", () => {
    const r = advance(toCategoryMenu(), "6", T0 + 2000);
    expect(r.session.state).toBe("CATEGORY_MENU");
    expect(r.response).toContain("Invalid");
  });

  it("requests controller resolution for a name fragment", () => {
    const r = advance(toControllerLookup(), "acme", T0 + 3000);
    expect(r.lookupRequest).toBe("acme");
    expect(r.session.state).toBe("CONTROLLER_LOOKUP");
    expect(r.session.payload.controllerQuery).toBe("acme");
  });

  it("presents a pick-list when controllers match", () => {
    const s = toControllerPick();
    const menu = buildControllerPickMenu(s);
    expect(menu).toContain("1. Acme Telecom Ltd");
    expect(menu).toContain("2. Acme Microfinance Bank");
  });

  it("no-match keeps the session in CONTROLLER_LOOKUP with a retry menu", () => {
    const s = toControllerLookup();
    const lookup = advance(s, "zzz-no-such-org", T0 + 3000);
    const r = resolveControllerLookup(lookup.session, [], T0 + 3500);
    expect(r.session.state).toBe("CONTROLLER_LOOKUP");
    expect(r.response.toLowerCase()).toContain("no organisation matched");
  });

  it("entering 0 skips controller selection", () => {
    const s = toControllerLookup();
    const lookup = advance(s, "0", T0 + 3000);
    expect(lookup.lookupRequest).toBe("0");
    const r = resolveControllerLookup(lookup.session, [], T0 + 3500);
    expect(r.session.state).toBe("DESCRIPTION");
    expect(r.session.payload.controllerRef).toBeNull();
  });

  it("picking a controller stores ref and name", () => {
    const s = toControllerPick();
    const r = advance(s, "2", T0 + 4000);
    expect(r.session.payload.controllerRef).toBe("77");
    expect(r.session.payload.controllerName).toBe("Acme Microfinance Bank");
    expect(r.session.state).toBe("DESCRIPTION");
  });

  it("enforces a minimum description length", () => {
    const s = advance(toControllerPick(), "1", T0 + 4000).session;
    const r = advance(s, "too short", T0 + 5000);
    expect(r.session.state).toBe("DESCRIPTION");
    expect(r.response).toContain("min 10");
  });

  it("full happy path ends in DONE with endSession", () => {
    const s = toConfirm();
    const r = advance(s, "1", T0 + 6000);
    expect(r.session.state).toBe("DONE");
    expect(r.endSession).toBe(true);
    expect(r.response).toBe("COMPLAINT_ACCEPTED");
    expect(r.session.payload.description).toContain("BVN");
  });

  it("confirm option 2 cancels the complaint", () => {
    const s = toConfirm();
    const r = advance(s, "2", T0 + 6000);
    expect(r.session.state).toBe("CANCELLED");
    expect(r.endSession).toBe(true);
  });

  it("invalid input at CONFIRM re-renders the summary", () => {
    const s = toConfirm();
    const r = advance(s, "x", T0 + 6000);
    expect(r.session.state).toBe("CONFIRM");
    expect(r.response).toContain("Invalid");
  });

  it("terminal sessions restart on further input", () => {
    const s = toConfirm();
    const done = advance(s, "1", T0 + 6000).session;
    const r = advance(done, "anything", T0 + 7000);
    expect(r.session.state).toBe("LANG_SELECT");
  });
});

describe("USSD state machine — expiry", () => {
  it("session is fresh within the 180s window", () => {
    const s = toCategoryMenu();
    expect(isSessionExpired(s, T0 + 1000 + USSD_SESSION_TTL_SECONDS * 1000)).toBe(false);
    expect(isSessionExpired(s, T0 + 1000 + USSD_SESSION_TTL_SECONDS * 1000 + 1)).toBe(true);
  });

  it("input after 180s of inactivity discards progress and restarts", () => {
    const s = toControllerPick(); // last activity at T0+3500
    const r = advance(s, "1", T0 + 3500 + 181_000);
    expect(r.session.state).toBe("LANG_SELECT");
    expect(r.response).toContain("expired");
    expect(r.session.payload.category).toBeUndefined();
  });

  it("activity inside the window advances normally", () => {
    const s = toControllerPick();
    const r = advance(s, "1", T0 + 3500 + 179_000);
    expect(r.session.state).toBe("DESCRIPTION");
  });
});

describe("complaint reference format", () => {
  it("builds NDPC-CMP-YYYY-NNNNNN with six-digit zero padding", () => {
    expect(buildComplaintReference(2026, 1)).toBe("NDPC-CMP-2026-000001");
    expect(buildComplaintReference(2026, 123)).toBe("NDPC-CMP-2026-000123");
    expect(buildComplaintReference(2026, 999999)).toBe("NDPC-CMP-2026-999999");
  });

  it("matches the canonical regex", () => {
    expect(COMPLAINT_REFERENCE_RE.test(buildComplaintReference(2026, 42))).toBe(true);
    expect(COMPLAINT_REFERENCE_RE.test("NDPC-CMP-2026-123")).toBe(false); // 3 digits
    expect(COMPLAINT_REFERENCE_RE.test("CMP-2026-000042")).toBe(false);
    expect(COMPLAINT_REFERENCE_RE.test("FOIA-2026-00042")).toBe(false);
  });
});
