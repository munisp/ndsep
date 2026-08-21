import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Brain, Plus, AlertTriangle, CheckCircle, Scale } from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const riskColors: Record<string, string> = {
  unacceptable: "bg-red-500/20 text-red-400",
  high: "bg-orange-500/20 text-orange-400",
  limited: "bg-yellow-500/20 text-yellow-400",
  minimal: "bg-green-500/20 text-green-400",
};

const statusColors: Record<string, string> = {
  submitted: "bg-blue-500/20 text-blue-400",
  under_review: "bg-yellow-500/20 text-yellow-400",
  approved: "bg-green-500/20 text-green-400",
  rejected: "bg-red-500/20 text-red-400",
  conditional: "bg-orange-500/20 text-orange-400",
};

const EMPTY_FORM = {
  aiSystemName: "",
  aiSystemType: "recommendation",
  riskLevel: "limited",
  description: "",
  dataCategories: "",
  biasAssessment: "",
  explainabilityScore: 70,
};

export default function AIEthicsBoard() {
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: systems, refetch } = trpc.phase12.aiEthics.listReviews.useQuery();
  const { data: stats } = trpc.phase12.aiEthics.getStats.useQuery();

  const register = trpc.phase12.aiEthics.submitForReview.useMutation({
    onSuccess: () => { refetch(); setShowRegister(false); setForm(EMPTY_FORM); toast.success("AI system registered"); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const review = trpc.phase12.aiEthics.completeReview.useMutation({
    onSuccess: () => { refetch(); toast.success("Review submitted"); },
  });

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "AI Hub", href: "/ai-hub" }, { label: "AI Ethics Board" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Brain className="w-6 h-6 text-violet-400" /> AI Ethics Board
          </h1>
          <p className="text-muted-foreground text-sm mt-1">AI System Registry & Ethics Review — NDPA Article 37 Automated Decision-Making Compliance</p>
        </div>
        <Button onClick={() => setShowRegister(true)} className="bg-violet-600 hover:bg-violet-700">
          <Plus className="w-4 h-4 mr-2" /> Register AI System
        </Button>
      </div>

      {/* EU AI Act Risk Framework */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { level: "Unacceptable Risk", color: "red", desc: "Banned: Social scoring, real-time biometric surveillance" },
          { level: "High Risk", color: "orange", desc: "Requires conformity assessment: HR, credit, law enforcement" },
          { level: "Limited Risk", color: "yellow", desc: "Transparency obligations: chatbots, deepfakes" },
          { level: "Minimal Risk", color: "green", desc: "No restrictions: spam filters, AI in video games" },
        ].map(r => (
          <Card key={r.level} className={`bg-${r.color}-900/20 border-${r.color}-700/40`}>
            <CardContent className="p-3">
              <p className={`text-${r.color}-300 text-xs font-medium`}>{r.level}</p>
              <p className="text-muted-foreground text-xs mt-1">{r.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Registered Systems</p>
            <p className="text-2xl font-bold text-foreground">{stats?.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-red-900/20 border-red-700/40">
          <CardContent className="p-4">
            <p className="text-red-400 text-xs">High/Unacceptable Risk</p>
            <p className="text-2xl font-bold text-red-300">{stats?.non_compliant ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-yellow-900/20 border-yellow-700/40">
          <CardContent className="p-4">
            <p className="text-yellow-400 text-xs">Pending Review</p>
            <p className="text-2xl font-bold text-yellow-300">{stats?.pending ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-green-900/20 border-green-700/40">
          <CardContent className="p-4">
            <p className="text-green-400 text-xs">Approved</p>
            <p className="text-2xl font-bold text-green-300">{stats?.approved ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Systems Table */}
      <Card className="bg-card/50 border-border">
        <CardHeader><CardTitle className="text-foreground text-base">AI System Registry</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="text-muted-foreground">System</TableHead>
                <TableHead className="text-muted-foreground">Type</TableHead>
                <TableHead className="text-muted-foreground">Organisation</TableHead>
                <TableHead className="text-muted-foreground">Risk Level</TableHead>
                <TableHead className="text-muted-foreground">Explainability</TableHead>
                <TableHead className="text-muted-foreground">Bias Score</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {systems?.map((s: any) => (
                <TableRow key={s.id} className="border-border">
                  <TableCell>
                    <p className="text-foreground text-sm font-medium">{s.ai_system_name}</p>
                    <p className="text-muted-foreground text-xs">{s.review_ref}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-border text-muted-foreground capitalize">
                      {String(s.ai_system_type ?? "").replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{s.org_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge className={riskColors[s.risk_category ?? "minimal"] ?? ""}>
                      {s.risk_category}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-12 bg-muted rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-violet-500"
                          style={{ width: `${s.explainability_score ?? 0}%` }} />
                      </div>
                      <span className="text-foreground text-xs">{s.explainability_score ?? 0}%</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={`text-sm font-medium ${(s.bias_assessment_score != null ? s.bias_assessment_score / 100 : 0) > 0.3 ? "text-red-400" : "text-green-400"}`}>
                      {((s.bias_assessment_score != null ? s.bias_assessment_score / 100 : 0) * 100).toFixed(1)}%
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge className={statusColors[s.review_status ?? "submitted"] ?? ""}>
                      {String(s.review_status ?? "").replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {s.review_status === "submitted" || s.review_status === "under_review" ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-green-400"
                          onClick={() => review.mutate({ id: s.id, biasAssessmentScore: 80, explainabilityScore: 75, fairnessScore: 85, ndpaArticle24Compliant: true, reviewStatus: "approved" })}>
                          <CheckCircle className="w-3 h-3" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-red-400"
                          onClick={() => review.mutate({ id: s.id, biasAssessmentScore: 30, explainabilityScore: 25, fairnessScore: 20, ndpaArticle24Compliant: false, reviewStatus: "rejected" })}>
                          <AlertTriangle className="w-3 h-3" />
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Register Dialog */}
      <Dialog open={showRegister} onOpenChange={setShowRegister}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg">
          <DialogHeader><DialogTitle>Register AI System</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground text-sm">System Name</Label>
              <Input className="mt-1 bg-muted border-border text-foreground" value={form.aiSystemName}
                onChange={e => setForm(f => ({ ...f, aiSystemName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-muted-foreground text-sm">System Type</Label>
                <Select value={form.aiSystemType} onValueChange={v => setForm(f => ({ ...f, aiSystemType: v }))}>
                  <SelectTrigger className="mt-1 bg-muted border-border text-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="recommendation">Recommendation</SelectItem>
                    <SelectItem value="credit_scoring">Credit Scoring</SelectItem>
                    <SelectItem value="facial_recognition">Facial Recognition</SelectItem>
                    <SelectItem value="fraud_detection">Fraud Detection</SelectItem>
                    <SelectItem value="nlp">NLP/Chatbot</SelectItem>
                    <SelectItem value="predictive_analytics">Predictive Analytics</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">Risk Level</Label>
                <Select value={form.riskLevel} onValueChange={v => setForm(f => ({ ...f, riskLevel: v }))}>
                  <SelectTrigger className="mt-1 bg-muted border-border text-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="minimal">Minimal</SelectItem>
                    <SelectItem value="limited">Limited</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="unacceptable">Unacceptable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Description</Label>
              <Textarea className="mt-1 bg-muted border-border text-foreground" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Explainability Score (0-100)</Label>
              <Input type="number" min={0} max={100} className="mt-1 bg-muted border-border text-foreground"
                value={form.explainabilityScore}
                onChange={e => setForm(f => ({ ...f, explainabilityScore: parseInt(e.target.value) || 0 }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground" onClick={() => setShowRegister(false)}>Cancel</Button>
            <Button className="bg-violet-600 hover:bg-violet-700"
              disabled={!form.aiSystemName || register.isPending}
              onClick={() => register.mutate({
                aiSystemName: form.aiSystemName,
                aiSystemType: form.aiSystemType as any,
                riskCategory: (form.riskLevel || "high") as any,
              })}>
              Register System
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
