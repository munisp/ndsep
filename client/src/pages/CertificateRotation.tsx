import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ShieldCheck, RotateCcw, AlertTriangle, CheckCircle2, Clock, Hash, Building2, Calendar } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
export default function CertificateRotation() {
  const [showConfirm, setShowConfirm] = useState(false);

  const { data: certInfo, isLoading, refetch } = trpc.certRotation.getCertInfo.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const rotateMutation = trpc.certRotation.rotateCert.useMutation({
    onSuccess: (data) => {
      toast.success(`Certificate rotated successfully. New serial: ${data.serialNumber}`);
      setShowConfirm(false);
      refetch();
    },
    onError: (err) => {
      toast.error(`Rotation failed: ${err.message}`);
      setShowConfirm(false);
    },
  });

  const validTo = certInfo ? new Date(certInfo.validTo) : null;
  const validFrom = certInfo ? new Date(certInfo.validFrom) : null;
  const now = new Date();
  const daysRemaining = validTo ? Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
  const isExpiringSoon = daysRemaining !== null && daysRemaining < 90;
  const isExpired = daysRemaining !== null && daysRemaining <= 0;

  return (
    <div className="p-6 max-w-3xl">
      <Breadcrumbs items={[{ label: "Security", href: "/security-audit" }, { label: "Certificate Rotation" }]} className="mb-4" />
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">PDF Signing Certificate</h1>
          <p className="text-sm text-muted-foreground">
            Manage the PKCS#7 signing certificate used to digitally sign NDPA Annual Audit Return PDFs
          </p>
        </div>
      </div>

      {/* Certificate Details Card */}
      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">Current Certificate</h2>
          {isLoading ? (
            <Badge className="bg-muted/30 text-muted-foreground border-border">Loading...</Badge>
          ) : isExpired ? (
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Expired</Badge>
          ) : isExpiringSoon ? (
            <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Expiring Soon</Badge>
          ) : (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Valid</Badge>
          )}
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading certificate information...</div>
        ) : certInfo ? (
          <div className="grid grid-cols-1 gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Subject (CN)</div>
                  <div className="text-sm font-medium text-foreground">{certInfo.subject}</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Building2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Issuer</div>
                  <div className="text-sm font-medium text-foreground">{certInfo.issuer}</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="flex items-start gap-3">
                <Hash className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Serial Number</div>
                  <div className="text-sm font-mono text-foreground">{certInfo.serialNumber}</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Valid From</div>
                  <div className="text-sm text-foreground">
                    {validFrom?.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Clock className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Valid Until</div>
                  <div className={`text-sm ${isExpired ? "text-red-400" : isExpiringSoon ? "text-yellow-400" : "text-foreground"}`}>
                    {validTo?.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                    {daysRemaining !== null && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({isExpired ? "expired" : `${daysRemaining}d remaining`})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Technical Details */}
            <div className="bg-muted/20 rounded-lg p-4 mt-2">
              <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Technical Details</div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono text-muted-foreground">
                <div>Algorithm: RSA-2048 / SHA-256</div>
                <div>Sub-filter: adbe.pkcs7.detached</div>
                <div>Filter: Adobe.PPKLite</div>
                <div>Standard: PDF 1.7 / ISO 32000-1</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-red-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Certificate not found — PDFs will be served unsigned.
          </div>
        )}
      </div>

      {/* Rotation Section */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-semibold text-foreground mb-2">Rotate Certificate</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Generates a new RSA-2048 key pair and self-signed certificate, replacing the current signing credentials.
          All future Audit Return PDFs will be signed with the new certificate. Previously issued PDFs remain valid
          under their original certificate.
        </p>
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
          <div className="text-xs text-yellow-300">
            <strong>Admin action:</strong> Certificate rotation is logged to the audit trail. Distribute the new
            certificate fingerprint to NDPC and any relying parties that verify PDF signatures.
          </div>
        </div>
        <Button
          onClick={() => setShowConfirm(true)}
          className="bg-primary hover:bg-primary/90"
          disabled={rotateMutation.isPending}
        >
          <RotateCcw className="w-4 h-4 mr-2" />
          Rotate Certificate
        </Button>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="bg-background border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-primary" />
              Confirm Certificate Rotation
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This will generate a new RSA-2048 signing certificate and immediately replace the current one.
              The rotation will be recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <div className="bg-muted/20 rounded-lg p-3 text-sm text-muted-foreground space-y-1">
              <div className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-green-400" /> New RSA-2048 key pair generated</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-green-400" /> Self-signed cert valid for 10 years</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-green-400" /> Rotation logged to audit trail</div>
              <div className="flex items-center gap-2"><AlertTriangle className="w-3 h-3 text-yellow-400" /> Distribute new cert fingerprint to NDPC</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={rotateMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => rotateMutation.mutate()}
              disabled={rotateMutation.isPending}
              className="bg-primary hover:bg-primary/90"
            >
              {rotateMutation.isPending ? "Rotating..." : "Confirm Rotation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
