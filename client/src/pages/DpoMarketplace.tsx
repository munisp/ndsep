/**
 * DPO Marketplace (gap 11)
 *
 * Public browse of verified DPO/DPCO profiles plus an organisation engagement
 * request form. Matching scores come from the deterministic
 * dpoMarketplace.matchProfiles endpoint (sector/region/language overlap +
 * capacity fit + NDPC-verified bonus — see server/routers/dpoMarketplace.ts).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ShieldCheck, Users, MapPin, Languages, Briefcase, Search } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";

const SECTORS = ["banking", "telecom", "health", "insurance", "fintech", "education", "government", "retail", "energy", "media"];
const REGIONS = ["lagos", "abuja", "kano", "rivers", "oyo", "kaduna", "enugu", "delta", "nationwide"];
const LANGUAGES = ["english", "hausa", "yoruba", "igbo", "french"];

const EMPTY_REQUEST = {
  orgName: "",
  contactEmail: "",
  sector: "all",
  region: "all",
  language: "all",
  minCapacity: 1,
};

export default function DpoMarketplace() {
  const [sector, setSector] = useState("all");
  const [region, setRegion] = useState("all");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [request, setRequest] = useState(EMPTY_REQUEST);

  const profiles = trpc.dpoMarketplace.listProfiles.useQuery({
    sector: sector === "all" ? undefined : sector,
    region: region === "all" ? undefined : region,
    verifiedOnly,
  });

  const matchInput = {
    sectors: request.sector === "all" ? [] : [request.sector],
    regions: request.region === "all" ? [] : [request.region],
    languages: request.language === "all" ? [] : [request.language],
    minCapacity: request.minCapacity,
    limit: 5,
  };
  const matches = trpc.dpoMarketplace.matchProfiles.useQuery(matchInput, { enabled: showRequest });

  const postEngagement = trpc.dpoMarketplace.postEngagement.useMutation({
    onSuccess: (data: any) => {
      toast.success(`Engagement request posted: ${data.engagement_ref}`);
      setShowRequest(false);
      setRequest(EMPTY_REQUEST);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to post request"),
  });

  return (
    <div className="container py-6 space-y-6">
      <Breadcrumbs items={[{ label: "DPO Marketplace" }]} />

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">DPO Marketplace</h1>
          <p className="text-muted-foreground">
            Find NDPC-verified Data Protection Officers and Compliance Organisations for your organisation.
          </p>
        </div>
        <Button onClick={() => setShowRequest(true)}>
          <Briefcase className="h-4 w-4 mr-2" aria-hidden="true" />
          Post Engagement Request
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6 flex flex-wrap gap-4 items-end">
          <div className="space-y-1">
            <Label htmlFor="filter-sector">Sector</Label>
            <Select value={sector} onValueChange={setSector}>
              <SelectTrigger id="filter-sector" className="w-44"><SelectValue placeholder="All sectors" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sectors</SelectItem>
                {SECTORS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="filter-region">Region</Label>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger id="filter-region" className="w-44"><SelectValue placeholder="All regions" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All regions</SelectItem>
                {REGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 pb-2">
            <input
              type="checkbox"
              checked={verifiedOnly}
              onChange={(e) => setVerifiedOnly(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm">NDPC-verified only</span>
          </label>
          <Button variant="outline" onClick={() => profiles.refetch()}>
            <Search className="h-4 w-4 mr-2" aria-hidden="true" /> Search
          </Button>
        </CardContent>
      </Card>

      {/* Profile grid */}
      {profiles.isLoading && <p className="text-muted-foreground">Loading profiles…</p>}
      {profiles.data && profiles.data.length === 0 && (
        <p className="text-muted-foreground">No DPO/DPCO profiles match your filters.</p>
      )}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {profiles.data?.map((p: any) => (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                {p.name}
                {p.verified && (
                  <Badge variant="default" className="gap-1">
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Verified
                  </Badge>
                )}
              </CardTitle>
              <Badge variant="outline">{String(p.profile_type).toUpperCase()}</Badge>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {p.bio && <p className="text-muted-foreground line-clamp-3">{p.bio}</p>}
              <p className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {(p.sectors ?? []).join(", ") || "All sectors"}
              </p>
              <p className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {(p.regions ?? []).join(", ") || "Nationwide"}
              </p>
              <p className="flex items-center gap-2">
                <Languages className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {(p.languages ?? []).join(", ") || "English"}
              </p>
              <p className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Capacity: {p.capacity} client(s)
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Engagement request dialog with live matching */}
      <Dialog open={showRequest} onOpenChange={setShowRequest}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Post an Engagement Request</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="req-org">Organisation name</Label>
                <Input id="req-org" value={request.orgName} onChange={(e) => setRequest({ ...request, orgName: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="req-email">Contact email</Label>
                <Input id="req-email" type="email" value={request.contactEmail} onChange={(e) => setRequest({ ...request, contactEmail: e.target.value })} />
              </div>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>Sector</Label>
                <Select value={request.sector} onValueChange={(v) => setRequest({ ...request, sector: v })}>
                  <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any</SelectItem>
                    {SECTORS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Region</Label>
                <Select value={request.region} onValueChange={(v) => setRequest({ ...request, region: v })}>
                  <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any</SelectItem>
                    {REGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Language</Label>
                <Select value={request.language} onValueChange={(v) => setRequest({ ...request, language: v })}>
                  <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any</SelectItem>
                    {LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Live deterministic match preview */}
            {matches.data && matches.data.length > 0 && (
              <div className="border rounded-md p-3 space-y-2">
                <p className="text-sm font-medium">Top matches for these requirements</p>
                <ul className="space-y-1">
                  {matches.data.map((m: any) => (
                    <li key={m.profileId} className="flex justify-between text-sm">
                      <span>{m.name} {m.verified && <Badge variant="default" className="ml-1">Verified</Badge>}</span>
                      <span className="font-mono">{m.score}/100</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRequest(false)}>Cancel</Button>
            <Button
              disabled={!request.orgName || !request.contactEmail || postEngagement.isPending}
              onClick={() =>
                postEngagement.mutate({
                  orgName: request.orgName,
                  contactEmail: request.contactEmail,
                  requirements: {
                    sectors: request.sector === "all" ? [] : [request.sector],
                    regions: request.region === "all" ? [] : [request.region],
                    languages: request.language === "all" ? [] : [request.language],
                    minCapacity: request.minCapacity,
                  },
                })
              }
            >
              {postEngagement.isPending ? "Posting…" : "Post Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
