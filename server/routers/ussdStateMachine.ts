/**
 * USSD complaint-intake state machine — pure, dependency-free logic.
 *
 * Kept separate from server/routers/ussdChannel.ts (which owns DB persistence,
 * the SMS gateway adapter, rate limiting and audit) so the state transitions,
 * session expiry and reference-code format can be unit-tested without a
 * database (tests/round8/ussdFlow.test.ts).
 *
 * Flow: LANG_SELECT → CATEGORY_MENU → CONTROLLER_LOOKUP → CONTROLLER_PICK
 *       → DESCRIPTION → CONFIRM → DONE (or CANCELLED from CONFIRM).
 *
 * Session expiry: 180 seconds of inactivity (USSD_SESSION_TTL_SECONDS).
 */

export type UssdLanguage = "en" | "ha" | "yo" | "ig";

export type UssdState =
  | "LANG_SELECT"
  | "CATEGORY_MENU"
  | "CONTROLLER_LOOKUP"
  | "CONTROLLER_PICK"
  | "DESCRIPTION"
  | "CONFIRM"
  | "DONE"
  | "CANCELLED";

export const USSD_SESSION_TTL_SECONDS = 180;
export const USSD_SESSION_TTL_MS = USSD_SESSION_TTL_SECONDS * 1000;

export const USSD_CATEGORIES = [
  "data_breach",
  "unlawful_processing",
  "consent_violation",
  "unauthorized_access",
  "other",
] as const;
export type UssdCategory = (typeof USSD_CATEGORIES)[number];

export interface ControllerOption {
  ref: string;   // organization id / short code
  name: string;  // display name
}

export interface UssdPayload {
  category?: UssdCategory;
  controllerQuery?: string;
  controllerOptions?: ControllerOption[];
  controllerRef?: string | null;
  controllerName?: string | null;
  description?: string;
}

export interface UssdSessionState {
  state: UssdState;
  language: UssdLanguage | null;
  payload: UssdPayload;
  /** epoch-ms of last activity; expiry is computed against this */
  updatedAtMs: number;
}

export interface AdvanceResult {
  session: UssdSessionState;
  /** text rendered back to the gateway (CON ... / END ... handled by the router) */
  response: string;
  /** true when the session terminates (DONE / CANCELLED / invalid-expired restart) */
  endSession: boolean;
  /** set when the router must resolve a controller name fragment before advancing */
  lookupRequest?: string;
}

// ─── Localization (menu strings only; complaint content stays as entered) ───

const STRINGS: Record<UssdLanguage, {
  categoryMenu: string;
  controllerPrompt: string;
  controllerNoMatch: string;
  controllerPick: string;
  descriptionPrompt: string;
  confirm: (ref: { category: string; controller: string }) => string;
  cancelled: string;
  invalid: string;
  expired: string;
}> = {
  en: {
    categoryMenu: "Select complaint category:\n1. Data breach\n2. Unlawful processing\n3. Consent violation\n4. Unauthorized access\n5. Other",
    controllerPrompt: "Enter the name (or part of the name) of the organisation you are complaining about.\n0. Skip",
    controllerNoMatch: "No organisation matched. Enter another name fragment.\n0. Skip",
    controllerPick: "Select organisation:",
    descriptionPrompt: "Briefly describe your complaint (what happened, when).",
    confirm: ({ category, controller }) =>
      `Confirm complaint:\nCategory: ${category}\nOrganisation: ${controller}\n1. Confirm\n2. Cancel`,
    cancelled: "Complaint cancelled. Dial again any time to start over.",
    invalid: "Invalid option. Please try again.",
    expired: "Session expired. Your entries were discarded; please dial again.",
  },
  ha: {
    categoryMenu: "Zaɓi nau'in ƙoli:\n1. Baiwar bayanai\n2. Sarrafa ba bisa doka ba\n3. Karya izini\n4. Shiga ba izini\n5. Sauran",
    controllerPrompt: "Shigar da sunan ƙungiyar da kake ƙorafi a kanta (ko wani ɓangare).\n0. Tsallake",
    controllerNoMatch: "Babu ƙungiya da ta dace. Shigar da wani suna.\n0. Tsallake",
    controllerPick: "Zaɓi ƙungiya:",
    descriptionPrompt: "Taƙaita ƙorafinka (abin da ya faru, da yaushe).",
    confirm: ({ category, controller }) =>
      `Tabbatar da ƙorafi:\nNau'i: ${category}\nƘungiya: ${controller}\n1. Tabbatar\n2. Soke`,
    cancelled: "An soke ƙorafin. Kira kuma a duk lokacin da kake so.",
    invalid: "Zaɓi mara inganci. Sake gwadawa.",
    expired: "Zaman ya ƙare. An watsar da shigarwar; sake kira.",
  },
  yo: {
    categoryMenu: "Yan oriṣi ẹsun:\n1. Fifọ data silẹ\n2. Ilo laigba-aṣẹ\n3. Rufin igbanilaaye\n4. Wiwo laigbanilaaye\n5. Omiiran",
    controllerPrompt: "Tẹ orukọ agbari (tabi apakan rẹ) ti o fẹ ṣe ẹsun nipa.\n0. Fọrọ",
    controllerNoMatch: "Ko si agbari to baamu. Tẹ apakan orukọ miiran.\n0. Fọrọ",
    controllerPick: "Yan agbari:",
    descriptionPrompt: "Ṣalaye ẹsun rẹ ni ṣoki (ohun to ṣẹlẹ, igba wo).",
    confirm: ({ category, controller }) =>
      `Jẹrisi ẹsun:\nOriṣi: ${category}\nAgbari: ${controller}\n1. Jẹrisi\n2. Fagilee`,
    cancelled: "A ti fagilee ẹsun naa. Pe leekansi nigbakugba.",
    invalid: "Aṣayan aitọ. Jọwọ gbiyanju lẹẹkansi.",
    expired: "Akoko ipariṣẹ ti koja. A ti da ẹ̀kọ silẹ; jọwọ pe lẹẹkansi.",
  },
  ig: {
    categoryMenu: "Họrọ ụdị mkpesa:\n1. Mgbapụ data\n2. Nhazi na-emebi iwu\n3. Mmebi nkwenye\n4. Ịbanye na-enweghị ikike\n5. Ndị ọzọ",
    controllerPrompt: "Tinye aha nzukọ (ma ọ bụ akụkụ ya) ị na-eme mkpesa megide.\n0. Wụsịa",
    controllerNoMatch: "Ọ dịghị nzukọ dakọtara. Tinye akụkụ aha ọzọ.\n0. Wụsịa",
    controllerPick: "Họrọ nzukọ:",
    descriptionPrompt: "Kọwaa mkpesa gị nkenke (ihe mere, oge ole).",
    confirm: ({ category, controller }) =>
      `Kwenye mkpesa:\nỤdị: ${category}\nNzukọ: ${controller}\n1. Kwenye\n2. Kagbuo`,
    cancelled: "E kagbuola mkpesa ahụ. Kpọọ ọzọ oge ọ bụla.",
    invalid: "Nhọrọ na-ezighi ezi. Nwaa ọzọ.",
    expired: "Oge njikọ agwụla. Ahapụla ihe ị tinyere; kpọọ ọzọ.",
  },
};

const LANGUAGE_MENU =
  "NDPC Complaints / Kudin Bayanai / Ẹsun Data / Mkpesa Data\n" +
  "1. English\n2. Hausa\n3. Yoruba\n4. Igbo";

const LANGUAGE_BY_INPUT: Record<string, UssdLanguage> = {
  "1": "en",
  "2": "ha",
  "3": "yo",
  "4": "ig",
};

function lang(session: UssdSessionState): UssdLanguage {
  return session.language ?? "en";
}

export function createSession(nowMs: number = Date.now()): UssdSessionState {
  return { state: "LANG_SELECT", language: null, payload: {}, updatedAtMs: nowMs };
}

/** A session is expired after 180s of inactivity. */
export function isSessionExpired(session: UssdSessionState, nowMs: number = Date.now()): boolean {
  return nowMs - session.updatedAtMs > USSD_SESSION_TTL_MS;
}

/** NDPC-CMP-YYYY-NNNNNN — six digits from ndsep_complaint_ref_seq. */
export function buildComplaintReference(year: number, sequenceNumber: number): string {
  return `NDPC-CMP-${year}-${String(sequenceNumber).padStart(6, "0")}`;
}

export const COMPLAINT_REFERENCE_RE = /^NDPC-CMP-\d{4}-\d{6}$/;

function invalid(result: AdvanceResult): AdvanceResult {
  return {
    ...result,
    response: `${STRINGS[lang(result.session)].invalid}\n${result.response}`,
  };
}

/**
 * Advance the state machine with one gateway input. `input` is the text the
 * subscriber entered at the current menu (empty string for the first dial).
 * Controller resolution is a two-step handshake: in CONTROLLER_LOOKUP the
 * function returns `lookupRequest`; the router resolves options against the
 * organizations table and calls `resolveControllerLookup`.
 */
export function advance(
  session: UssdSessionState,
  input: string,
  nowMs: number = Date.now(),
): AdvanceResult {
  // Expiry: any input on an expired non-terminal session restarts cleanly.
  if (isSessionExpired(session, nowMs) && session.state !== "DONE" && session.state !== "CANCELLED") {
    const fresh = createSession(nowMs);
    return {
      session: fresh,
      response: `${STRINGS.en.expired}\n\n${LANGUAGE_MENU}`,
      endSession: false,
    };
  }

  const s: UssdSessionState = {
    ...session,
    payload: { ...session.payload },
    updatedAtMs: nowMs,
  };
  const trimmed = input.trim();
  const t = STRINGS[lang(s)];

  switch (s.state) {
    case "LANG_SELECT": {
      if (trimmed === "") {
        // First dial — show the language menu.
        return { session: s, response: LANGUAGE_MENU, endSession: false };
      }
      const selected = LANGUAGE_BY_INPUT[trimmed];
      if (!selected) return invalid({ session: s, response: LANGUAGE_MENU, endSession: false });
      s.language = selected;
      s.state = "CATEGORY_MENU";
      return { session: s, response: STRINGS[selected].categoryMenu, endSession: false };
    }

    case "CATEGORY_MENU": {
      const idx = parseInt(trimmed, 10);
      if (!Number.isInteger(idx) || idx < 1 || idx > USSD_CATEGORIES.length) {
        return invalid({ session: s, response: t.categoryMenu, endSession: false });
      }
      s.payload.category = USSD_CATEGORIES[idx - 1];
      s.state = "CONTROLLER_LOOKUP";
      return { session: s, response: t.controllerPrompt, endSession: false };
    }

    case "CONTROLLER_LOOKUP": {
      if (trimmed === "") {
        return invalid({ session: s, response: t.controllerPrompt, endSession: false });
      }
      // Router must resolve the fragment against the organizations table,
      // then call resolveControllerLookup with the matches (possibly empty).
      s.payload.controllerQuery = trimmed;
      return { session: s, response: "", endSession: false, lookupRequest: trimmed };
    }

    case "CONTROLLER_PICK": {
      const options = s.payload.controllerOptions ?? [];
      const idx = parseInt(trimmed, 10);
      const menu = buildControllerPickMenu(s);
      if (!Number.isInteger(idx) || idx < 0 || idx > options.length) {
        return invalid({ session: s, response: menu, endSession: false });
      }
      if (idx === 0) {
        // Skip: complaint filed against an unlisted controller.
        s.payload.controllerRef = null;
        s.payload.controllerName = s.payload.controllerQuery ?? null;
      } else {
        s.payload.controllerRef = options[idx - 1].ref;
        s.payload.controllerName = options[idx - 1].name;
      }
      s.state = "DESCRIPTION";
      return { session: s, response: t.descriptionPrompt, endSession: false };
    }

    case "DESCRIPTION": {
      if (trimmed.length < 10) {
        return invalid({
          session: s,
          response: `${t.descriptionPrompt} (min 10 characters)`,
          endSession: false,
        });
      }
      s.payload.description = trimmed.slice(0, 1000);
      s.state = "CONFIRM";
      return {
        session: s,
        response: t.confirm({
          category: s.payload.category ?? "other",
          controller: s.payload.controllerName ?? "(not specified)",
        }),
        endSession: false,
      };
    }

    case "CONFIRM": {
      if (trimmed === "1") {
        s.state = "DONE";
        // The router issues the reference code and appends it to this text.
        return { session: s, response: "COMPLAINT_ACCEPTED", endSession: true };
      }
      if (trimmed === "2") {
        s.state = "CANCELLED";
        return { session: s, response: t.cancelled, endSession: true };
      }
      return invalid({
        session: s,
        response: t.confirm({
          category: s.payload.category ?? "other",
          controller: s.payload.controllerName ?? "(not specified)",
        }),
        endSession: false,
      });
    }

    case "DONE":
    case "CANCELLED": {
      // Terminal states: any further input starts a new session.
      const fresh = createSession(nowMs);
      return { session: fresh, response: LANGUAGE_MENU, endSession: false };
    }

    default: {
      const fresh = createSession(nowMs);
      return { session: fresh, response: LANGUAGE_MENU, endSession: false };
    }
  }
}

/** Menu text for CONTROLLER_PICK (exported so the router can reuse it). */
export function buildControllerPickMenu(session: UssdSessionState): string {
  const options = session.payload.controllerOptions ?? [];
  const t = STRINGS[lang(session)];
  const lines = options.map((o, i) => `${i + 1}. ${o.name}`);
  return `${t.controllerPick}\n${lines.join("\n")}\n0. ${session.language === "en" ? "Skip / not listed" : "0: Tsallake / Fọrọ / Wụsịa"}`;
}

/**
 * Second step of the controller handshake: called by the router (or a test)
 * with the organizations matching the fragment from CONTROLLER_LOOKUP.
 * Empty options keep the session in CONTROLLER_LOOKUP with a no-match menu;
 * 1–8 options move to CONTROLLER_PICK.
 */
export function resolveControllerLookup(
  session: UssdSessionState,
  options: ControllerOption[],
  nowMs: number = Date.now(),
): AdvanceResult {
  const t = STRINGS[lang(session)];
  if (session.state !== "CONTROLLER_LOOKUP" || !session.payload.controllerQuery) {
    return { session, response: t.controllerPrompt, endSession: false };
  }
  const s: UssdSessionState = { ...session, payload: { ...session.payload }, updatedAtMs: nowMs };
  if (s.payload.controllerQuery === "0" || options.length === 0) {
    if (s.payload.controllerQuery === "0") {
      // Explicit skip.
      s.payload.controllerRef = null;
      s.payload.controllerName = null;
      s.state = "DESCRIPTION";
      return { session: s, response: t.descriptionPrompt, endSession: false };
    }
    return { session: s, response: t.controllerNoMatch, endSession: false };
  }
  s.payload.controllerOptions = options.slice(0, 8);
  s.state = "CONTROLLER_PICK";
  return { session: s, response: buildControllerPickMenu(s), endSession: false };
}
