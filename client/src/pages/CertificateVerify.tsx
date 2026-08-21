import { useState, useRef, useEffect } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield, CheckCircle2, XCircle, Search, Award, Building2, Calendar, Star, Download, Printer, Loader2 } from "lucide-react";

function CertificatePrintView({ data }: {
  data: {
    orgName?: string;
    orgSector?: string;
    orgCountry?: string;
    complianceScore?: number | null;
    certifiedAt?: Date | string | null;
    token?: string;
  };
}) {
  const certDate = data.certifiedAt
    ? new Date(data.certifiedAt).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })
    : "N/A";
  const expiryDate = data.certifiedAt
    ? new Date(new Date(data.certifiedAt).setFullYear(new Date(data.certifiedAt).getFullYear() + 1))
        .toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })
    : "N/A";

  return (
    <div id="certificate-print-area" className="hidden print:block" style={{ fontFamily: "Georgia, serif" }}>
      <div style={{ width: "210mm", minHeight: "148mm", padding: "20mm", border: "8px double #1a3a6b", margin: "0 auto", position: "relative", background: "#fff" }}>
        {/* Watermark */}
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%) rotate(-30deg)", fontSize: "80px", color: "rgba(26,58,107,0.05)", fontWeight: "bold", whiteSpace: "nowrap", pointerEvents: "none", zIndex: 0 }}>
          NDSEP NIGERIA
        </div>
        {/* Header */}
        <div style={{ textAlign: "center", borderBottom: "2px solid #1a3a6b", paddingBottom: "12px", marginBottom: "16px", position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: "11px", letterSpacing: "3px", color: "#1a3a6b", textTransform: "uppercase", marginBottom: "4px" }}>Federal Republic of Nigeria</div>
          <div style={{ fontSize: "20px", fontWeight: "bold", color: "#1a3a6b" }}>National Data Sovereignty Enforcement Platform</div>
          <div style={{ fontSize: "11px", color: "#555", marginTop: "2px" }}>Issued under the Nigeria Data Protection Act 2023 (NDPA)</div>
        </div>
        {/* Title */}
        <div style={{ textAlign: "center", margin: "12px 0", position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: "16px", letterSpacing: "2px", fontWeight: "bold", color: "#1a3a6b", textTransform: "uppercase" }}>Certificate of Data Sovereignty Compliance</div>
        </div>
        {/* Body */}
        <div style={{ textAlign: "center", margin: "16px 0", fontSize: "13px", color: "#222", lineHeight: "1.8", position: "relative", zIndex: 1 }}>
          <p>This is to certify that</p>
          <p style={{ fontSize: "22px", fontWeight: "bold", color: "#1a3a6b", margin: "8px 0" }}>{data.orgName}</p>
          <p>operating in the <strong>{data.orgSector}</strong> sector in <strong>{data.orgCountry}</strong></p>
          <p>has successfully completed all requirements of the NDSEP Data Sovereignty Compliance Programme</p>
          <p>and has achieved a compliance score of <strong style={{ fontSize: "18px", color: "#16a34a" }}>{data.complianceScore ?? "N/A"} / 100</strong></p>
        </div>
        {/* Dates */}
        <div style={{ display: "flex", justifyContent: "space-around", margin: "16px 0", fontSize: "12px", color: "#444", position: "relative", zIndex: 1 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: "bold", color: "#1a3a6b" }}>Date of Issue</div>
            <div>{certDate}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: "bold", color: "#1a3a6b" }}>Valid Until</div>
            <div>{expiryDate}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: "bold", color: "#1a3a6b" }}>Certificate No.</div>
            <div style={{ fontFamily: "monospace", fontSize: "10px" }}>{data.token?.slice(0, 24)}</div>
          </div>
        </div>
        {/* Signatures */}
        <div style={{ display: "flex", justifyContent: "space-around", marginTop: "24px", paddingTop: "12px", borderTop: "1px solid #ccc", fontSize: "11px", color: "#444", position: "relative", zIndex: 1 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ borderTop: "1px solid #1a3a6b", width: "120px", marginBottom: "4px" }} />
            <div style={{ fontWeight: "bold" }}>Director General, NITDA</div>
            <div>National Information Technology Development Agency</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ borderTop: "1px solid #1a3a6b", width: "120px", marginBottom: "4px" }} />
            <div style={{ fontWeight: "bold" }}>Commissioner, NDPC</div>
            <div>Nigeria Data Protection Commission</div>
          </div>
        </div>
        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: "12px", fontSize: "9px", color: "#888", position: "relative", zIndex: 1 }}>
          Verify this certificate at: https://ndsep.gov.ng/verify/{data.token} · NDSEP Ref: {data.token}
        </div>
      </div>
    </div>
  );
}

export default function CertificateVerify() {
  const params = useParams<{ token?: string }>();
  const urlToken = params?.token ?? "";
  const [inputToken, setInputToken] = useState(urlToken);
  const [queryToken, setQueryToken] = useState(urlToken);
  const printRef = useRef<HTMLDivElement>(null);

  // Auto-verify when token is in URL
  useEffect(() => {
    if (urlToken && !queryToken) {
      setInputToken(urlToken);
      setQueryToken(urlToken);
    }
  }, [urlToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading, isFetching } = trpc.verify.certificate.useQuery(
    { token: queryToken },
    { enabled: !!queryToken }
  );

  function handleVerify() {
    const t = inputToken.trim();
    if (t) setQueryToken(t);
  }

  function handlePrint() {
    window.print();
  }

  const loading = isLoading || isFetching;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col items-center justify-start pt-16 px-4 print:bg-background print:pt-0">
      {/* Print area — hidden on screen, visible when printing */}
      {data?.valid && (
        <CertificatePrintView data={data} />
      )}

      {/* Screen UI — hidden when printing */}
      <div className="w-full flex flex-col items-center print:hidden">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="bg-blue-600 rounded-xl p-3">
              <Shield className="h-8 w-8 text-white" />
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-bold text-white">NDSEP Certificate Verification</h1>
              <p className="text-blue-300 text-sm">National Data Sovereignty Enforcement Platform · Nigeria</p>
            </div>
          </div>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Verify the authenticity of an NDSEP Data Sovereignty Compliance Certificate issued to any organisation operating in Nigeria.
          </p>
        </div>

        {/* Search box */}
        <div className="w-full max-w-lg bg-background/5 backdrop-blur border border-white/10 rounded-2xl p-6 mb-6">
          <label className="block text-sm font-medium text-foreground mb-2">Certificate Token</label>
          <div className="flex gap-2">
            <Input
              value={inputToken}
              onChange={e => setInputToken(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleVerify()}
              placeholder="e.g. SUB-1234567890-ABCDEF"
              className="bg-background/10 border-white/20 text-white placeholder:text-muted-foreground focus:border-blue-400"
            />
            <Button onClick={handleVerify} disabled={!inputToken.trim() || loading} className="bg-blue-600 hover:bg-blue-700 shrink-0">
              {loading ? (
                <span className="flex items-center gap-1"><Loader2 className="h-4 w-4 animate-spin" /> Checking…</span>
              ) : (
                <span className="flex items-center gap-1"><Search className="h-4 w-4" /> Verify</span>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            The certificate token can be found on the official NDSEP compliance certificate document.
          </p>
        </div>

        {/* Result */}
        {data && queryToken && (
          <div className={`w-full max-w-lg rounded-2xl border p-6 ${data.valid ? "bg-emerald-950/60 border-emerald-500/40" : "bg-red-950/60 border-red-500/40"}`}>
            {data.valid ? (
              <>
                <div className="flex items-center gap-3 mb-5">
                  <div className="bg-emerald-500 rounded-full p-2">
                    <CheckCircle2 className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-emerald-300">Certificate Valid</h2>
                    <p className="text-emerald-500 text-xs">This certificate is authentic and currently active.</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    { icon: Building2, label: "Organisation", value: data.orgName },
                    { icon: Award, label: "Sector", value: data.orgSector },
                    { icon: Shield, label: "Country", value: data.orgCountry },
                    {
                      icon: Star,
                      label: "Compliance Score",
                      value: `${data.complianceScore ?? "N/A"} / 100`,
                      highlight: true,
                    },
                    {
                      icon: Calendar,
                      label: "Certified On",
                      value: data.certifiedAt
                        ? new Date(data.certifiedAt).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })
                        : "N/A",
                    },
                  ].map(({ icon: Icon, label, value, highlight }) => (
                    <div key={label} className="flex items-center justify-between py-2 border-b border-emerald-800/40 last:border-0">
                      <div className="flex items-center gap-2 text-emerald-400 text-sm">
                        <Icon className="h-4 w-4" />
                        <span>{label}</span>
                      </div>
                      <span className={`text-sm font-semibold ${highlight ? "text-emerald-300 text-base" : "text-white"}`}>{value as string}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 bg-emerald-900/40 rounded-lg px-4 py-3 text-xs text-emerald-400">
                  <strong>Token:</strong> <span className="font-mono">{data.token}</span>
                </div>
                {/* Download / Print buttons */}
                <div className="mt-4 flex gap-3">
                  <Button
                    onClick={handlePrint}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Download Certificate PDF
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handlePrint}
                    className="border-emerald-600 text-emerald-300 hover:bg-emerald-900/30 flex items-center gap-2"
                  >
                    <Printer className="h-4 w-4" />
                    Print
                  </Button>
                </div>
                <p className="text-xs text-emerald-600 mt-3 text-center">
                  Verified by the National Data Sovereignty Enforcement Platform · Nigeria
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="bg-red-500 rounded-full p-2">
                    <XCircle className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-red-300">Certificate Not Valid</h2>
                    <p className="text-red-400 text-xs">{data.message}</p>
                  </div>
                </div>
                {(data as { phase?: string }).phase && (
                  <p className="text-sm text-red-300">
                    Current registration phase: <strong>{(data as { phase?: string }).phase?.replace(/_/g, " ")}</strong>
                  </p>
                )}
                <p className="text-xs text-red-500 mt-3">
                  If you believe this is an error, contact <a href="mailto:compliance@ndsep.gov.ng" className="underline">compliance@ndsep.gov.ng</a>.
                </p>
              </>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-10 text-center text-xs text-muted-foreground max-w-md">
          <p>This verification service is operated by the Nigerian National Information Technology Development Agency (NITDA) under the Nigeria Data Protection Act 2023.</p>
          <p className="mt-1">For bulk verification or API access, contact the NDSEP Integration Team.</p>
        </div>
      </div>
    </div>
  );
}
