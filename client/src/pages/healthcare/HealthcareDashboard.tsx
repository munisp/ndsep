import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ExportButton } from "@/components/ExportButton";
import { Heart, AlertTriangle, CheckCircle, XCircle, FlaskConical, Building2 } from "lucide-react";

function fmtDate(v: any, len = 10): string {
  if (!v) return "—";
  if (typeof v === "string") return v.slice(0, len);
  if (v instanceof Date) return v.toISOString().slice(0, len);
  return String(v).slice(0, len);
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ?? "text-foreground"}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    compliant: "bg-green-500/15 text-green-600 dark:text-green-400", violation: "bg-red-500/15 text-red-600 dark:text-red-400",
    active: "bg-green-500/15 text-green-600 dark:text-green-400", recruiting: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    completed: "bg-muted text-foreground", ethics_approved: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
    suspended: "bg-red-500/15 text-red-600 dark:text-red-400", under_review: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  };
  return <Badge className={map[s] ?? "bg-muted text-foreground"}>{s.replace(/_/g, " ")}</Badge>;
}

export default function HealthcareDashboard() {
  
  const [tab, setTab] = useState("facilities");
  const [search, setSearch] = useState("");
  const [facilityType, setFacilityType] = useState("all");
  const [checkStatus, setCheckStatus] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ facilityName: "", facilityCode: "", facilityType: "federal_hospital", state: "", lga: "", nhiaAccreditationNumber: "", fmohLicenceNumber: "", bedCapacity: "", emrSystem: "" });

  const stats = trpc.healthcare.getStats.useQuery();
  const facilities = trpc.healthcare.listFacilities.useQuery({
    search: search || undefined,
    facilityType: facilityType === "all" ? undefined : facilityType,
    page: 1, limit: 20,
  });
  const dataChecks = trpc.healthcare.listDataChecks.useQuery({
    status: checkStatus === "all" ? undefined : checkStatus,
  });
  const trials = trpc.healthcare.listClinicalTrials.useQuery();

  const createFacility = trpc.healthcare.createFacility.useMutation({
    onSuccess: () => {
      toast.success("Facility created: Health facility has been registered.");
      facilities.refetch();
      setShowCreate(false);
      setForm({ facilityName: "", facilityCode: "", facilityType: "federal_hospital", state: "", lga: "", nhiaAccreditationNumber: "", fmohLicenceNumber: "", bedCapacity: "", emrSystem: "" });
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const s = stats.data as any;
  const fmt = (n: number | string) => Number(n).toLocaleString();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Heart className="h-6 w-6 text-primary" /> Healthcare Data Sovereignty Module
          </h1>
          <p className="text-sm text-muted-foreground mt-1">NHIA / FMOH — Patient Data Localisation, Clinical Trials & EMR Compliance</p>
        </div>
        <ExportButton data={facilities.data?.data ?? []} filename="healthcare-facilities" label="Export" />
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button><Building2 className="h-4 w-4 mr-2" />Register Facility</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Register Health Facility</DialogTitle></DialogHeader>
            <div className="space-y-3 pt-2">
              {[
                { key: "facilityName", label: "Facility Name", placeholder: "Lagos University Teaching Hospital" },
                { key: "facilityCode", label: "Facility Code", placeholder: "LUTH001" },
                { key: "state", label: "State", placeholder: "Lagos" },
                { key: "lga", label: "LGA", placeholder: "Idi-Araba" },
                { key: "nhiaAccreditationNumber", label: "NHIA Accreditation No.", placeholder: "NHIA/FHTA/001" },
                { key: "fmohLicenceNumber", label: "FMOH Licence No.", placeholder: "FMOH/FH/001" },
                { key: "bedCapacity", label: "Bed Capacity", placeholder: "300" },
                { key: "emrSystem", label: "EMR System", placeholder: "OpenMRS" },
              ].map(f => (
                <div key={f.key}>
                  <Label>{f.label}</Label>
                  <Input value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder} />
                </div>
              ))}
              <div>
                <Label>Facility Type</Label>
                <Select value={form.facilityType} onValueChange={v => setForm(p => ({ ...p, facilityType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["federal_hospital","state_hospital","private_hospital","clinic","laboratory","pharmacy"].map(t => (
                      <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => createFacility.mutate({ ...form, bedCapacity: form.bedCapacity ? parseInt(form.bedCapacity) : undefined })} disabled={createFacility.isPending} className="w-full">
                {createFacility.isPending ? "Registering..." : "Register Facility"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard label="Total Facilities" value={s?.total_facilities ?? "—"} />
        <StatCard label="Compliant" value={s?.compliant_facilities ?? "—"} color="text-green-600" />
        <StatCard label="Active Violations" value={s?.active_violations ?? "—"} color="text-red-600" />
        <StatCard label="Active Trials" value={s?.active_trials ?? "—"} />
        <StatCard label="Non-Compliant Trials" value={s?.non_compliant_trials ?? "—"} color="text-red-600" />
        <StatCard label="NDPC Registered" value={s?.ndpc_registered ?? "—"} color="text-green-600" />
        <StatCard label="DPIA Completed" value={s?.dpia_completed ?? "—"} />
        <StatCard label="Patient Records" value={s ? fmt(s.total_patient_records) : "—"} sub="total across all facilities" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="facilities">Health Facilities</TabsTrigger>
          <TabsTrigger value="checks">Data Localisation Checks</TabsTrigger>
          <TabsTrigger value="trials">Clinical Trials</TabsTrigger>
        </TabsList>

        {/* Facilities */}
        <TabsContent value="facilities" className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Input placeholder="Search facilities..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
            <Select value={facilityType} onValueChange={setFacilityType}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {["federal_hospital","state_hospital","private_hospital","clinic","laboratory","pharmacy"].map(t => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Facility","Code","Type","State","NHIA Accred.","Beds","EMR","Records","Compliant","NDPC","DPIA","Score"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(facilities.data?.data as any[] ?? []).map((f: any) => (
                  <tr key={f.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{f.facility_name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{f.facility_code}</td>
                    <td className="px-3 py-2 text-xs">{f.facility_type?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{f.state}</td>
                    <td className="px-3 py-2 font-mono text-xs">{f.nhia_accreditation_number ?? "—"}</td>
                    <td className="px-3 py-2">{f.bed_capacity ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{f.emr_system ?? "—"}</td>
                    <td className="px-3 py-2">{fmt(f.patient_records_count ?? 0)}</td>
                    <td className="px-3 py-2">{f.data_localisation_compliant ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{f.ndpc_registered ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{f.dpia_completed ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">
                      <span className={`font-bold ${Number(f.compliance_score) >= 80 ? "text-green-600" : Number(f.compliance_score) >= 60 ? "text-yellow-600" : "text-red-600"}`}>
                        {f.compliance_score ?? "—"}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Data Localisation Checks */}
        <TabsContent value="checks" className="space-y-3">
          <div className="flex gap-2">
            <Select value={checkStatus} onValueChange={setCheckStatus}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="compliant">Compliant</SelectItem>
                <SelectItem value="violation">Violation</SelectItem>
                <SelectItem value="under_review">Under Review</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Check Ref","Facility","Data Category","Storage Location","Country","Locally Stored","Cross-Border","Records","Status","Checked At"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(dataChecks.data as any[] ?? []).map((c: any) => (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{c.check_ref}</td>
                    <td className="px-3 py-2">{c.facility_name}</td>
                    <td className="px-3 py-2 text-xs">{c.data_category?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2 text-xs">{c.storage_location}</td>
                    <td className="px-3 py-2">{c.storage_country}</td>
                    <td className="px-3 py-2">{c.is_locally_stored ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{c.cross_border_transfer ? <Badge className="bg-red-500/15 text-red-600 dark:text-red-400">Yes</Badge> : "No"}</td>
                    <td className="px-3 py-2">{fmt(c.records_affected ?? 0)}</td>
                    <td className="px-3 py-2">{statusBadge(c.status)}</td>
                    <td className="px-3 py-2 text-xs">{fmtDate(c.checked_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Clinical Trials */}
        <TabsContent value="trials" className="space-y-3">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Trial Ref","Title","Facility","Sponsor","Phase","Therapeutic Area","Participants","Data Country","Foreign Sponsor","NDPC Approval","Compliant","Status"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(trials.data as any[] ?? []).map((t: any) => (
                  <tr key={t.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{t.trial_ref}</td>
                    <td className="px-3 py-2 text-xs max-w-[200px] truncate" title={t.trial_title}>{t.trial_title}</td>
                    <td className="px-3 py-2 text-xs">{t.facility_name}</td>
                    <td className="px-3 py-2 text-xs">{t.sponsor_name}</td>
                    <td className="px-3 py-2">{t.phase}</td>
                    <td className="px-3 py-2 text-xs">{t.therapeutic_area}</td>
                    <td className="px-3 py-2">{fmt(t.participant_count ?? 0)}</td>
                    <td className="px-3 py-2">{t.data_storage_country}</td>
                    <td className="px-3 py-2">{t.foreign_sponsor ? <Badge className="bg-orange-500/15 text-orange-600 dark:text-orange-400">Yes</Badge> : "No"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{t.ndpc_approval_ref ?? <span className="text-red-500">Missing</span>}</td>
                    <td className="px-3 py-2">{t.data_localisation_compliant ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{statusBadge(t.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
