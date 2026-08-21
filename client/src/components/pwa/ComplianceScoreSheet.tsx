/**
 * ComplianceScoreSheet
 *
 * A bottom-sheet that explains exactly how the DPCO compliance score
 * is calculated and what actions will improve it.
 * Triggered by tapping the compliance ring label.
 */
import { useEffect } from "react";
import { X, TrendingUp, Users, BookOpen, ClipboardCheck, AlertTriangle, CheckCircle2, Info } from "lucide-react";

interface ScoreBreakdown {
  activeClients: number;
  trainingSessions: number;
  pendingCars: number;
  overdueInvoices: number;
  score: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  breakdown: ScoreBreakdown;
}

const MAX = {
  clientBonus: 20,
  trainingBonus: 15,
  penaltyDeduction: 20,
};

function ScoreRow({
  icon: Icon,
  label,
  value,
  contribution,
  type,
  tip,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  contribution: number;
  type: "positive" | "negative" | "neutral";
  tip: string;
}) {
  const color = type === "positive" ? "text-emerald-400" : type === "negative" ? "text-rose-400" : "text-muted-foreground";
  const bg = type === "positive" ? "bg-emerald-500/10" : type === "negative" ? "bg-rose-500/10" : "bg-muted/30";
  const sign = type === "positive" ? "+" : type === "negative" ? "−" : "";

  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center flex-shrink-0`}>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-white">{label}</p>
          <span className={`text-sm font-black ${color}`}>{sign}{Math.abs(contribution)} pts</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">{tip}</p>
        <div className="mt-1.5 h-1 rounded-full bg-muted">
          <div
            className="h-1 rounded-full"
            style={{
              width: `${Math.min(100, (Math.abs(contribution) / 20) * 100)}%`,
              background: type === "positive" ? "#10b981" : type === "negative" ? "#f43f5e" : "#64748b",
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function ComplianceScoreSheet({ open, onClose, breakdown }: Props) {
  const { activeClients, trainingSessions, pendingCars, overdueInvoices, score } = breakdown;

  const clientBonus = Math.min(activeClients * 2, MAX.clientBonus);
  const trainingBonus = Math.min(trainingSessions * 3, MAX.trainingBonus);
  const penaltyDeduction = Math.min(pendingCars * 5, MAX.penaltyDeduction);
  const overdueDeduction = Math.min(overdueInvoices * 3, 15);
  const base = 50;

  const color = score >= 75 ? "#10b981" : score >= 55 ? "#f59e0b" : "#f43f5e";
  const label = score >= 75 ? "Strong" : score >= 55 ? "Moderate" : "Needs Improvement";

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    if (open) window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 max-w-lg mx-auto bg-card border border-border/60 rounded-t-3xl shadow-2xl"
        style={{ maxHeight: "88vh", overflowY: "auto" }}>

        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-2 pb-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Info className="h-4 w-4 text-cyan-400" />
            <p className="text-sm font-bold text-white">Compliance Score Breakdown</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-card transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Score summary */}
          <div className="bg-muted rounded-2xl p-4 flex items-center gap-4">
            <div className="w-16 h-16 rounded-full border-4 flex items-center justify-center flex-shrink-0"
              style={{ borderColor: color }}>
              <span className="text-xl font-black" style={{ color }}>{score}</span>
            </div>
            <div>
              <p className="text-base font-bold text-white">{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Your DPCO compliance health score</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Score = {base} (base) {clientBonus > 0 ? `+ ${clientBonus} (clients)` : ""}{trainingBonus > 0 ? ` + ${trainingBonus} (training)` : ""}{penaltyDeduction > 0 ? ` − ${penaltyDeduction} (pending CARs)` : ""}{overdueDeduction > 0 ? ` − ${overdueDeduction} (overdue invoices)` : ""}
              </p>
            </div>
          </div>

          {/* Formula explanation */}
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">How It's Calculated</p>
            <div className="bg-muted/60 rounded-xl px-4 py-3 text-xs text-foreground font-mono leading-relaxed">
              score = 50 (base)<br />
              &nbsp;&nbsp;+ min(activeClients × 2, 20)<br />
              &nbsp;&nbsp;+ min(trainingSessions × 3, 15)<br />
              &nbsp;&nbsp;− min(pendingCARs × 5, 20)<br />
              &nbsp;&nbsp;− min(overdueInvoices × 3, 15)<br />
              &nbsp;&nbsp;clamped to [0, 100]
            </div>
          </div>

          {/* Breakdown rows */}
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Your Factors</p>
            <ScoreRow
              icon={CheckCircle2}
              label="Base Score"
              value={base}
              contribution={base}
              type="neutral"
              tip="Every DPCO starts with a base score of 50 points."
            />
            <ScoreRow
              icon={Users}
              label={`Active Clients (${activeClients})`}
              value={activeClients}
              contribution={clientBonus}
              type="positive"
              tip={`+2 pts per active client, capped at +${MAX.clientBonus}. You have ${activeClients} active client${activeClients !== 1 ? "s" : ""}.`}
            />
            <ScoreRow
              icon={BookOpen}
              label={`Training Sessions (${trainingSessions})`}
              value={trainingSessions}
              contribution={trainingBonus}
              type="positive"
              tip={`+3 pts per completed training session, capped at +${MAX.trainingBonus}. You have ${trainingSessions} session${trainingSessions !== 1 ? "s" : ""}.`}
            />
            <ScoreRow
              icon={ClipboardCheck}
              label={`Pending CARs (${pendingCars})`}
              value={pendingCars}
              contribution={penaltyDeduction}
              type="negative"
              tip={`−5 pts per pending Compliance Action Report, capped at −${MAX.penaltyDeduction}. Resolve CARs promptly to recover points.`}
            />
            <ScoreRow
              icon={AlertTriangle}
              label={`Overdue Invoices (${overdueInvoices})`}
              value={overdueInvoices}
              contribution={overdueDeduction}
              type="negative"
              tip="−3 pts per overdue invoice, capped at −15. Pay or follow up on overdue invoices to recover points."
            />
          </div>

          {/* Improvement tips */}
          <div className="bg-cyan-950/30 border border-cyan-500/20 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-cyan-400" />
              <p className="text-xs font-bold text-cyan-300">How to Improve Your Score</p>
            </div>
            <ul className="space-y-1.5">
              {[
                activeClients < 10 && "Onboard more clients — each active client adds 2 points (up to +20).",
                trainingSessions < 5 && "Complete more staff training sessions — each adds 3 points (up to +15).",
                pendingCars > 0 && `Resolve your ${pendingCars} pending CAR${pendingCars > 1 ? "s" : ""} — each costs you 5 points.`,
                overdueInvoices > 0 && `Follow up on your ${overdueInvoices} overdue invoice${overdueInvoices > 1 ? "s" : ""} — each costs 3 points.`,
              ].filter(Boolean).map((tip, i) => (
                <li key={i} className="text-[11px] text-cyan-300/80 flex items-start gap-1.5">
                  <span className="text-cyan-500 mt-0.5">•</span> {tip}
                </li>
              ))}
              {score >= 90 && (
                <li className="text-[11px] text-emerald-300/80 flex items-start gap-1.5">
                  <span className="text-emerald-500 mt-0.5">✓</span> Excellent! Your score is near maximum. Maintain your current pace.
                </li>
              )}
            </ul>
          </div>

          <div className="pb-4" />
        </div>
      </div>
    </>
  );
}
