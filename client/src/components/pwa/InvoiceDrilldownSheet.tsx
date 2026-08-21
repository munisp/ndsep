/**
 * InvoiceDrilldownSheet
 *
 * A bottom-sheet modal that slides up when an invoice row is tapped.
 * Shows full invoice details, line items, payment history, and a
 * one-tap "Send Reminder" button.
 */
import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  X, Download, Mail, Clock, CheckCircle2, AlertTriangle,
  FileText, CreditCard, ChevronRight, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface InvoiceRow {
  id: number;
  invoice_number: string;
  client_name: string;
  service_type: string;
  status: string;
  total_amount: number | string;
  dpco_net_amount?: number | string;
  platform_fee_amount?: number | string;
  vat_amount?: number | string;
  due_date: string;
  issue_date?: string;
  created_at?: string;
  email_sent_at?: string | null;
  client_email?: string;
  description?: string;
  dpco_org_id?: number;
}

interface Props {
  invoice: InvoiceRow | null;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number | string | undefined | null) {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(v);
}
function fmtDate(d: string | number | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}
function statusColor(s: string) {
  if (s === "paid") return "bg-emerald-500/20 text-emerald-300";
  if (s === "overdue") return "bg-rose-500/20 text-rose-300";
  if (s === "sent") return "bg-cyan-500/20 text-cyan-300";
  if (s === "draft") return "bg-muted text-foreground";
  return "bg-amber-500/20 text-amber-300";
}

// ─── Component ────────────────────────────────────────────────────────────────
export function InvoiceDrilldownSheet({ invoice, onClose }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Fetch payment history for this invoice
  const paymentsQuery = trpc.billing.listInvoices.useQuery(
    { dpcoOrgId: invoice?.dpco_org_id ?? 0, limit: 50 },
    { enabled: !!invoice }
  );

  const sendEmailMutation = trpc.billing.sendInvoiceEmail.useMutation({
    onSuccess: () => toast.success("Reminder sent successfully"),
    onError: (e) => toast.error(`Failed to send: ${(e instanceof Error ? e.message : String(e))}`),
  });

  // Close on backdrop click
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (invoice) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [invoice]);

  if (!invoice) return null;

  const payments = (paymentsQuery.data?.rows ?? []).filter(
    (r: any) => r.id === invoice.id
  );

  // Line items derived from invoice fields
  const lineItems = [
    { label: "Service Fee", amount: Number(invoice.total_amount) - Number(invoice.vat_amount ?? 0) },
    { label: "VAT (7.5%)", amount: Number(invoice.vat_amount ?? 0) },
  ];

  function handleSendReminder() {
    if (!invoice) return;
    sendEmailMutation.mutate({
      invoiceId: invoice.id,
      recipientEmail: invoice.client_email ?? "",
      message: `This is a reminder that invoice ${invoice.invoice_number} is ${invoice.status === "overdue" ? "OVERDUE" : "due"} for payment of ${fmt(invoice.total_amount)}.`,
    });
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 z-50 max-w-lg mx-auto bg-card border border-border/60 rounded-t-3xl shadow-2xl"
        style={{ maxHeight: "90vh", overflowY: "auto" }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-2 pb-4 border-b border-border">
          <div>
            <p className="text-base font-bold text-white">{invoice.invoice_number}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{invoice.client_name}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusColor(invoice.status)}`}>
              {invoice.status}
            </span>
            <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-card transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Amount summary */}
          <div className="bg-muted rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-muted-foreground">Total Amount</span>
              <span className="text-2xl font-black text-white">{fmt(invoice.total_amount)}</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">DPCO Net Earnings</span>
                <span className="text-emerald-400 font-semibold">{fmt(invoice.dpco_net_amount)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Platform Fee</span>
                <span className="text-violet-400 font-semibold">{fmt(invoice.platform_fee_amount)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">VAT (7.5%)</span>
                <span className="text-foreground font-semibold">{fmt(invoice.vat_amount)}</span>
              </div>
            </div>
          </div>

          {/* Invoice details */}
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Invoice Details</p>
            <div className="space-y-2">
              {[
                { label: "Service Type", value: (invoice.service_type ?? "").replace(/_/g, " ") },
                { label: "Issue Date", value: fmtDate(invoice.issue_date ?? invoice.created_at) },
                { label: "Due Date", value: fmtDate(invoice.due_date) },
                { label: "Client Email", value: invoice.client_email ?? "—" },
                { label: "Last Emailed", value: invoice.email_sent_at ? fmtDate(invoice.email_sent_at) : "Not sent" },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="text-xs text-foreground font-medium capitalize">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Line items */}
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Line Items</p>
            <div className="bg-muted/60 rounded-xl overflow-hidden">
              {lineItems.map((item, i) => (
                <div key={i} className={`flex justify-between px-3 py-2 text-xs ${i < lineItems.length - 1 ? "border-b border-border/40" : ""}`}>
                  <span className="text-foreground">{item.label}</span>
                  <span className="text-white font-semibold">{fmt(item.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between px-3 py-2 text-xs bg-muted/40 font-bold">
                <span className="text-foreground">Total</span>
                <span className="text-white">{fmt(invoice.total_amount)}</span>
              </div>
            </div>
          </div>

          {/* Description */}
          {invoice.description && (
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Description</p>
              <p className="text-xs text-foreground leading-relaxed">{invoice.description}</p>
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="border-border text-foreground hover:text-white gap-1.5 text-xs"
              onClick={() => window.open(`/api/invoices/${invoice.id}/invoice.pdf`, "_blank")}
            >
              <Download className="h-3.5 w-3.5" />
              Download PDF
            </Button>
            <Button
              size="sm"
              className="bg-cyan-600 hover:bg-cyan-500 text-white gap-1.5 text-xs"
              onClick={handleSendReminder}
              disabled={sendEmailMutation.isPending}
            >
              <Mail className="h-3.5 w-3.5" />
              {sendEmailMutation.isPending ? "Sending…" : "Send Reminder"}
            </Button>
          </div>

          {/* Status-specific CTA */}
          {invoice.status === "overdue" && (
            <div className="bg-rose-950/30 border border-rose-500/30 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-rose-300">Invoice Overdue</p>
                <p className="text-[11px] text-rose-400/70 mt-0.5">
                  This invoice was due on {fmtDate(invoice.due_date)}. Send a reminder or escalate to enforcement.
                </p>
              </div>
            </div>
          )}
          {invoice.status === "paid" && (
            <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-3 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />
              <p className="text-xs text-emerald-300 font-semibold">Payment received — invoice settled</p>
            </div>
          )}

          <div className="pb-4" />
        </div>
      </div>
    </>
  );
}
