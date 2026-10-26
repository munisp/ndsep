/**
 * HostingVerificationBadge (Round-13 P0.2)
 * ===================================================================
 * Verdict chip + evidence popover for the OSIRIS-RECON hosting-declaration
 * verification (server/services/hostingVerification.ts). Mounted per
 * declaration row on the data-sovereignty dashboard.
 *
 * Verdicts: compliant (all declared hosts resolve into verified NG
 * prefixes/ASNs) | violation (positive foreign evidence) | unverified
 * (fail-closed default when recon evidence is missing). "Never verified"
 * renders as unverified-styled — absence of evidence is never compliance.
 *
 * NOTE: hostingVerificationRouter is mounted in server/routers.ts (Round-13
 * integration), so calls are fully typed. Queries degrade gracefully
 * (migration note / "never verified" states come back from the API).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";

const VERDICT_STYLES: Record<string, { label: string; className: string; Icon: any }> = {
  compliant: {
    label: "Verified in Nigeria",
    className: "bg-green-500/20 text-green-300 border-green-500/40",
    Icon: ShieldCheck,
  },
  violation: {
    label: "Foreign hosting detected",
    className: "bg-red-500/20 text-red-300 border-red-500/40",
    Icon: ShieldAlert,
  },
  unverified: {
    label: "Unverified",
    className: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
    Icon: ShieldQuestion,
  },
};

const HOST_VERDICT_STYLES: Record<string, string> = {
  in_nigeria: "bg-green-500/20 text-green-300 border-green-500/40",
  outside_nigeria: "bg-red-500/20 text-red-300 border-red-500/40",
  unverified: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
};

const hv = () => trpc.hostingVerification;

export function HostingVerificationBadge({
  declarationId,
  onChanged,
}: {
  declarationId: number;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const query = hv().declarationVerdict.useQuery({ declarationId }, { retry: 1 });
  const verifyNow = hv().verifyNow.useMutation({
    onSuccess: (res: any) => {
      toast.success(`Verification ${res.verdict}`);
      query.refetch();
      onChanged?.();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const run = query.data?.run;
  const hosts: any[] = query.data?.hosts ?? [];
  const note = query.data?.note;
  const verdict: string = run?.verdict ?? "unverified";
  const style = VERDICT_STYLES[verdict] ?? VERDICT_STYLES.unverified;
  const humanReview = (run?.evidence as any)?.human_review;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex" title="Hosting verification evidence">
          <Badge variant="outline" className={style.className}>
            <style.Icon className="h-3 w-3 mr-1" />
            {run ? style.label : note === "never verified" ? "Never verified" : style.label}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[28rem] max-h-[24rem] overflow-y-auto" align="start">
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <div className="font-medium flex items-center gap-2">
              <style.Icon className="h-4 w-4" /> {style.label}
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={verifyNow.isPending}
              onClick={() => verifyNow.mutate({ declarationId })}
            >
              {verifyNow.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Verify now"}
            </Button>
          </div>

          {run && (
            <p className="text-xs text-muted-foreground">
              Checked {String(run.checked_at).slice(0, 19).replace("T", " ")} by {run.checked_by} (
              {run.trigger}) — {run.host_count} host(s): {run.in_nigeria_count} NG,{" "}
              {run.outside_nigeria_count} foreign, {run.unverified_count} unverified.
            </p>
          )}
          {note && <p className="text-xs text-yellow-400">{note}</p>}
          {humanReview && (
            <p className="text-xs text-muted-foreground">
              Human review: {humanReview.action} by {humanReview.actor}
              {humanReview.notes ? ` — ${humanReview.notes}` : ""}
            </p>
          )}

          {hosts.length > 0 && (
            <div className="space-y-2">
              {hosts.map((h: any) => (
                <div key={h.id} className="border border-border rounded p-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs break-all">{h.host}</span>
                    <Badge variant="outline" className={HOST_VERDICT_STYLES[h.verdict] ?? ""}>
                      {String(h.verdict).replaceAll("_", " ")}
                    </Badge>
                  </div>
                  {(h.resolved_ips ?? []).length > 0 && (
                    <p className="text-xs text-muted-foreground font-mono">
                      → {(h.resolved_ips as string[]).join(", ")}
                    </p>
                  )}
                  {(h.evidence?.ips ?? []).map((ip: any) => (
                    <p key={ip.ip} className="text-xs text-muted-foreground font-mono">
                      {ip.ip}: {ip.matched_prefix ? `prefix ${ip.matched_prefix}` : "no NG prefix"}
                      {ip.asn != null ? ` · AS${ip.asn}${ip.asn_provider ? ` (${ip.asn_provider})` : ""}` : ""}
                      {ip.country ? ` · ${ip.country}` : ""}
                      {ip.org ? ` · ${ip.org}` : ""}
                    </p>
                  ))}
                  {h.evidence?.cert && (
                    <p className="text-xs text-muted-foreground">
                      TLS: {h.evidence.cert.expired ? "EXPIRED" : `expires ${String(h.evidence.cert.valid_to ?? "").slice(0, 10)}`}
                      {h.evidence.cert.hostname_match === false ? " · hostname mismatch" : ""}
                      {` · ${h.evidence.cert.source}`}
                    </p>
                  )}
                  {(h.evidence?.notes ?? []).map((n: string) => (
                    <p key={n} className="text-xs text-yellow-400/80">{n}</p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
