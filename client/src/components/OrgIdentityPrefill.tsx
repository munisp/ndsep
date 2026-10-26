/**
 * OrgIdentityPrefill (Round-12, workstream 3)
 * ============================================
 * Shared organisation-identity lookup used to stop re-entering controller /
 * organisation identity across public complaints, hosting declarations,
 * cross-border declarations and DPCO onboarding.
 *
 * Type note: the `orgIdentity` router (server/routers/orgIdentity.ts) is
 * mounted in server/routers.ts, so the procedure is fully typed through
 * AppRouter. The server-side contract is OrgIdentityMatch below.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Building2, CheckCircle2, Loader2, Search } from "lucide-react";

/** Mirrors OrgIdentityMatch in server/routers/orgIdentity.ts. */
export interface OrgIdentity {
  found: boolean;
  source: "organizations" | "public_compliance_registry" | "dpco_organisations" | null;
  orgId: number | null;
  name: string | null;
  registrationRef: string | null;
  rcNumber: string | null;
  cacNumber: string | null;
  taxId: string | null;
  sector: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  dpcoLicenceNumber: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  organizations: "NDSEP organisations registry",
  public_compliance_registry: "NDPC public compliance registry",
  dpco_organisations: "NDPC DPCO registry",
};

export function OrgIdentityPrefill({
  onResolved,
  label = "Look up by registration reference",
  placeholder = "CAC RC/BN number, NDPC reference, or DPCO licence no.",
  idPrefix = "org-identity",
}: {
  /** Called once per successful, non-empty lookup with the resolved identity. */
  onResolved: (identity: OrgIdentity) => void;
  label?: string;
  placeholder?: string;
  idPrefix?: string;
}) {
  const [ref, setRef] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [resolved, setResolved] = useState<OrgIdentity | null>(null);

  const lookup = trpc.orgIdentity.lookupByRegistrationRef.useQuery(
    { registrationRef: submitted },
    { enabled: submitted.length >= 2, retry: false, refetchOnWindowFocus: false },
  );

  useEffect(() => {
    const data = lookup.data as OrgIdentity | undefined;
    if (!data) return;
    if (data.found) {
      setResolved(data);
      onResolved(data);
      toast.success(`Identity resolved: ${data.name ?? data.registrationRef}`);
    } else {
      setResolved(null);
      toast.info("No registry record matched that reference — enter the details manually.");
    }
    // onResolved is a per-render closure over the parent's setters; re-running
    // only when a new payload arrives is the intended behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup.data]);

  useEffect(() => {
    if (lookup.isError) {
      toast.error("Identity lookup failed — enter the details manually.");
    }
  }, [lookup.isError]);

  const runLookup = () => {
    const trimmed = ref.trim();
    if (trimmed.length < 2) {
      toast.error("Enter at least 2 characters of the registration reference");
      return;
    }
    setResolved(null);
    setSubmitted(trimmed);
    if (trimmed === submitted) lookup.refetch();
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <Label htmlFor={`${idPrefix}-ref`} className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Search className="h-3.5 w-3.5" /> {label}
      </Label>
      <div className="flex gap-2">
        <Input
          id={`${idPrefix}-ref`}
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runLookup();
            }
          }}
          placeholder={placeholder}
          className="font-mono text-sm"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={lookup.isFetching || ref.trim().length < 2}
          onClick={runLookup}
        >
          {lookup.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Look up"}
        </Button>
      </div>
      {resolved?.found && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-foreground font-medium flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5" /> {resolved.name}
              {resolved.source && (
                <Badge variant="outline" className="text-[10px]">{SOURCE_LABELS[resolved.source]}</Badge>
              )}
            </p>
            <p>
              {[resolved.registrationRef, resolved.sector, resolved.city ?? resolved.state, resolved.country]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="text-muted-foreground/70">The matching fields below were pre-filled — review before submitting.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default OrgIdentityPrefill;
