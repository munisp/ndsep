import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

import {
  type BusinessDocumentRecord,
  type BusinessProfileRecord,
  type IdentityDocumentRecord,
  type KybDocumentStatus,
  type LegalWorkflowRecord,
  type GeofenceTransition,
  type LegalWorkflowStatus,
  type LivenessSessionRecord,
  type MobilePlatformBundle,
  type NotificationPreferences,
  type ParcelMuteDuration,
  cloneSeedBundle,
} from "../lib/mobile-data";
import { invokeLLM, listLLMModels } from "./_core/llm";
import { convertWithDocling, verifyDojahLiveness } from "./trustProviders";

type SyncMutation = {
  type: "mission_status" | "onboarding_document" | "liveness" | "legal_status" | "notification_preference";
  recordId: string;
  queuedAt: string;
};

type StoredBundle = MobilePlatformBundle & {
  syncQueue: SyncMutation[];
  stakeholderReplayReceipts?: Array<{ idempotencyKey: string; payloadHash: string; kind: "profile" | "identity_document" | "business_document"; processedAt: string }>;
};
export type StakeholderReplayInput = {
  idempotencyKey: string;
  payloadHash: string;
  payload:
    | { kind: "profile"; profile: BusinessProfileRecord }
    | { kind: "identity_document"; type: string; fileName: string; mimeType: string; base64Data: string }
    | { kind: "business_document"; type: string; fileName: string; mimeType: string; base64Data: string };
};
const stakeholderReplayInFlight = new Map<string, { payloadHash: string; promise: Promise<{ status: "accepted" | "already_processed"; idempotencyKey: string }> }>();

type DocumentAnalysisResult = {
  engine: BusinessDocumentRecord["engine"];
  confidence: number;
  summary: string;
  status: KybDocumentStatus;
  extractedFields: Record<string, string>;
  needsAttention: boolean;
  model: string | null;
  provenance: "model_assisted" | "document_intelligence" | "unavailable";
  availability: "available" | "unavailable";
  reason: string | null;
};

type NotificationInteractionProfileInput = {
  openedByCategory: Record<string, number>;
  dismissedByCategory: Record<string, number>;
  actionedByCategory: Record<string, number>;
  unreadResolvedByCategory: Record<string, number>;
  totalOpened: number;
  totalDismissed: number;
  totalActioned: number;
  totalUnreadResolved: number;
  preferredCategories: string[];
};

type NotificationAnalysisInput = {
  id: string;
  title: string;
  description: string;
  category: string;
  tone: string;
  unread: boolean;
  parcelNumber?: string | null;
  actionLabel?: string | null;
  auditTrailSummary?: string | null;
};

type NotificationAnalysisResult = {
  id: string;
  summary: string;
  priorityLevel: "low" | "medium" | "high";
  priorityScore: number;
  rationale: string;
  interactionWeight: number;
  model: string | null;
  provenance: "model" | "rule_based" | "unavailable";
  availability: "available" | "unavailable";
  reason: string | null;
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
    stakeholderReplayReceipts: [],
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
      geofenceSubscriptions: parsed.notificationPreferences?.geofenceSubscriptions ?? defaultStore().notificationPreferences.geofenceSubscriptions,
    };
    parsed.stakeholderReplayReceipts = parsed.stakeholderReplayReceipts ?? [];
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
    const model = data.find((item) => item.id === "gpt-5-mini")?.id ?? data.find((item) => item.id === "gemini-3-flash-preview")?.id ?? data[0]?.id ?? null;
    return { model, reason: model ? null : "No vision-capable model is configured." };
  } catch (error) {
    return { model: null, reason: `Model catalog unavailable: ${error instanceof Error ? error.message : "unknown error"}` };
  }
}

async function pickNotificationAnalysisModel() {
  try {
    const { data } = await listLLMModels();
    const model = data.find((item) => item.id === "gpt-5-mini")?.id ?? data.find((item) => item.id === "claude-haiku-4-5")?.id ?? data[0]?.id ?? null;
    return { model, reason: model ? null : "No notification-analysis model is configured." };
  } catch (error) {
    return { model: null, reason: `Model catalog unavailable: ${error instanceof Error ? error.message : "unknown error"}` };
  }
}

function fallbackNotificationAnalysis(item: NotificationAnalysisInput, profile: NotificationInteractionProfileInput, reason: string): NotificationAnalysisResult {
  const opens = profile.openedByCategory[item.category] ?? 0;
  const actions = profile.actionedByCategory[item.category] ?? 0;
  const dismisses = profile.dismissedByCategory[item.category] ?? 0;
  const interactionWeight = Math.max(0, Math.min(1, 0.45 + opens * 0.06 + actions * 0.08 - dismisses * 0.05));
  const priorityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(28 + (item.unread ? 18 : 0) + (item.actionLabel ? 14 : 0) + (item.tone === "warning" ? 18 : item.tone === "success" ? 4 : 10) + interactionWeight * 24),
    ),
  );
  const priorityLevel = priorityScore >= 80 ? "high" : priorityScore >= 55 ? "medium" : "low";
  const summary = `${item.title}: ${item.description}`.slice(0, 180);
  const rationale = `${item.category} alerts receive ${opens > dismisses ? "strong" : "moderate"} attention from recent user behavior, so this item is ranked ${priorityLevel}.`;
  return {
    id: item.id,
    summary: `Rule-based summary: ${summary}`,
    priorityLevel,
    priorityScore,
    rationale: `${rationale} Automated model analysis is unavailable; this rank is deterministic and requires operator judgment.`,
    interactionWeight: Number(interactionWeight.toFixed(2)),
    model: null,
    provenance: "rule_based",
    availability: "unavailable",
    reason,
  };
}

export async function analyzeNotificationActivities(input: {
  activities: NotificationAnalysisInput[];
  interactionProfile: NotificationInteractionProfileInput;
}) {
  if (input.activities.length === 0) return [] as NotificationAnalysisResult[];
  const modelChoice = await pickNotificationAnalysisModel();

  return Promise.all(
    input.activities.map(async (item) => {
      if (!modelChoice.model) {
        return fallbackNotificationAnalysis(item, input.interactionProfile, modelChoice.reason ?? "Model analysis is unavailable.");
      }
      try {
        const response = await invokeLLM({
          model: modelChoice.model,
          messages: [
            {
              role: "system",
              content:
                "You prioritize land-registry mobile alerts for field officers. Produce concise summaries, score urgency from 0 to 100, and consider recent user interaction history when ranking what should appear first in the inbox.",
            },
            {
              role: "user",
              content: JSON.stringify({
                interactionProfile: input.interactionProfile,
                alert: item,
                instructions: {
                  summary: "Summarize the alert in at most two sentences for a mobile notification detail sheet.",
                  priority: "Return a priority level and numeric score that reflects urgency, unread status, user habits, and whether the alert has an action.",
                },
              }),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "notification_analysis",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  summary: { type: "string" },
                  priorityLevel: { type: "string", enum: ["low", "medium", "high"] },
                  priorityScore: { type: "number" },
                  rationale: { type: "string" },
                  interactionWeight: { type: "number" },
                },
                required: ["summary", "priorityLevel", "priorityScore", "rationale", "interactionWeight"],
                additionalProperties: false,
              },
            },
          },
          maxTokens: 500,
        });
        const content = response.choices[0]?.message.content;
        const parsed = typeof content === "string" ? JSON.parse(content) : JSON.parse((content?.[0] as { text?: string })?.text ?? "{}");
        return {
          id: item.id,
          summary: String(parsed.summary ?? item.description).slice(0, 220),
          priorityLevel: parsed.priorityLevel === "high" || parsed.priorityLevel === "medium" ? parsed.priorityLevel : "low",
          priorityScore: Math.max(0, Math.min(100, Math.round(Number(parsed.priorityScore) || 0))),
          rationale: String(parsed.rationale ?? "AI analysis completed for this alert."),
          interactionWeight: Math.max(0, Math.min(1, Number(parsed.interactionWeight) || 0)),
          model: modelChoice.model,
          provenance: "model",
          availability: "available",
          reason: null,
        } satisfies NotificationAnalysisResult;
      } catch (error) {
        return fallbackNotificationAnalysis(item, input.interactionProfile, `Model analysis failed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }),
  );
}

export async function analyzeDocumentImage(input: {
  fileName: string;
  mimeType: string;
  base64Data: string;
  documentType: string;
}): Promise<DocumentAnalysisResult> {
  const docling = await convertWithDocling(input);
  if (docling.state === "ready") {
    return {
      engine: "docling",
      confidence: 0,
      summary: `Docling converted ${docling.value.text.length.toLocaleString()} characters from ${input.fileName}. No identity, business, or registry claim is verified by document conversion alone.`,
      status: "requires_review",
      extractedFields: {},
      needsAttention: true,
      model: null,
      provenance: "document_intelligence",
      availability: "available",
      reason: "Docling document intelligence completed conversion. An authorized reviewer must compare the original document and independently validate all extracted claims.",
    };
  }
  if (docling.state === "failed") {
    return {
      engine: "docling",
      confidence: 0,
      summary: "Document intelligence failed. No fallback parser or model output was substituted.",
      status: "unavailable",
      extractedFields: {},
      needsAttention: true,
      model: null,
      provenance: "unavailable",
      availability: "unavailable",
      reason: docling.reason,
    };
  }
  const modelChoice = await pickVisionModel();
  const unavailable = (reason: string): DocumentAnalysisResult => ({
    engine: "vision_llm",
    confidence: 0,
    summary: "Automated document screening is unavailable. The file was not verified and requires an authorized manual review.",
    status: "unavailable",
    extractedFields: {},
    needsAttention: true,
    model: null,
    provenance: "unavailable",
    availability: "unavailable",
    reason,
  });
  if (!modelChoice.model) return unavailable(modelChoice.reason ?? "No vision model is configured.");
  const dataUrl = `data:${input.mimeType};base64,${input.base64Data}`;

  try {
    const response = await invokeLLM({
    model: modelChoice.model,
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
      engine: "vision_llm",
      confidence,
      summary: String(parsed.summary || "Model-assisted screening completed. An authorized reviewer must validate the document."),
      status: "requires_review",
      extractedFields: Object.entries(parsed.extractedFields ?? {}).reduce<Record<string, string>>((fields, [key, value]) => {
        if (typeof value === "string" && value.trim().length > 0) fields[key] = value.trim();
        return fields;
      }, {}),
      needsAttention: true,
      model: modelChoice.model,
      provenance: "model_assisted",
      availability: "available",
      reason: "Automated image analysis is assistive only and cannot verify KYC/KYB identity or registry authority.",
    };
  } catch (error) {
    return unavailable(`Model document screening failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

export async function analyzeLivenessSelfie(input: { base64Data: string; mimeType: string }) {
  const provider = await verifyDojahLiveness({ base64Data: input.base64Data });
  if (provider.state === "ready") {
    const probability = provider.value.probability ?? 0;
    return {
      motionScore: 0,
      faceQualityScore: 0,
      faceMatchScore: 0,
      confidence: probability,
      spoofDetected: !provider.value.passed,
      notes: provider.value.passed
        ? "The configured liveness provider reported an image liveness pass. This is not an identity match, a NIN validation, or a completed multi-step video challenge; authorized review remains required."
        : "The configured liveness provider reported a liveness failure. Do not approve onboarding from this capture.",
      status: provider.value.passed ? ("requires_review" as const) : ("failed" as const),
      verificationMethod: "provider_liveness_image" as const,
      availabilityReason: "Provider-backed image liveness response. Identity and registry verification remain separate required controls.",
    };
  }
  if (provider.state === "failed") {
    return {
      motionScore: 0,
      faceQualityScore: 0,
      faceMatchScore: 0,
      confidence: 0,
      spoofDetected: false,
      notes: "Liveness was not verified because the configured provider failed. No model fallback was substituted.",
      status: "unavailable" as const,
      verificationMethod: "unavailable" as const,
      availabilityReason: provider.reason,
    };
  }
  const modelChoice = await pickVisionModel();
  const unavailable = (reason: string) => ({
    motionScore: 0,
    faceQualityScore: 0,
    faceMatchScore: 0,
    confidence: 0,
    spoofDetected: false,
    notes: "Liveness was not verified because the automated screening service is unavailable.",
    status: "unavailable" as const,
    verificationMethod: "unavailable" as const,
    availabilityReason: reason,
  });
  if (!modelChoice.model) return unavailable(modelChoice.reason ?? "No vision model is configured.");
  const dataUrl = `data:${input.mimeType};base64,${input.base64Data}`;

  try {
    const response = await invokeLLM({
    model: modelChoice.model,
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
      notes: `${String(parsed.notes || "")}${parsed.spoofDetected ? "" : " Single-image screening cannot verify a blink-turn-smile challenge; capture challenge video and complete authorized review."}`.trim(),
      status: "requires_review" as const,
      verificationMethod: "single_image_screening" as const,
      availabilityReason: "A single still image cannot prove liveness or complete a multi-step motion challenge.",
    };
  } catch (error) {
    return unavailable(`Model liveness screening failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
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
    geofenceSubscriptions: input.geofenceSubscriptions ?? store.notificationPreferences.geofenceSubscriptions,
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

  const geofenceSubscriptions = followed
    ? store.notificationPreferences.geofenceSubscriptions.filter((item) => item.parcelId !== input.parcelId)
    : store.notificationPreferences.geofenceSubscriptions.some((item) => item.parcelId === input.parcelId)
      ? store.notificationPreferences.geofenceSubscriptions
      : [
          ...store.notificationPreferences.geofenceSubscriptions,
          {
            parcelId: input.parcelId,
            radiusMeters: 150,
            transition: "both" as const,
            enabled: true,
            lastTriggeredAt: null,
            lastTransition: null,
          },
        ];

  return updateNotificationPreferences({ followedParcelIds, geofenceSubscriptions });
}

export function updateParcelGeofencePreference(input: {
  parcelId: number;
  enabled?: boolean;
  radiusMeters?: number;
  transition?: GeofenceTransition;
  lastTriggeredAt?: string | null;
  lastTransition?: "enter" | "exit" | null;
}) {
  const store = readStore();
  const existing = store.notificationPreferences.geofenceSubscriptions.find((item) => item.parcelId === input.parcelId);
  const geofenceSubscriptions = [
    ...store.notificationPreferences.geofenceSubscriptions.filter((item) => item.parcelId !== input.parcelId),
    {
      parcelId: input.parcelId,
      radiusMeters: input.radiusMeters ?? existing?.radiusMeters ?? 150,
      transition: input.transition ?? existing?.transition ?? "both",
      enabled: input.enabled ?? existing?.enabled ?? true,
      lastTriggeredAt: input.lastTriggeredAt ?? existing?.lastTriggeredAt ?? null,
      lastTransition: input.lastTransition ?? existing?.lastTransition ?? null,
    },
  ].sort((a, b) => a.parcelId - b.parcelId);

  return updateNotificationPreferences({ geofenceSubscriptions });
}

export function reconcileParcelGeofenceReplay(input: {
  parcelId: number;
  transition: "enter" | "exit";
  radiusMeters: number;
  latitude: number;
  longitude: number;
  triggeredAt: string;
}) {
  const store = readStore();
  const existing = store.notificationPreferences.geofenceSubscriptions.find((item) => item.parcelId === input.parcelId) ?? {
    parcelId: input.parcelId,
    radiusMeters: input.radiusMeters,
    transition: "both" as const,
    enabled: true,
    lastTriggeredAt: null,
    lastTransition: null,
  };

  const existingTimestamp = existing.lastTriggeredAt ? new Date(existing.lastTriggeredAt).getTime() : null;
  const incomingTimestamp = new Date(input.triggeredAt).getTime();

  if (existingTimestamp && existing.lastTransition === input.transition && Math.abs(existingTimestamp - incomingTimestamp) <= 60_000) {
    return {
      status: "duplicate" as const,
      geofenceSubscription: existing,
    };
  }

  if (existingTimestamp && existingTimestamp > incomingTimestamp) {
    return {
      status: "stale" as const,
      geofenceSubscription: existing,
    };
  }

  store.notificationPreferences.geofenceSubscriptions = [
    ...store.notificationPreferences.geofenceSubscriptions.filter((item) => item.parcelId !== input.parcelId),
    {
      ...existing,
      radiusMeters: input.radiusMeters || existing.radiusMeters,
      lastTriggeredAt: input.triggeredAt,
      lastTransition: input.transition,
      enabled: true,
    },
  ].sort((a, b) => a.parcelId - b.parcelId);
  store.notificationPreferences.updatedAt = new Date().toISOString();
  store.syncMeta = buildSyncMeta(store, "live");
  writeStore(store);

  return {
    status: "accepted" as const,
    geofenceSubscription: store.notificationPreferences.geofenceSubscriptions.find((item) => item.parcelId === input.parcelId) ?? existing,
  };
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

function canonicalReplayJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalReplayJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalReplayJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function stakeholderPayloadHash(payload: StakeholderReplayInput["payload"]) { return crypto.createHash("sha256").update(canonicalReplayJson(payload)).digest("hex"); }
function existingReplayReceipt(store: StoredBundle, key: string, hash: string) {
  const receipt = store.stakeholderReplayReceipts?.find((item) => item.idempotencyKey === key);
  if (receipt && receipt.payloadHash !== hash) throw new Error("IDEMPOTENCY_KEY_COLLISION");
  return receipt;
}
function recordReplayReceipt(store: StoredBundle, input: StakeholderReplayInput) {
  store.stakeholderReplayReceipts = [{ idempotencyKey: input.idempotencyKey, payloadHash: input.payloadHash, kind: input.payload.kind, processedAt: new Date().toISOString() }, ...(store.stakeholderReplayReceipts ?? [])].slice(0, 1000);
}
async function executeStakeholderReplay(input: StakeholderReplayInput): Promise<{ status: "accepted" | "already_processed"; idempotencyKey: string }> {
  if (stakeholderPayloadHash(input.payload) !== input.payloadHash) throw new Error("IDEMPOTENCY_PAYLOAD_HASH_MISMATCH");
  const initialStore = readStore();
  if (existingReplayReceipt(initialStore, input.idempotencyKey, input.payloadHash)) return { status: "already_processed", idempotencyKey: input.idempotencyKey };
  if (input.payload.kind === "profile") {
    initialStore.onboarding.businessProfile = input.payload.profile;
    initialStore.onboarding.stakeholder = input.payload.profile.companyName ?? initialStore.onboarding.stakeholder;
    queueMutation(initialStore, { type: "onboarding_document", recordId: input.idempotencyKey, queuedAt: new Date().toISOString() });
    recordReplayReceipt(initialStore, input); refreshReadiness(initialStore); initialStore.syncMeta = buildSyncMeta(initialStore, "live"); writeStore(initialStore);
    return { status: "accepted", idempotencyKey: input.idempotencyKey };
  }
  const analysis = await analyzeDocumentImage({ ...input.payload, documentType: input.payload.type });
  const store = readStore();
  if (existingReplayReceipt(store, input.idempotencyKey, input.payloadHash)) return { status: "already_processed", idempotencyKey: input.idempotencyKey };
  const uploadedAt = new Date().toISOString();
  if (input.payload.kind === "identity_document") {
    store.onboarding.identityDocuments.unshift({ id: `identity-${input.idempotencyKey}`, type: input.payload.type, fileName: input.payload.fileName, status: analysis.status, extractedSummary: analysis.summary, confidence: analysis.confidence, engine: analysis.engine, analysisProvenance: analysis.provenance, analysisReason: analysis.reason, uploadedAt });
  } else {
    const id = Number.parseInt(input.idempotencyKey.replace(/-/g, "").slice(0, 8), 16) % 2_000_000_000;
    store.onboarding.businessProfile.documents.unshift({ id, type: input.payload.type, fileName: input.payload.fileName, documentUrl: null, status: analysis.status, engine: analysis.engine, confidence: analysis.confidence, extractedSummary: analysis.summary, analysisProvenance: analysis.provenance, analysisReason: analysis.reason, uploadedAt });
  }
  queueMutation(store, { type: "onboarding_document", recordId: input.idempotencyKey, queuedAt: uploadedAt });
  recordReplayReceipt(store, input); refreshReadiness(store); store.syncMeta = buildSyncMeta(store, "live"); writeStore(store);
  return { status: "accepted", idempotencyKey: input.idempotencyKey };
}
export async function replayStakeholderSubmission(input: StakeholderReplayInput) {
  const inFlight = stakeholderReplayInFlight.get(input.idempotencyKey);
  if (inFlight) {
    if (inFlight.payloadHash !== input.payloadHash) throw new Error("IDEMPOTENCY_KEY_COLLISION");
    return inFlight.promise;
  }
  const promise = executeStakeholderReplay(input).finally(() => stakeholderReplayInFlight.delete(input.idempotencyKey));
  stakeholderReplayInFlight.set(input.idempotencyKey, { payloadHash: input.payloadHash, promise });
  return promise;
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
  verificationMethod?: LivenessSessionRecord["verificationMethod"];
  availabilityReason?: string | null;
}) {
  const store = readStore();
  if (!store.onboarding.latestLivenessSession || store.onboarding.latestLivenessSession.sessionId !== input.sessionId) {
    throw new Error("Liveness session not found");
  }

  if (input.status === "verified" && input.verificationMethod !== "challenge_video") {
    throw new Error("Liveness cannot be marked verified without a completed challenge-video verification method.");
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
    verificationMethod: input.verificationMethod ?? "unavailable",
    availabilityReason: input.availabilityReason ?? null,
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

  document.status = "requires_review";
  document.analysisProvenance = "manual_review";
  document.analysisReason = "A manual review was requested from the inbox. This action does not verify identity, NIN, BVN, CAC, TIN, or document authenticity.";
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
  registryReference?: string | null;
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

  if (input.status === "registered" && !input.registryReference && !workflow.registrationNumber) {
    throw new Error("An official registry reference is required before a legal workflow can be recorded as registered.");
  }
  if (input.status === "registered" && input.registryReference) {
    workflow.registrationNumber = input.registryReference;
  }

  purgeResolvedMutes(store);
  queueMutation(store, { type: "legal_status", recordId: workflow.id, queuedAt: workflow.updatedAt });
  store.syncMeta = buildSyncMeta(store, "live");
  writeStore(store);
  return workflow;
}
