import fs from "node:fs";
import path from "node:path";

import {
  type BusinessDocumentRecord,
  type BusinessProfileRecord,
  type IdentityDocumentRecord,
  type KybDocumentStatus,
  type LegalWorkflowRecord,
  type LegalWorkflowStatus,
  type LivenessSessionRecord,
  type MobilePlatformBundle,
  type NotificationPreferences,
  type ParcelMuteDuration,
  cloneSeedBundle,
} from "../lib/mobile-data";
import { invokeLLM, listLLMModels } from "./_core/llm";

type SyncMutation = {
  type: "mission_status" | "onboarding_document" | "liveness" | "legal_status" | "notification_preference";
  recordId: string;
  queuedAt: string;
};

type StoredBundle = MobilePlatformBundle & {
  syncQueue: SyncMutation[];
};

type DocumentAnalysisResult = {
  engine: BusinessDocumentRecord["engine"];
  confidence: number;
  summary: string;
  status: KybDocumentStatus;
  extractedFields: Record<string, string>;
  needsAttention: boolean;
};

const DATA_DIR = path.join(process.cwd(), "server", "data");
const STORE_PATH = path.join(DATA_DIR, "mobile-platform-store.json");

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultStore(): StoredBundle {
  return {
    ...cloneSeedBundle(),
    syncQueue: [],
  };
}

function purgeResolvedMutes(store: StoredBundle) {
  const now = Date.now();
  store.notificationPreferences.parcelMutes = store.notificationPreferences.parcelMutes.filter((mute) => {
    if (mute.duration !== "until_workflow_completion" && mute.mutedUntil && new Date(mute.mutedUntil).getTime() <= now) {
      return false;
    }

    if (mute.duration === "until_workflow_completion") {
      const workflow = store.legalWorkflows.find((item) => item.parcelId === mute.parcelId && (!mute.workflowId || item.id === mute.workflowId));
      if (workflow && (workflow.status === "registered" || workflow.status === "rejected")) {
        return false;
      }
    }

    return true;
  });
}

function readStore(): StoredBundle {
  ensureDataDir();

  if (!fs.existsSync(STORE_PATH)) {
    const store = defaultStore();
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
    return store;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as StoredBundle;
    if (!Array.isArray(parsed.parcels) || !Array.isArray(parsed.missions) || !Array.isArray(parsed.legalWorkflows)) {
      const store = defaultStore();
      fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
      return store;
    }
    parsed.notificationPreferences = {
      ...defaultStore().notificationPreferences,
      ...parsed.notificationPreferences,
      parcelMutes: parsed.notificationPreferences?.parcelMutes ?? [],
      followedParcelIds: parsed.notificationPreferences?.followedParcelIds ?? [],
    };
    purgeResolvedMutes(parsed);
    return parsed;
  } catch {
    const store = defaultStore();
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
    return store;
  }
}

function writeStore(store: StoredBundle) {
  ensureDataDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function buildSyncMeta(store: StoredBundle, source: MobilePlatformBundle["syncMeta"]["source"] = "live") {
  return {
    ...store.syncMeta,
    source,
    lastSyncedAt: new Date().toISOString(),
    pendingMutations: store.syncQueue.length,
    offlineReady: true,
  };
}

function refreshReadiness(store: StoredBundle) {
  const checklist = [
    { key: "nin", label: "NIN verification", completed: store.onboarding.ninStatus === "verified" },
    { key: "bvn", label: "BVN verification", completed: store.onboarding.bvnStatus === "verified" },
    { key: "liveness", label: "Liveness verification", completed: store.onboarding.livenessStatus === "verified" },
    { key: "kyc_documents", label: "KYC documents", completed: store.onboarding.identityDocuments.filter((item) => item.status === "verified").length >= 2 },
    { key: "cac", label: "CAC verification", completed: store.onboarding.businessProfile.cacStatus === "verified" },
    { key: "tin", label: "TIN verification", completed: store.onboarding.businessProfile.tinStatus === "verified" },
    { key: "kyb_documents", label: "KYB documents", completed: store.onboarding.businessProfile.documents.filter((item) => item.status === "verified").length >= 1 },
  ];

  const completedItems = checklist.filter((item) => item.completed).length;
  const percentage = Math.round((completedItems / checklist.length) * 100);

  store.onboarding.checklist = checklist;
  store.onboarding.readiness = percentage;
  store.onboarding.kybStatus =
    store.onboarding.businessProfile.onboardingStatus === "verified"
      ? "verified"
      : store.onboarding.businessProfile.onboardingStatus === "needs_attention"
        ? "failed"
        : "in_review";
  store.onboarding.nextAction =
    checklist.find((item) => !item.completed)?.label
      ? `Complete ${checklist.find((item) => !item.completed)?.label?.toLowerCase()} to finish stakeholder onboarding.`
      : "Onboarding verified and ready for downstream land-rights processing.";
  store.onboarding.onboardingStatus = percentage === 100 ? "verified" : percentage >= 57 ? "in_review" : "draft";
}

function timeline(status: LegalWorkflowStatus, updatedAt: string) {
  const steps = [
    { key: "draft", label: "Draft prepared", rank: 0 },
    { key: "pending_review", label: "Review in progress", rank: 1 },
    { key: "approved", label: "Approved", rank: 2 },
    { key: "signed", label: "Signed", rank: 3 },
    { key: "registered", label: "Registered", rank: 4 },
  ] as const;

  const statusRank: Record<LegalWorkflowStatus, number> = {
    draft: 0,
    pending_review: 1,
    approved: 2,
    signed: 3,
    registered: 4,
    rejected: 1,
  };

  return steps.map((step) => ({
    key: step.key,
    label: step.label,
    completed: step.rank <= statusRank[status],
    timestamp: step.rank <= statusRank[status] ? updatedAt : undefined,
  }));
}

function queueMutation(store: StoredBundle, mutation: SyncMutation) {
  store.syncQueue.unshift(mutation);
  store.syncMeta.pendingMutations = store.syncQueue.length;
}

async function pickVisionModel() {
  try {
    const { data } = await listLLMModels();
    return data.find((model) => model.id === "gpt-5-mini")?.id ?? data.find((model) => model.id === "gemini-3-flash-preview")?.id ?? data[0]?.id ?? "gpt-5-mini";
  } catch {
    return "gpt-5-mini";
  }
}

function inferEngineFromMime(mimeType: string, documentType: string): BusinessDocumentRecord["engine"] {
  const lowered = `${mimeType} ${documentType}`.toLowerCase();
  if (lowered.includes("pdf") || lowered.includes("incorporation")) return "docling";
  if (lowered.includes("passport") || lowered.includes("id") || lowered.includes("nin")) return "vlm";
  if (lowered.includes("image")) return "paddleocr";
  return "manual";
}

export async function analyzeDocumentImage(input: {
  fileName: string;
  mimeType: string;
  base64Data: string;
  documentType: string;
}): Promise<DocumentAnalysisResult> {
  const model = await pickVisionModel();
  const engine = inferEngineFromMime(input.mimeType, input.documentType);
  const dataUrl = `data:${input.mimeType};base64,${input.base64Data}`;

  const response = await invokeLLM({
    model,
    messages: [
      {
        role: "system",
        content:
          "You analyze land-registry KYC and KYB documents. Extract visible fields carefully, score confidence conservatively, and flag any mismatch, blur, glare, cutoff, or suspicious tampering. Respond with strict JSON.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Document type hint: ${input.documentType}. File name: ${input.fileName}. Extract the visible fields and assess whether this is suitable for KYC/KYB review.` },
          { type: "image_url", image_url: { url: dataUrl, detail: "auto" } },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "document_analysis",
        strict: true,
        schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            confidence: { type: "number" },
            needsAttention: { type: "boolean" },
            extractedFields: {
              type: "object",
              properties: {
                fullName: { type: "string" },
                companyName: { type: "string" },
                idNumber: { type: "string" },
                registrationNumber: { type: "string" },
                taxId: { type: "string" },
                address: { type: "string" },
              },
              required: ["fullName", "companyName", "idNumber", "registrationNumber", "taxId", "address"],
              additionalProperties: false,
            },
          },
          required: ["summary", "confidence", "needsAttention", "extractedFields"],
          additionalProperties: false,
        },
      },
    },
    maxTokens: 1200,
  });

  const content = response.choices[0]?.message.content;
  const parsed = typeof content === "string" ? JSON.parse(content) : JSON.parse((content?.[0] as { text?: string })?.text ?? "{}");
  const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 0)));

  return {
    engine,
    confidence,
    summary: parsed.summary,
    status: confidence >= 86 && !parsed.needsAttention ? "verified" : confidence >= 65 ? "requires_review" : "rejected",
    extractedFields: parsed.extractedFields,
    needsAttention: Boolean(parsed.needsAttention),
  };
}

export async function analyzeLivenessSelfie(input: { base64Data: string; mimeType: string }) {
  const model = await pickVisionModel();
  const dataUrl = `data:${input.mimeType};base64,${input.base64Data}`;

  const response = await invokeLLM({
    model,
    messages: [
      {
        role: "system",
        content:
          "You analyze a selfie for liveness screening in a land-registry onboarding flow. Estimate visible human presence, face clarity, motion cues implied by the capture context, and spoof risk conservatively. Return strict JSON only.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Assess whether the selfie appears suitable for liveness verification. Estimate motion score, face quality, face match plausibility, and spoof risk conservatively." },
          { type: "image_url", image_url: { url: dataUrl, detail: "auto" } },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "liveness_analysis",
        strict: true,
        schema: {
          type: "object",
          properties: {
            motionScore: { type: "number" },
            faceQualityScore: { type: "number" },
            faceMatchScore: { type: "number" },
            spoofDetected: { type: "boolean" },
            notes: { type: "string" },
          },
          required: ["motionScore", "faceQualityScore", "faceMatchScore", "spoofDetected", "notes"],
          additionalProperties: false,
        },
      },
    },
    maxTokens: 900,
  });

  const content = response.choices[0]?.message.content;
  const parsed = typeof content === "string" ? JSON.parse(content) : JSON.parse((content?.[0] as { text?: string })?.text ?? "{}");
  const motionScore = Math.max(0, Math.min(100, Math.round(Number(parsed.motionScore) || 0)));
  const faceQualityScore = Math.max(0, Math.min(100, Math.round(Number(parsed.faceQualityScore) || 0)));
  const faceMatchScore = Math.max(0, Math.min(100, Math.round(Number(parsed.faceMatchScore) || 0)));
  const confidence = Math.round(motionScore * 0.35 + faceQualityScore * 0.3 + faceMatchScore * 0.35);

  return {
    motionScore,
    faceQualityScore,
    faceMatchScore,
    confidence,
    spoofDetected: Boolean(parsed.spoofDetected),
    notes: String(parsed.notes || ""),
    status: !parsed.spoofDetected && confidence >= 70 ? "verified" : "failed",
  } as const;
}

export function getMobilePlatformBundle() {
  const store = readStore();
  refreshReadiness(store);
  purgeResolvedMutes(store);
  store.syncMeta = buildSyncMeta(store, store.syncMeta.source);
  writeStore(store);
  return store;
}

export function syncBundleMutation(input: Partial<MobilePlatformBundle>) {
  const store = readStore();

  if (input.parcels) store.parcels = input.parcels;
  if (input.missions) store.missions = input.missions;
  if (input.legalWorkflows) store.legalWorkflows = input.legalWorkflows;
  if (input.onboarding) store.onboarding = input.onboarding;
  if (input.notificationPreferences) store.notificationPreferences = input.notificationPreferences;

  purgeResolvedMutes(store);
  store.syncMeta = buildSyncMeta(store, "live");
  writeStore(store);
  return store;
}

export function updateNotificationPreferences(input: Partial<NotificationPreferences>) {
  const store = readStore();
  store.notificationPreferences = {
    ...store.notificationPreferences,
    ...input,
    updatedAt: new Date().toISOString(),
    followedParcelIds: input.followedParcelIds ?? store.notificationPreferences.followedParcelIds,
    parcelMutes: input.parcelMutes ?? store.notificationPreferences.parcelMutes,
  };
  purgeResolvedMutes(store);
  queueMutation(store, { type: "notification_preference", recordId: "notification_preferences", queuedAt: store.notificationPreferences.updatedAt });
  store.syncMeta = buildSyncMeta(store, "live");
  writeStore(store);
  return store.notificationPreferences;
}

export function toggleParcelSubscriptionPreference(input: { parcelId: number }) {
  const store = readStore();
  const followed = store.notificationPreferences.followedParcelIds.includes(input.parcelId);
  const followedParcelIds = followed
    ? store.notificationPreferences.followedParcelIds.filter((id) => id !== input.parcelId)
    : [...store.notificationPreferences.followedParcelIds, input.parcelId].sort((a, b) => a - b);

  return updateNotificationPreferences({ followedParcelIds });
}

export function setParcelMutePreference(input: { parcelId: number; duration: ParcelMuteDuration }) {
  const store = readStore();
  const workflow = store.legalWorkflows.find((item) => item.parcelId === input.parcelId && item.status !== "registered" && item.status !== "rejected") ?? null;
  const mutedUntil =
    input.duration === "1h"
      ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
      : input.duration === "1d"
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : null;

  const parcelMutes = [
    ...store.notificationPreferences.parcelMutes.filter((item) => item.parcelId !== input.parcelId),
    {
      parcelId: input.parcelId,
      duration: input.duration,
      mutedAt: new Date().toISOString(),
      mutedUntil,
      workflowId: workflow?.id ?? null,
    },
  ];

  return updateNotificationPreferences({ parcelMutes });
}

export function clearParcelMutePreference(input: { parcelId: number }) {
  const store = readStore();
  const parcelMutes = store.notificationPreferences.parcelMutes.filter((item) => item.parcelId !== input.parcelId);
  return updateNotificationPreferences({ parcelMutes });
}

export function updateMissionStatus(input: { missionId: string; status: StoredBundle["missions"][number]["status"] }) {
  const store = readStore();
  const mission = store.missions.find((item) => item.id === input.missionId);
  if (!mission) throw new Error("Mission not found");

  mission.status = input.status;
  mission.lastUpdated = new Date().toISOString();
  queueMutation(store, { type: "mission_status", recordId: mission.id, queuedAt: mission.lastUpdated });
  store.syncMeta = buildSyncMeta(store, "live");
  writeStore(store);
  return mission;
}

export function submitBusinessProfile(input: BusinessProfileRecord) {
  const store = readStore();
  store.onboarding.businessProfile = input;
  store.onboarding.stakeholder = input.companyName ?? store.onboarding.stakeholder;
  queueMutation(store, { type: "onboarding_document", recordId: input.cacNumber ?? crypto.randomUUID(), queuedAt: new Date().toISOString() });
  refreshReadiness(store);
  store.syncMeta = buildSyncMeta(store, "live");
  writeStore(store);
  return store.onboarding;
}

export function appendIdentityDocument(document: IdentityDocumentRecord) {
  const store = readStore();
  store.onboarding.identityDocuments.unshift(document);
  queueMutation(store, { type: "onboarding_document", recordId: document.id, queuedAt: document.uploadedAt });
  refreshReadiness(store);
  store.syncMeta = buildSyncMeta(store, "live");
  writeStore(store);
  return document;
}

export function appendBusinessDocument(document: BusinessDocumentRecord) {
  const store = readStore();
  store.onboarding.businessProfile.documents.unshift(document);
  queueMutation(store, { type: "onboarding_document", recordId: String(document.id), queuedAt: document.uploadedAt });
  refreshReadiness(store);
  store.syncMeta = buildSyncMeta(store, "live");
  writeStore(store);
  return document;
}

export function startLivenessSession() {
  const store = readStore();
  const session: LivenessSessionRecord = {
    sessionId: `LIV-${Date.now()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
    challengeType: "blink_turn_smile",
    status: "pending",
    framesAnalyzed: 0,
    confidence: 0,
    spoofDetected: false,
    motionScore: 0,
    faceQualityScore: 0,
    faceMatchScore: 0,
    failureReason: null,
    createdAt: new Date().toISOString(),
    verifiedAt: null,
  };

  store.onboarding.latestLivenessSession = session;
  store.onboarding.livenessStatus = "pending";
  queueMutation(store, { type: "liveness", recordId: session.sessionId, queuedAt: session.createdAt });
  store.syncMeta = buildSyncMeta(store, "live");
  writeStore(store);
  return session;
}

export function completeLivenessSession(input: {
  sessionId: string;
  status: LivenessSessionRecord["status"];
  framesAnalyzed: number;
  motionScore: number;
  faceQualityScore: number;
  faceMatchScore: number;
  confidence: number;
  spoofDetected: boolean;
  failureReason?: string | null;
}) {
  const store = readStore();
  if (!store.onboarding.latestLivenessSession || store.onboarding.latestLivenessSession.sessionId !== input.sessionId) {
    throw new Error("Liveness session not found");
  }

  store.onboarding.latestLivenessSession = {
    ...store.onboarding.latestLivenessSession,
    status: input.status,
    framesAnalyzed: input.framesAnalyzed,
    motionScore: input.motionScore,
    faceQualityScore: input.faceQualityScore,
    faceMatchScore: input.faceMatchScore,
    confidence: input.confidence,
    spoofDetected: input.spoofDetected,
    failureReason: input.failureReason ?? null,
    verifiedAt: input.status === "verified" ? new Date().toISOString() : null,
  };
  store.onboarding.livenessStatus = input.status;
  refreshReadiness(store);
  store.syncMeta = buildSyncMeta(store, "live");
  writeStore(store);
  return store.onboarding.latestLivenessSession;
}

export function approveIdentityDocument(input: { documentId: string }) {
  const store = readStore();
  const document = store.onboarding.identityDocuments.find((item) => item.id === input.documentId);
  if (!document) throw new Error("Identity document not found");

  document.status = "verified";
  document.confidence = Math.max(document.confidence ?? 88, 88);
  document.extractedSummary = document.extractedSummary ?? "Approved from mobile inbox review.";
  queueMutation(store, { type: "onboarding_document", recordId: document.id, queuedAt: new Date().toISOString() });
  refreshReadiness(store);
  store.syncMeta = buildSyncMeta(store, "live");
  writeStore(store);

  return {
    document,
    onboarding: store.onboarding,
  };
}

export function listLegalWorkflows() {
  return readStore().legalWorkflows;
}

export function updateLegalWorkflowStatus(input: {
  workflowId: string;
  status: LegalWorkflowStatus;
  reviewedBy?: string | null;
}) {
  const store = readStore();
  const workflow = store.legalWorkflows.find((item) => item.id === input.workflowId);
  if (!workflow) throw new Error("Legal workflow not found");

  workflow.status = input.status;
  workflow.reviewedBy = input.reviewedBy ?? workflow.reviewedBy ?? null;
  workflow.updatedAt = new Date().toISOString();
  workflow.timeline = timeline(workflow.status, workflow.updatedAt);
  workflow.assignedDesk =
    input.status === "pending_review"
      ? "Verification Desk"
      : input.status === "approved"
        ? "Legal Review"
        : input.status === "signed"
          ? "Signing Desk"
          : input.status === "registered"
            ? "Registry Archive"
            : workflow.assignedDesk;

  if (input.status === "registered" && !workflow.registrationNumber) {
    const stateCode = workflow.type === "Certificate of Occupancy" ? "COFO" : workflow.type === "Right of Occupancy" ? "ROO" : "GC";
    workflow.registrationNumber = `${stateCode}-${String(workflow.parcelId).padStart(4, "0")}-${new Date().getFullYear()}-${Math.floor(1000 + workflow.parcelId)}`;
  }

  purgeResolvedMutes(store);
  queueMutation(store, { type: "legal_status", recordId: workflow.id, queuedAt: workflow.updatedAt });
  store.syncMeta = buildSyncMeta(store, "live");
  writeStore(store);
  return workflow;
}
