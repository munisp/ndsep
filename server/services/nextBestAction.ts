/**
 * Next-best-action service (round 12, wave 7 — roadmap §6)
 * ========================================================
 * Pure, deterministic state-machine guidance: given an entity type and its
 * current state fields, return the single most useful next action with a
 * label, a mutationHint (names the tRPC mutation the officer would run) and
 * a short rationale. Returns null when the entity is in a terminal state
 * with no further action.
 *
 * Pure function — no I/O, fully unit-testable. The router wrapper
 * (server/routers/nextBestAction.ts) loads the entity state from the DB and
 * mints a prediction through the Wave-1 feedback loop; the client logs
 * accept (clicked) vs ignore (dismissed) under surface 'next_best_action'.
 */

export type NbaEntityType = "complaint" | "settlement" | "publication" | "finding";

export interface NextBestAction {
  /** Stable machine-readable action key. */
  action: string;
  /** Short human label for the CTA button. */
  label: string;
  /** tRPC mutation the officer would invoke, e.g. "publicComplaints.updateStatus". */
  mutationHint: string;
  /** Why this action, one sentence. */
  rationale: string;
}

export interface NbaState {
  /** Primary status / stage field. */
  status?: string;
  /** complaint: has an assigned officer; publication: correction pending. */
  assigned?: boolean;
  correctionPending?: boolean;
}

// ─── Complaint (publicComplaints status machine) ─────────────────────────────

function complaintNba(state: NbaState): NextBestAction | null {
  switch (state.status) {
    case "received":
      return {
        action: "acknowledge",
        label: "Acknowledge complaint",
        mutationHint: "publicComplaints.updateStatus { status: 'acknowledged' }",
        rationale: "The 72-hour acknowledgement SLA is running; acknowledge first.",
      };
    case "acknowledged":
      return state.assigned
        ? {
            action: "start_review",
            label: "Move to under review",
            mutationHint: "publicComplaints.updateStatus { status: 'under_review' }",
            rationale: "An officer is assigned — begin the substantive review.",
          }
        : {
            action: "assign_officer",
            label: "Assign an officer",
            mutationHint: "publicComplaints.assign",
            rationale: "Acknowledged complaints need an accountable officer before review.",
          };
    case "under_review":
      return {
        action: "link_or_resolve",
        label: "Link enforcement case or resolve",
        mutationHint: "publicComplaints.linkToCase / updateStatus { status: 'resolved' }",
        rationale: "Reviews conclude by linking an enforcement case or by resolving with notes.",
      };
    case "linked_to_case":
      return {
        action: "resolve",
        label: "Resolve from case outcome",
        mutationHint: "publicComplaints.updateStatus { status: 'resolved' }",
        rationale: "Once the linked case concludes, record the resolution on the complaint.",
      };
    case "resolved":
      return {
        action: "close",
        label: "Close complaint",
        mutationHint: "publicComplaints.updateStatus { status: 'closed' }",
        rationale: "Resolved complaints should be closed to keep the queue accurate.",
      };
    default:
      return null; // closed / unknown
  }
}

// ─── Settlement (settlementWorkflow lifecycle) ───────────────────────────────

function settlementNba(state: NbaState): NextBestAction | null {
  switch (state.status) {
    case "proposal":
      return {
        action: "await_or_counter",
        label: "Respond to proposal",
        mutationHint: "settlementWorkflow.acceptTerms / counterPropose",
        rationale: "A proposal is live — accept the terms or issue a counter-proposal.",
      };
    case "counter":
      return {
        action: "decide_counter",
        label: "Decide on counter-proposal",
        mutationHint: "settlementWorkflow.acceptTerms / counterPropose",
        rationale: "A counter-proposal is on the table — accept it or counter again.",
      };
    case "agreement":
      return {
        action: "submit_for_approval",
        label: "Submit for approval",
        mutationHint: "settlementWorkflow.submitForApproval",
        rationale: "Terms are agreed — the settlement needs formal approval before activation.",
      };
    case "approval":
      return {
        action: "approve_or_reject",
        label: "Approve or reject",
        mutationHint: "settlementWorkflow.approveSettlement / rejectSettlement",
        rationale: "The settlement awaits an approval decision; rejection voids it.",
      };
    case "active":
      return {
        action: "record_payment",
        label: "Record instalment payment",
        mutationHint: "settlementWorkflow.recordInstalmentPayment",
        rationale: "Active settlements accrue instalments — record payments as they arrive.",
      };
    case "defaulted":
      return {
        action: "waive_or_escalate",
        label: "Request waiver or escalate",
        mutationHint: "settlementWorkflow.requestWaiver",
        rationale: "The settlement defaulted — a dual-control waiver or enforcement escalation is required.",
      };
    default:
      return null; // fulfilled / void
  }
}

// ─── Publication (publicationWorkbench stage machine) ────────────────────────

function publicationNba(state: NbaState): NextBestAction | null {
  if ((state.status === "published" || state.status === "corrected") && state.correctionPending) {
    return {
      action: "process_correction",
      label: "Process pending correction",
      mutationHint: "publicationWorkbench.startCorrection",
      rationale: "A correction is pending on a published document — start the correction redaction round.",
    };
  }
  switch (state.status) {
    case "draft":
      return {
        action: "submit_redaction",
        label: "Submit for redaction",
        mutationHint: "publicationWorkbench.submitForRedaction",
        rationale: "Drafts enter the redaction stage before any approval can be collected.",
      };
    case "redaction":
      return {
        action: "complete_redaction",
        label: "Complete redaction sign-offs",
        mutationHint: "publicationWorkbench.submitForApproval",
        rationale: "All redaction tasks must be signed off before the document can enter approval.",
      };
    case "approval":
      return {
        action: "publish",
        label: "Collect approvals and publish",
        mutationHint: "publicationWorkbench.publish",
        rationale: "With two distinct approvals in the current round the document can be published.",
      };
    default:
      return null; // published / corrected (no pending correction)
  }
}

// ─── Finding (transfer_findings status machine) ──────────────────────────────

function findingNba(state: NbaState): NextBestAction | null {
  switch (state.status) {
    case "open":
      return {
        action: "start_investigation",
        label: "Start investigation",
        mutationHint: "crossBorderDeclarations.updateFindingStatus { status: 'under_investigation' }",
        rationale: "Open findings should be taken under investigation or referred.",
      };
    case "referred":
      return {
        action: "await_enforcement",
        label: "Track enforcement referral",
        mutationHint: "crossBorderDeclarations.listFindings",
        rationale: "The finding is with enforcement — monitor the referral rather than duplicating work.",
      };
    case "under_investigation":
      return {
        action: "resolve_or_dismiss",
        label: "Resolve or dismiss",
        mutationHint: "crossBorderDeclarations.updateFindingStatus { status: 'resolved' | 'dismissed' }",
        rationale: "Investigations conclude by resolving (substantiated) or dismissing (unsubstantiated).",
      };
    default:
      return null; // resolved / dismissed
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function nextBestAction(entityType: NbaEntityType, state: NbaState): NextBestAction | null {
  switch (entityType) {
    case "complaint":
      return complaintNba(state);
    case "settlement":
      return settlementNba(state);
    case "publication":
      return publicationNba(state);
    case "finding":
      return findingNba(state);
    default:
      return null;
  }
}

export const NBA_SURFACE = "next_best_action";
export const NBA_MODEL_VERSION = "rules:v1";
