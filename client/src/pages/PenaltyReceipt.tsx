import { useParams, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Printer, CheckCircle, ArrowLeft, ExternalLink, Shield, Loader2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

function qrDataUrl(text: string): string {
  // Simple QR placeholder — in production use a QR library
  return `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(text)}`;
}

export default function PenaltyReceipt() {
  const { penaltyId } = useParams<{ penaltyId: string }>();
  const id = parseInt(penaltyId ?? "0", 10);

  const { data: receipt, isLoading, error } = trpc.financial.receipt.useQuery(
    { penaltyId: id },
    { enabled: id > 0 }
  );

  if (isLoading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-green-500 mx-auto mb-4" />
          <p className="text-muted-foreground">Loading receipt…</p>
        </div>
      </div>
    );
  }

  if (error || !receipt) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">Receipt Not Found</h2>
          <p className="text-muted-foreground mb-6">Penalty #{id} does not exist or has no payment record.</p>
          <Link href="/portal">
            <Button variant="outline" className="border-border text-muted-foreground">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Portal
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const isPaid = receipt.paymentStatus === "completed";
  const verifyUrl = `${window.location.origin}/verify/${receipt.tigerBeetleTransferId ?? id}`;
  const formattedAmount = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: receipt.currency ?? "USD",
    minimumFractionDigits: 2,
  }).format(Number(receipt.amount ?? 0));

  return (
    <div className="py-6 px-4">
      <div className="max-w-2xl mx-auto">
        <Breadcrumbs items={[{ label: "Enforcement", href: "/enforcement-cases" }, { label: `Penalty Receipt #${id}` }]} />
        {/* Header actions */}
        <div className="flex items-center justify-between mb-8 print:hidden">
          <Link href="/portal">
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Portal
            </Button>
          </Link>
          <Button
            onClick={() => window.print()}
            className="bg-green-600 hover:bg-green-700 text-foreground"
          >
            <Printer className="w-4 h-4 mr-2" /> Print Receipt
          </Button>
        </div>

        {/* Receipt card */}
        <div className="bg-background border border-border rounded-2xl overflow-hidden print:border-border print:bg-white print:text-black">
          {/* Header */}
          <div className="bg-gradient-to-r from-green-900 to-emerald-900 px-8 py-6 print:bg-green-700">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <Shield className="w-6 h-6 text-green-300" />
                  <span className="text-green-300 text-sm font-medium tracking-widest uppercase">NDSEP</span>
                </div>
                <h1 className="text-2xl font-bold text-foreground">Payment Receipt</h1>
                <p className="text-green-200 text-sm mt-1">National Data Sovereignty Enforcement Platform</p>
              </div>
              <div className="text-right">
                <Badge
                  className={isPaid
                    ? "bg-green-500/20 text-green-300 border-green-500/40 text-sm px-3 py-1"
                    : "bg-yellow-500/20 text-yellow-300 border-yellow-500/40 text-sm px-3 py-1"
                  }
                >
                  {isPaid ? (
                    <><CheckCircle className="w-3 h-3 mr-1 inline" /> PAID</>
                  ) : (
                    receipt.paymentStatus?.toUpperCase() ?? "PENDING"
                  )}
                </Badge>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="px-8 py-6 space-y-6">
            {/* Organisation details */}
            <div>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Organisation</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Name</p>
                  <p className="text-foreground font-medium">{receipt.orgName ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Sector</p>
                  <p className="text-foreground font-medium capitalize">{receipt.orgSector ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Country</p>
                  <p className="text-foreground font-medium">{receipt.orgCountry ?? "—"}</p>
                </div>
              </div>
            </div>

            <div className="border-t border-border" />

            {/* Penalty details */}
            <div>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Penalty Details</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Penalty ID</p>
                  <p className="text-foreground font-mono font-medium">#{receipt.id}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Amount</p>
                  <p className="text-2xl font-bold text-green-400">{formattedAmount}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="text-foreground">{receipt.description ?? "Compliance penalty"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Due Date</p>
                  <p className="text-foreground">{receipt.dueDate ? new Date(receipt.dueDate).toLocaleDateString() : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Paid At</p>
                  <p className="text-foreground">{receipt.paidAt ? new Date(receipt.paidAt).toLocaleString() : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Issued At</p>
                  <p className="text-foreground">{receipt.createdAt ? new Date(receipt.createdAt).toLocaleString() : "—"}</p>
                </div>
              </div>
            </div>

            <div className="border-t border-border" />

            {/* Transaction references */}
            <div>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Transaction References</h2>
              <div className="space-y-2">
                {receipt.tigerBeetleTransferId && (
                  <div className="flex items-center justify-between bg-card/50 rounded-lg px-4 py-2">
                    <span className="text-xs text-muted-foreground">TigerBeetle Transfer ID</span>
                    <span className="text-foreground font-mono text-sm">{receipt.tigerBeetleTransferId}</span>
                  </div>
                )}
                {receipt.mojaloopTransferId && (
                  <div className="flex items-center justify-between bg-card/50 rounded-lg px-4 py-2">
                    <span className="text-xs text-muted-foreground">Mojaloop Transfer ID</span>
                    <span className="text-foreground font-mono text-sm">{receipt.mojaloopTransferId}</span>
                  </div>
                )}
                {!receipt.tigerBeetleTransferId && !receipt.mojaloopTransferId && (
                  <p className="text-muted-foreground text-sm italic">Transaction references will appear once payment is processed.</p>
                )}
              </div>
            </div>

            <div className="border-t border-border" />

            {/* QR + verification */}
            <div className="flex items-start gap-6">
              <div className="flex-shrink-0">
                <img
                  src={qrDataUrl(verifyUrl)}
                  alt="Verification QR Code"
                  className="w-24 h-24 rounded-lg border border-border"
                />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Verification</p>
                <p className="text-sm text-muted-foreground mb-2">
                  Scan the QR code or visit the link below to verify this payment record on the NDSEP public registry.
                </p>
                <a
                  href={verifyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-400 text-sm flex items-center gap-1 hover:underline"
                >
                  {verifyUrl} <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="bg-card/50 px-8 py-4 text-center print:bg-muted">
            <p className="text-xs text-muted-foreground">
              This is an official NDSEP enforcement receipt. For disputes, visit{" "}
              <Link href="/portal" className="text-green-400 hover:underline">the Organisation Portal</Link>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
