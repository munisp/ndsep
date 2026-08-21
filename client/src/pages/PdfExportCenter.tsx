import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FileText, Download, Printer, Award, AlertTriangle, ClipboardList } from "lucide-react";

const PDF_TYPES = [
  { id: "compliance_certificate", label: "Compliance Certificate", icon: Award, color: "text-amber-400", description: "Official NDPA compliance certificate for an organization" },
  { id: "audit_return", label: "Annual Audit Return", icon: ClipboardList, color: "text-blue-400", description: "NDPA Section 44 annual audit return report" },
  { id: "penalty_notice", label: "Penalty Notice", icon: AlertTriangle, color: "text-red-400", description: "Formal regulatory penalty notice document" },
];

export default function PdfExportCenter() {
  const [selectedType, setSelectedType] = useState("compliance_certificate");
  const [orgId, setOrgId] = useState<number>(1);
  const [generating, setGenerating] = useState(false);

  const { data: orgs = [] } = trpc.organizations.list.useQuery();
  const certMut = trpc.pdfGeneration.generateComplianceCertificate.useMutation({
    onSuccess: (d) => { toast.success("PDF generated successfully"); if (d.downloadUrl) window.open(d.downloadUrl, "_blank"); setGenerating(false); },
    onError: (e) => { toast.error((e instanceof Error ? e.message : String(e))); setGenerating(false); },
  });
  const auditMut = trpc.pdfGeneration.generateAuditReturn.useMutation({
    onSuccess: (d) => { toast.success("Audit return PDF generated"); if (d.downloadUrl) window.open(d.downloadUrl, "_blank"); setGenerating(false); },
    onError: (e) => { toast.error((e instanceof Error ? e.message : String(e))); setGenerating(false); },
  });
  const penaltyMut = trpc.pdfGeneration.generatePenaltyNotice.useMutation({
    onSuccess: (d) => { toast.success("Penalty notice PDF generated"); if (d.downloadUrl) window.open(d.downloadUrl, "_blank"); setGenerating(false); },
    onError: (e) => { toast.error((e instanceof Error ? e.message : String(e))); setGenerating(false); },
  });

  const handleGenerate = () => {
    setGenerating(true);
    if (selectedType === "compliance_certificate") certMut.mutate({ orgId, certType: "ndpa" });
    else if (selectedType === "audit_return") auditMut.mutate({ orgId, year: new Date().getFullYear() });
    else if (selectedType === "penalty_notice") penaltyMut.mutate({ orgId, violation: "NDPA Section 48 violation — failure to implement adequate data protection measures", penaltyAmount: 5000000, dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0] });
  };

  const selectedPdfType = PDF_TYPES.find(t => t.id === selectedType);

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><FileText className="w-6 h-6 text-rose-400" /> PDF Export Center</h1>
            <p className="text-muted-foreground text-sm mt-1">Generate official regulatory documents: certificates, audit returns, penalty notices</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PDF_TYPES.map(t => (
            <Card key={t.id} className={`bg-card border-border cursor-pointer transition-all ${selectedType === t.id ? "border-rose-500/50 ring-1 ring-rose-500/30" : "hover:border-muted-foreground"}`} onClick={() => setSelectedType(t.id)}>
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <t.icon className={`w-8 h-8 ${t.color} mt-0.5`} />
                  <div>
                    <h3 className="text-foreground font-medium">{t.label}</h3>
                    <p className="text-muted-foreground text-xs mt-1">{t.description}</p>
                  </div>
                </div>
                {selectedType === t.id && <div className="mt-3 h-0.5 bg-rose-500/50 rounded" />}
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-card border-border">
          <CardHeader><CardTitle className="text-foreground flex items-center gap-2">{selectedPdfType && <selectedPdfType.icon className={`w-5 h-5 ${selectedPdfType.color}`} />} Generate {selectedPdfType?.label}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">Select Organization</label>
              <Select value={String(orgId)} onValueChange={v => setOrgId(Number(v))}>
                <SelectTrigger className="w-full max-w-md bg-muted border-border text-foreground"><SelectValue placeholder="Select organization..." /></SelectTrigger>
                <SelectContent className="bg-muted border-border">
                  {(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)}>{o.name} ({String(o.sector ?? "").toUpperCase()})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="bg-muted/50 rounded-lg p-4 border border-border">
              <h4 className="text-foreground text-sm font-medium mb-2">Document Details</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">Type:</span> <span className="text-foreground">{selectedPdfType?.label}</span></div>
                <div><span className="text-muted-foreground">Format:</span> <span className="text-foreground">PDF/A-1b (archival)</span></div>
                <div><span className="text-muted-foreground">Authority:</span> <span className="text-foreground">NDPC / NDSEP</span></div>
                <div><span className="text-muted-foreground">Watermark:</span> <span className="text-foreground">OFFICIAL DOCUMENT</span></div>
              </div>
            </div>

            <div className="flex gap-3">
              <Button className="bg-rose-600 hover:bg-rose-700" disabled={generating} onClick={handleGenerate}>
                <Download className={`w-4 h-4 mr-2 ${generating ? "animate-bounce" : ""}`} />
                {generating ? "Generating PDF..." : "Generate & Download PDF"}
              </Button>
              <Button variant="outline" className="border-border text-muted-foreground hover:text-foreground" onClick={() => window.print()}>
                <Printer className="w-4 h-4 mr-2" /> Print Preview
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Recent exports */}
        <Card className="bg-card border-border">
          <CardHeader><CardTitle className="text-foreground text-sm">Recent Exports</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[
                { type: "Compliance Certificate", org: "First Bank of Nigeria", date: "2026-04-14", status: "ready" },
                { type: "Annual Audit Return", org: "MTN Nigeria", date: "2026-04-13", status: "ready" },
                { type: "Penalty Notice", org: "Airtel Nigeria", date: "2026-04-12", status: "ready" },
                { type: "Compliance Certificate", org: "Zenith Bank", date: "2026-04-11", status: "ready" },
              ].map((e, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <FileText className="w-4 h-4 text-rose-400" />
                    <div>
                      <p className="text-foreground text-sm">{e.type}</p>
                      <p className="text-muted-foreground text-xs">{e.org}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{e.date}</span>
                    <Button size="sm" variant="ghost" className="text-rose-400 hover:text-rose-300 h-7 px-2" onClick={() => toast.info("Re-downloading...")}>
                      <Download className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
