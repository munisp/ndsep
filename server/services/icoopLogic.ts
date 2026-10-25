/**
 * International cooperation — pure logic (no I/O).
 * Request lifecycle state machine, statutory-deadline tracking and reference
 * formatting. Used by server/routers/internationalCooperation.ts.
 */

export const ICOOP_STATUSES = ["draft", "sent", "acknowledged", "fulfilled", "declined", "withdrawn"] as const;
export type IcoopStatus = (typeof ICOOP_STATUSES)[number];

/** Allowed lifecycle transitions (one-way after terminal states). */
export const ICOOP_TRANSITIONS: Record<IcoopStatus, IcoopStatus[]> = {
  draft: ["sent", "withdrawn"],
  sent: ["acknowledged", "declined", "withdrawn"],
  acknowledged: ["fulfilled", "declined"],
  fulfilled: [],
  declined: [],
  withdrawn: [],
};

export function canTransitionRequest(from: string, to: string): boolean {
  return (ICOOP_TRANSITIONS[from as IcoopStatus] ?? []).includes(to as IcoopStatus);
}

/** Timestamp column stamped on each transition (mirrors complaint status
 *  timestamp conventions). */
export function statusTimestampColumn(status: IcoopStatus): string | null {
  switch (status) {
    case "sent": return "sent_at";
    case "acknowledged": return "acknowledged_at";
    case "fulfilled": return "fulfilled_at";
    case "declined": return "declined_at";
    default: return null;
  }
}

export type DeadlineState = "no_deadline" | "on_track" | "due_soon" | "overdue" | "met";

export function deadlineState(
  req: { direction: string; statutory_deadline: Date | string | null; status: string; fulfilled_at?: Date | string | null },
  today: Date = new Date(),
): DeadlineState {
  if (req.direction !== "inbound" || !req.statutory_deadline) return "no_deadline";
  const due = new Date(req.statutory_deadline).getTime();
  if (["fulfilled", "declined"].includes(req.status)) {
    const done = req.fulfilled_at ? new Date(req.fulfilled_at).getTime() : due;
    return done <= due ? "met" : "overdue";
  }
  const day = 24 * 3600 * 1000;
  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())).getTime();
  if (due < t) return "overdue";
  if (due - t <= 7 * day) return "due_soon";
  return "on_track";
}

export function formatRequestRef(year: number, seq: number): string {
  return `ICMA-${year}-${String(seq).padStart(5, "0")}`;
}

export function formatInstrumentRef(year: number, seq: number): string {
  return `MOU-${year}-${String(seq).padStart(3, "0")}`;
}
