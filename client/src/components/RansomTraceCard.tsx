/**
 * RansomTraceCard (round 13 W3)
 * =============================
 * Crypto wallet tracing for ransomware / breach enforcement, backed by the
 * ransomTrace router (server/routers/ransomTrace.ts → OSIRIS
 * /api/osint/crypto proxying blockstream/Blockscout-style explorers).
 *
 * - Address input + trace; when `caseId` is provided the trace is attached
 *   to the enforcement case (case timeline) automatically.
 * - OFAC-sanctioned wallets render a prominent badge; the server also writes
 *   a hash-chained audit_ledger entry.
 * - Fail-closed display: an unavailable upstream is shown as NOT TRACED,
 *   never as a clean wallet.
 *
 * The router is registered under `ransomTrace` in server/routers.ts; the
 * `as any` cast keeps this component compiling before the mount lands
 * (same pattern as client/src/pages/InsiderThreat.tsx).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertOctagon, Coins, RefreshCw, ShieldQuestion } from "lucide-react";

// ransomTraceRouter is mounted in server/routers.ts (Round-13 integration) —
// calls are fully typed.
const api = trpc;

export function RansomTraceCard({ caseId, caseReference }: { caseId?: number; caseReference?: string }) {
  const [address, setAddress] = useState("");
  const [lastResult, setLastResult] = useState<any>(null);

  const traces = api.ransomTrace.listTraces.useQuery(
    caseId ? { caseId } : {},
  );
  const trace = api.ransomTrace.traceWallet.useMutation({
    onSuccess: (r: any) => {
      setLastResult(r);
      if (r?.ofacAlert) toast.error("OFAC-SANCTIONED WALLET — flagged to the audit ledger");
      else if (r?.unavailable) toast.warning("Trace unavailable — wallet NOT traced, do not treat as clean");
      else toast.success("Wallet traced — no OFAC match");
      traces.refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? String(e)),
  });

  const rows: any[] = (traces?.data as any[]) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Coins className="h-5 w-5" /> Crypto ransom wallet tracing
        </CardTitle>
        <CardDescription>
          Trace a ransom/extortion wallet via OSIRIS (blockstream / Blockscout proxy).
          {caseId ? ` Results attach to case ${caseReference ?? `#${caseId}`} automatically.` : " Provide a case to attach results as evidence."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="rt-address">Wallet address</Label>
            <Input
              id="rt-address"
              className="font-mono text-xs"
              placeholder="bc1q… / 0x… / T…"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={!trace || trace.isPending || address.trim().length < 20}
            onClick={() => trace?.mutate({ address: address.trim(), ...(caseId ? { caseId } : {}) })}
          >
            {trace?.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Trace wallet"}
          </Button>
        </div>

        {/* Latest result */}
        {lastResult?.result && (
          <div className={`rounded-md border p-3 space-y-2 ${
            lastResult.ofacAlert ? "border-red-500/50 bg-red-950/20" : "border-border/60 bg-muted/10"
          }`}>
            {lastResult.ofacAlert && (
              <div className="flex items-center gap-2">
                <AlertOctagon className="h-5 w-5 text-red-400" />
                <span className="font-bold text-red-300 text-sm">OFAC-SANCTIONED WALLET</span>
                <Badge variant="outline" className="bg-red-500/20 text-red-300 border-red-500/40">SDN match</Badge>
                {lastResult.ledgerSeq != null && (
                  <span className="text-[10px] mono text-muted-foreground">ledger seq #{lastResult.ledgerSeq}</span>
                )}
              </div>
            )}
            {lastResult.unavailable && (
              <div className="flex items-center gap-2 text-yellow-300 text-sm">
                <ShieldQuestion className="h-4 w-4" /> Trace unavailable — wallet NOT traced ({lastResult.result.reason ?? "upstream error"})
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div><span className="text-muted-foreground">Chain</span><div className="mono font-semibold">{lastResult.result.chain}{lastResult.result.chainInferred ? " (inferred)" : ""}</div></div>
              <div><span className="text-muted-foreground">Balance</span><div className="mono font-semibold">{lastResult.result.balance ?? "unknown"}</div></div>
              <div><span className="text-muted-foreground">Transactions</span><div className="mono font-semibold">{lastResult.result.txCount ?? lastResult.result.recentTxs?.length ?? "—"}</div></div>
              <div><span className="text-muted-foreground">OFAC</span><div className={`mono font-semibold ${lastResult.ofacAlert ? "text-red-300" : "text-green-400"}`}>{lastResult.ofacAlert ? "SANCTIONED" : lastResult.unavailable ? "UNKNOWN" : "no match"}</div></div>
            </div>
            {(lastResult.result.recentTxs ?? []).length > 0 && (
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-[11px] mono">
                  <thead><tr className="text-muted-foreground text-left"><th>txid</th><th>dir</th><th>amount</th><th>time</th></tr></thead>
                  <tbody>
                    {lastResult.result.recentTxs.map((t: any) => (
                      <tr key={t.txid} className="border-t border-border/20">
                        <td className="truncate max-w-[180px]">{t.txid}</td>
                        <td>{t.direction ?? "?"}</td>
                        <td>{t.amount ?? "—"}</td>
                        <td>{t.timestamp ? new Date(t.timestamp).toLocaleDateString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Trace history */}
        {rows.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold mb-1 text-muted-foreground">Trace history ({rows.length})</h4>
            <div className="space-y-1">
              {rows.map((r: any) => (
                <div key={r.id} className="flex items-center gap-2 text-xs mono border border-border/30 rounded px-2 py-1">
                  <span className="truncate max-w-[200px]">{r.address}</span>
                  <Badge variant="outline">{r.chain}</Badge>
                  {r.ofac_sanctioned
                    ? <Badge variant="outline" className="bg-red-500/20 text-red-300 border-red-500/40">OFAC</Badge>
                    : r.status !== "ok"
                      ? <Badge variant="outline" className="bg-yellow-500/20 text-yellow-300 border-yellow-500/40">unavailable</Badge>
                      : null}
                  {r.case_reference && <span className="text-primary">{r.case_reference}</span>}
                  <span className="ml-auto text-muted-foreground">{r.created_at ? new Date(r.created_at).toLocaleString() : ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default RansomTraceCard;
