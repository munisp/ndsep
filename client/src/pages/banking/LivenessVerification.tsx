/**
 * LivenessVerification — Full biometric verification page for KYC.
 *
 * Tabs:
 *   1. Passive Liveness (single photo)
 *   2. Active Liveness (video challenges: blink, turn head)
 *   3. Face Matching (compare two photos)
 *   4. Anti-Spoofing Analysis
 *   5. Deepfake Detection
 *   6. History — past liveness check results
 */

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  ScanFace, ShieldCheck, Camera, AlertTriangle, Eye, Activity,
  CheckCircle2, XCircle, Upload, History, Brain, Fingerprint,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LivenessCamera } from "@/components/LivenessCamera";

interface AntiSpoofCheck {
  name: string;
  score: number;
  weight: number;
  details: string;
}

interface AntiSpoofData {
  is_real: boolean;
  overall_score: number;
  spoof_type: string;
  spoof_probability: number;
  checks: AntiSpoofCheck[];
  attack_details: Record<string, number>;
}

interface DeepfakeData {
  is_deepfake: boolean;
  confidence: number;
  deepfake_probability: number;
  frequency_score: number;
  blending_score: number;
  lighting_score: number;
  texture_score: number;
  details: string;
}

interface LivenessResult {
  is_live?: boolean;
  is_match?: boolean;
  liveness_score?: number;
  face_quality?: number;
  similarity?: number;
  confidence?: number;
  anti_spoof?: AntiSpoofData | null;
  deepfake?: DeepfakeData | null;
  landmarks_68?: number[][] | null;
  landmark_features?: Record<string, number> | null;
  processing_time_ms?: number;
  details?: string;
  challenge_results?: Record<string, boolean>;
  challenges_passed?: number;
  challenges_total?: number;
  checkId?: number;
}

// ─── Score Badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ score, label }: { score: number; label: string }) {
  const color = score >= 80 ? "text-green-600" : score >= 50 ? "text-yellow-600" : "text-red-600";
  const bg = score >= 80 ? "bg-green-50" : score >= 50 ? "bg-yellow-50" : "bg-red-50";
  return (
    <div className={`${bg} rounded-lg p-3 text-center`}>
      <Breadcrumbs items={[{ label: "Banking", href: "/banking" }, { label: "Liveness Verification" }]} />

      <div className={`text-2xl font-bold ${color}`}>{score.toFixed(1)}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// ─── Result Card ──────────────────────────────────────────────────────────────

function ResultCard({ result, title }: { result: LivenessResult | null; title: string }) {
  if (!result) return null;

  const isLive = result.is_live as boolean | undefined;
  const isMatch = result.is_match as boolean | undefined;
  const passed = isLive ?? isMatch ?? false;

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge variant={passed ? "default" : "destructive"} className="gap-1">
            {passed ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            {passed ? "PASSED" : "FAILED"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {/* Scores */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {result.liveness_score != null && (
            <ScoreBadge score={Number(result.liveness_score)} label="Liveness" />
          )}
          {result.face_quality != null && (
            <ScoreBadge score={Number(result.face_quality)} label="Face Quality" />
          )}
          {result.similarity != null && (
            <ScoreBadge score={Number(result.similarity) * 100} label="Similarity" />
          )}
          {result.confidence != null && (
            <ScoreBadge score={Number(result.confidence)} label="Confidence" />
          )}
        </div>

        {/* Anti-Spoof Details */}
        {result.anti_spoof && (
          <div className="space-y-2 mb-4">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              Anti-Spoofing Analysis
            </h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                Spoof Type:{" "}
                <Badge variant="outline">
                  {result.anti_spoof.spoof_type ?? "unknown"}
                </Badge>
              </div>
              <div>
                Score:{" "}
                <span className="font-medium">
                  {(result.anti_spoof.overall_score ?? 0).toFixed(1)}%
                </span>
              </div>
            </div>
            {result.anti_spoof.checks && (
              <div className="space-y-1">
                {result.anti_spoof.checks.map((check) => (
                    <div key={check.name} className="flex items-center gap-2 text-xs">
                      <span className="w-28 text-muted-foreground">{check.name}</span>
                      <Progress value={check.score * 100} className="flex-1 h-2" />
                      <span className="w-12 text-right">{(check.score * 100).toFixed(0)}%</span>
                    </div>
                ))}
              </div>
            )}
            {result.anti_spoof.attack_details && (
              <div className="mt-2">
                <h5 className="text-xs text-muted-foreground mb-1">Attack Type Probabilities</h5>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(result.anti_spoof.attack_details).map(([attack, prob]) => (
                    <Badge
                      key={attack}
                      variant={prob > 0.3 ? "destructive" : "outline"}
                      className="text-xs"
                    >
                      {attack}: {(prob * 100).toFixed(0)}%
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Deepfake Details */}
        {result.deepfake && (
          <div className="space-y-2 mb-4">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Brain className="w-4 h-4" />
              Deepfake Analysis
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div>Frequency: {(result.deepfake.frequency_score ?? 0).toFixed(2)}</div>
              <div>Blending: {(result.deepfake.blending_score ?? 0).toFixed(2)}</div>
              <div>Lighting: {(result.deepfake.lighting_score ?? 0).toFixed(2)}</div>
              <div>Texture: {(result.deepfake.texture_score ?? 0).toFixed(2)}</div>
            </div>
          </div>
        )}

        {/* Landmarks */}
        {result.landmarks_68 && (
          <div className="text-xs text-muted-foreground">
            68-point landmarks detected | {result.details ?? ""}
          </div>
        )}

        {/* Challenge results (active liveness) */}
        {result.challenge_results && (
          <div className="space-y-1 mt-2">
            <h4 className="text-sm font-medium">Challenge Results</h4>
            <div className="flex flex-wrap gap-2">
              {Object.entries(result.challenge_results).map(
                ([name, passed]) => (
                  <Badge key={name} variant={passed ? "default" : "destructive"} className="gap-1">
                    {passed ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {name}
                  </Badge>
                )
              )}
            </div>
          </div>
        )}

        {/* Processing time */}
        {result.processing_time_ms != null && (
          <div className="text-xs text-muted-foreground mt-2">
            Processed in {Number(result.processing_time_ms).toFixed(0)}ms
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── File Upload Helper ───────────────────────────────────────────────────────

function useFileToBase64() {
  return useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function LivenessVerification() {
  const [passiveResult, setPassiveResult] = useState<LivenessResult | null>(null);
  const [activeResult, setActiveResult] = useState<LivenessResult | null>(null);
  const [matchResult, setMatchResult] = useState<LivenessResult | null>(null);
  const [spoofResult, setSpoofResult] = useState<LivenessResult | null>(null);
  const [deepfakeResult, setDeepfakeResult] = useState<LivenessResult | null>(null);
  const [imageA, setImageA] = useState<string | null>(null);
  const [imageB, setImageB] = useState<string | null>(null);

  const fileToBase64 = useFileToBase64();

  // tRPC mutations
  const passiveMutation = trpc.liveness.passiveCheck.useMutation({
    onSuccess: (data) => {
      setPassiveResult(data as LivenessResult);
      toast.success(data.is_live ? "Liveness check passed" : "Liveness check failed");
    },
    onError: (err) => toast.error(err.message),
  });

  const activeMutation = trpc.liveness.activeCheck.useMutation({
    onSuccess: (data) => {
      setActiveResult(data as LivenessResult);
      toast.success(
        data.is_live
          ? `Active liveness passed (${data.challenges_passed}/${data.challenges_total} challenges)`
          : "Active liveness failed"
      );
    },
    onError: (err) => toast.error(err.message),
  });

  const matchMutation = trpc.liveness.faceMatch.useMutation({
    onSuccess: (data) => {
      setMatchResult(data as LivenessResult);
      toast.success(data.is_match ? "Faces match!" : "Faces do not match");
    },
    onError: (err) => toast.error(err.message),
  });

  const spoofMutation = trpc.liveness.antiSpoof.useMutation({
    onSuccess: (data) => {
      setSpoofResult(data as LivenessResult);
      toast.success("Anti-spoofing analysis complete");
    },
    onError: (err) => toast.error(err.message),
  });

  const deepfakeMutation = trpc.liveness.deepfakeDetect.useMutation({
    onSuccess: (data) => {
      setDeepfakeResult(data as LivenessResult);
      toast.success("Deepfake analysis complete");
    },
    onError: (err) => toast.error(err.message),
  });

  const { data: history } = trpc.liveness.listResults.useQuery({ limit: 10 });
  const { data: serviceHealth } = trpc.liveness.serviceHealth.useQuery();

  // Handlers
  const handlePassiveCapture = (base64: string) => {
    passiveMutation.mutate({ image: base64 });
  };

  const handleActiveCapture = (frames: string[]) => {
    activeMutation.mutate({ frames, challenges: ["blink", "turn_left"] });
  };

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (v: string) => void,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await fileToBase64(file);
    setter(b64);
  };

  const handleFaceMatch = () => {
    if (!imageA || !imageB) {
      toast.error("Please upload both images");
      return;
    }
    matchMutation.mutate({ imageA: imageA, imageB: imageB });
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <ScanFace className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Liveness Verification</h1>
            <p className="text-sm text-muted-foreground">
              Biometric face detection, anti-spoofing, and deepfake analysis
            </p>
          </div>
        </div>
        <Badge
          variant={serviceHealth?.healthy ? "default" : "destructive"}
          className="gap-1"
        >
          {serviceHealth?.healthy ? (
            <CheckCircle2 className="w-3 h-3" />
          ) : (
            <AlertTriangle className="w-3 h-3" />
          )}
          {serviceHealth?.healthy ? "Service Online" : "Service Offline"}
        </Badge>
      </div>

      {/* Feature overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { icon: Camera, label: "Passive Liveness", desc: "Single photo" },
          { icon: Activity, label: "Active Liveness", desc: "Video + challenges" },
          { icon: ScanFace, label: "Face Matching", desc: "Two-image compare" },
          { icon: ShieldCheck, label: "Anti-Spoofing", desc: "6 attack types" },
          { icon: Brain, label: "Deepfake Detection", desc: "GAN analysis" },
          { icon: Fingerprint, label: "68-Point Landmarks", desc: "Facial geometry" },
        ].map((f) => (
          <Card key={f.label} className="text-center p-3">
            <f.icon className="w-5 h-5 mx-auto text-primary mb-1" />
            <div className="text-xs font-medium">{f.label}</div>
            <div className="text-[10px] text-muted-foreground">{f.desc}</div>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="passive" className="space-y-4">
        <TabsList className="grid grid-cols-6 w-full">
          <TabsTrigger value="passive" className="gap-1 text-xs">
            <Camera className="w-3 h-3" /> Passive
          </TabsTrigger>
          <TabsTrigger value="active" className="gap-1 text-xs">
            <Activity className="w-3 h-3" /> Active
          </TabsTrigger>
          <TabsTrigger value="match" className="gap-1 text-xs">
            <ScanFace className="w-3 h-3" /> Match
          </TabsTrigger>
          <TabsTrigger value="spoof" className="gap-1 text-xs">
            <ShieldCheck className="w-3 h-3" /> Spoof
          </TabsTrigger>
          <TabsTrigger value="deepfake" className="gap-1 text-xs">
            <Brain className="w-3 h-3" /> Deepfake
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1 text-xs">
            <History className="w-3 h-3" /> History
          </TabsTrigger>
        </TabsList>

        {/* Passive Liveness */}
        <TabsContent value="passive" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Camera className="w-4 h-4" />
                Passive Liveness Check
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Capture a single photo. The system analyzes face quality, texture, frequency
                patterns, and color distribution to determine if the image is from a live person.
              </p>
            </CardHeader>
            <CardContent>
              <LivenessCamera
                onCapture={handlePassiveCapture}
                showGuide
                disabled={passiveMutation.isPending}
              />
              {passiveMutation.isPending && (
                <div className="text-center mt-4 text-sm text-muted-foreground animate-pulse">
                  Analyzing liveness...
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-3 text-center">
                Or upload an image file:
              </p>
              <div className="flex justify-center mt-1">
                <Input
                  type="file"
                  accept="image/*"
                  className="w-64"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const b64 = await fileToBase64(file);
                    passiveMutation.mutate({ image: b64 });
                  }}
                />
              </div>
            </CardContent>
          </Card>
          <ResultCard result={passiveResult} title="Passive Liveness Result" />
        </TabsContent>

        {/* Active Liveness */}
        <TabsContent value="active" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Active Liveness Check
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Follow the on-screen challenges (blink, turn your head). The system records
                30 frames and verifies natural motion, blink detection, and head pose changes.
              </p>
            </CardHeader>
            <CardContent>
              <LivenessCamera
                activeMode
                onMultiCapture={handleActiveCapture}
                showGuide
                challenge="Blink naturally, then slowly turn your head left"
                frameCount={30}
                frameInterval={200}
                disabled={activeMutation.isPending}
              />
              {activeMutation.isPending && (
                <div className="text-center mt-4 text-sm text-muted-foreground animate-pulse">
                  Analyzing video frames...
                </div>
              )}
            </CardContent>
          </Card>
          <ResultCard result={activeResult} title="Active Liveness Result" />
        </TabsContent>

        {/* Face Matching */}
        <TabsContent value="match" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ScanFace className="w-4 h-4" />
                Face Matching
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Compare two face images. Extracts 128-dimensional feature vectors and
                computes cosine similarity. Threshold: 60% (configurable).
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Reference Image (ID document)</Label>
                  <Input
                    type="file"
                    accept="image/*"
                    className="mt-1"
                    onChange={(e) => handleFileUpload(e, setImageA)}
                  />
                  {imageA && (
                    <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Image loaded
                    </div>
                  )}
                </div>
                <div>
                  <Label>Probe Image (selfie)</Label>
                  <Input
                    type="file"
                    accept="image/*"
                    className="mt-1"
                    onChange={(e) => handleFileUpload(e, setImageB)}
                  />
                  {imageB && (
                    <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Image loaded
                    </div>
                  )}
                </div>
              </div>
              <Button
                onClick={handleFaceMatch}
                disabled={!imageA || !imageB || matchMutation.isPending}
                className="mt-4 w-full gap-2"
              >
                <Eye className="w-4 h-4" />
                {matchMutation.isPending ? "Matching..." : "Compare Faces"}
              </Button>
            </CardContent>
          </Card>
          <ResultCard result={matchResult} title="Face Match Result" />
        </TabsContent>

        {/* Anti-Spoofing */}
        <TabsContent value="spoof" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                Anti-Spoofing Classification
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Analyzes 6 attack vectors: printed photo, screen replay, paper mask,
                3D mask, high-quality photo, and deepfake. Uses LBP texture, FFT frequency,
                color-space, reflection, edge density, and noise pattern analysis.
              </p>
            </CardHeader>
            <CardContent>
              <LivenessCamera
                onCapture={(b64) => spoofMutation.mutate({ image: b64 })}
                showGuide
                disabled={spoofMutation.isPending}
              />
              {spoofMutation.isPending && (
                <div className="text-center mt-4 text-sm text-muted-foreground animate-pulse">
                  Running anti-spoofing analysis...
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-3 text-center">
                Or upload an image:
              </p>
              <div className="flex justify-center mt-1">
                <Input
                  type="file"
                  accept="image/*"
                  className="w-64"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const b64 = await fileToBase64(file);
                    spoofMutation.mutate({ image: b64 });
                  }}
                />
              </div>
            </CardContent>
          </Card>
          <ResultCard result={spoofResult} title="Anti-Spoofing Result" />
        </TabsContent>

        {/* Deepfake */}
        <TabsContent value="deepfake" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="w-4 h-4" />
                Deepfake Detection
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Detects AI-generated face manipulations using frequency-domain GAN artifact
                analysis, blending boundary detection, lighting consistency, and texture
                pattern analysis.
              </p>
            </CardHeader>
            <CardContent>
              <LivenessCamera
                onCapture={(b64) => deepfakeMutation.mutate({ image: b64 })}
                showGuide
                disabled={deepfakeMutation.isPending}
              />
              {deepfakeMutation.isPending && (
                <div className="text-center mt-4 text-sm text-muted-foreground animate-pulse">
                  Running deepfake analysis...
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-3 text-center">
                Or upload an image:
              </p>
              <div className="flex justify-center mt-1">
                <Input
                  type="file"
                  accept="image/*"
                  className="w-64"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const b64 = await fileToBase64(file);
                    deepfakeMutation.mutate({ image: b64 });
                  }}
                />
              </div>
            </CardContent>
          </Card>
          <ResultCard result={deepfakeResult} title="Deepfake Detection Result" />
        </TabsContent>

        {/* History */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="w-4 h-4" />
                Verification History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!history || (history as Record<string, unknown>[]).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No verification history yet. Run a liveness check to see results here.
                </p>
              ) : (
                <div className="space-y-2">
                  {(history as Record<string, unknown>[]).map((row) => (
                    <div
                      key={String(row.id)}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50 text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant="outline">{String(row.check_type)}</Badge>
                        <span className="font-mono text-xs">{String(row.reference_id)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          Score: {Number(row.liveness_score ?? 0).toFixed(1)}
                        </span>
                        <Badge variant={row.is_live ? "default" : "destructive"}>
                          {row.is_live ? "PASS" : "FAIL"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
