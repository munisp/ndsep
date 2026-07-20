export type ParcelRecord = {
  id: number;
  parcelNumber: string;
  owner: string;
  state: string;
  lga: string;
  areaHectares: number;
  titleStatus: "registered" | "pending" | "under_review";
  workflowStage: "survey" | "verification" | "issuance" | "registered";
  latitude: number;
  longitude: number;
  riskScore: number;
  lastAction: string;
  geolibreReady: boolean;
};

export type MissionRecord = {
  id: string;
  parcelId: number;
  title: string;
  status: "queued" | "active" | "synced";
  syncRisk: "low" | "moderate" | "high";
  evidenceCount: number;
  lastUpdated: string;
};

export type IdentityStatus = "verified" | "pending" | "failed";
export type OnboardingStatus = "draft" | "in_review" | "verified" | "needs_attention";
export type KybDocumentStatus = "pending" | "verified" | "rejected" | "requires_review";
export type KybEngine = "paddleocr" | "vlm" | "docling" | "tesseract_fallback" | "manual";
export type LivenessStatus = "pending" | "verified" | "failed";

export type OnboardingChecklistItem = {
  key: string;
  label: string;
  completed: boolean;
};

export type IdentityDocumentRecord = {
  id: string;
  type: string;
  fileName: string;
  status: KybDocumentStatus;
  extractedSummary?: string;
  confidence?: number;
  engine?: KybEngine;
  uploadedAt: string;
};

export type BusinessDocumentRecord = {
  id: number;
  type: string;
  fileName: string;
  documentUrl?: string | null;
  status: KybDocumentStatus;
  engine?: KybEngine;
  confidence?: number | null;
  extractedSummary?: string | null;
  uploadedAt: string;
};

export type BusinessProfileRecord = {
  stakeholderType: "individual" | "business";
  companyName: string | null;
  cacNumber: string | null;
  tinNumber: string | null;
  businessEmail: string | null;
  businessPhone: string | null;
  businessAddress: string | null;
  contactPerson: string | null;
  onboardingStatus: OnboardingStatus;
  cacStatus: IdentityStatus;
  tinStatus: IdentityStatus;
  submittedAt: string | null;
  verifiedAt: string | null;
  documents: BusinessDocumentRecord[];
};

export type LivenessSessionRecord = {
  sessionId: string;
  challengeType: "blink_turn_smile";
  status: LivenessStatus;
  framesAnalyzed: number;
  confidence: number;
  spoofDetected: boolean;
  motionScore: number;
  faceQualityScore: number;
  faceMatchScore: number;
  failureReason?: string | null;
  createdAt: string;
  verifiedAt: string | null;
};

export type OnboardingRecord = {
  stakeholder: string;
  readiness: number;
  ninStatus: IdentityStatus;
  bvnStatus: IdentityStatus;
  livenessStatus: LivenessStatus;
  kybStatus: IdentityStatus | "in_review";
  nextAction: string;
  onboardingStatus: OnboardingStatus;
  checklist: OnboardingChecklistItem[];
  identityDocuments: IdentityDocumentRecord[];
  businessProfile: BusinessProfileRecord;
  latestLivenessSession: LivenessSessionRecord | null;
};

export type LegalWorkflowStatus = "draft" | "pending_review" | "approved" | "signed" | "registered" | "rejected";

export type LegalWorkflowTimelineEntry = {
  key: string;
  label: string;
  completed: boolean;
  timestamp?: string;
};

export type LegalWorkflowRecord = {
  id: string;
  parcelId: number;
  transactionId: string;
  type: "Certificate of Occupancy" | "Right of Occupancy" | "Governor Consent";
  status: LegalWorkflowStatus;
  registrationNumber?: string;
  assignedDesk: string;
  preparedBy: string;
  reviewedBy?: string | null;
  updatedAt: string;
  timeline: LegalWorkflowTimelineEntry[];
};

export type SyncMeta = {
  source: "seed" | "live" | "offline_cache";
  lastSyncedAt: string | null;
  pendingMutations: number;
  offlineReady: boolean;
};

export type MobilePlatformBundle = {
  parcels: ParcelRecord[];
  missions: MissionRecord[];
  onboarding: OnboardingRecord;
  legalWorkflows: LegalWorkflowRecord[];
  syncMeta: SyncMeta;
};

function timeline(status: LegalWorkflowStatus, updatedAt: string): LegalWorkflowTimelineEntry[] {
  const order: Array<{ key: string; label: string; state: LegalWorkflowStatus }> = [
    { key: "draft", label: "Draft prepared", state: "draft" },
    { key: "pending_review", label: "Review in progress", state: "pending_review" },
    { key: "approved", label: "Approved", state: "approved" },
    { key: "signed", label: "Signed", state: "signed" },
    { key: "registered", label: "Registered", state: "registered" },
  ];

  const statusRank: Record<LegalWorkflowStatus, number> = {
    draft: 0,
    pending_review: 1,
    approved: 2,
    signed: 3,
    registered: 4,
    rejected: 1,
  };

  return order.map((item, index) => ({
    key: item.key,
    label: item.label,
    completed: index <= statusRank[status],
    timestamp: index <= statusRank[status] ? updatedAt : undefined,
  }));
}

export const seedPlatformBundle: MobilePlatformBundle = {
  parcels: [
    {
      id: 6,
      parcelNumber: "LG-EPE-2026-006",
      owner: "Amina Yusuf",
      state: "Lagos",
      lga: "Epe",
      areaHectares: 1.42,
      titleStatus: "registered",
      workflowStage: "registered",
      latitude: 6.583,
      longitude: 3.983,
      riskScore: 18,
      lastAction: "GeoLibre parcel review prepared",
      geolibreReady: true,
    },
    {
      id: 11,
      parcelNumber: "FC-AMAC-2026-011",
      owner: "Crest Holdings Ltd",
      state: "FCT",
      lga: "AMAC",
      areaHectares: 2.75,
      titleStatus: "pending",
      workflowStage: "issuance",
      latitude: 9.0765,
      longitude: 7.3986,
      riskScore: 42,
      lastAction: "Stakeholder onboarding still in progress",
      geolibreReady: true,
    },
    {
      id: 15,
      parcelNumber: "KN-NASS-2026-015",
      owner: "Musa Garba",
      state: "Kano",
      lga: "Nassarawa",
      areaHectares: 0.88,
      titleStatus: "under_review",
      workflowStage: "verification",
      latitude: 11.988,
      longitude: 8.525,
      riskScore: 27,
      lastAction: "Field evidence queued for sync",
      geolibreReady: false,
    },
  ],
  missions: [
    {
      id: "mission-epe-6",
      parcelId: 6,
      title: "Boundary validation and issuance confirmation",
      status: "active",
      syncRisk: "low",
      evidenceCount: 5,
      lastUpdated: "2026-07-20T03:00:00Z",
    },
    {
      id: "mission-amac-11",
      parcelId: 11,
      title: "Corporate ownership verification package",
      status: "queued",
      syncRisk: "moderate",
      evidenceCount: 2,
      lastUpdated: "2026-07-20T01:30:00Z",
    },
    {
      id: "mission-kano-15",
      parcelId: 15,
      title: "Field evidence recovery and sync review",
      status: "queued",
      syncRisk: "high",
      evidenceCount: 3,
      lastUpdated: "2026-07-19T18:45:00Z",
    },
  ],
  onboarding: {
    stakeholder: "Crest Holdings Ltd",
    readiness: 76,
    ninStatus: "verified",
    bvnStatus: "verified",
    livenessStatus: "pending",
    kybStatus: "in_review",
    nextAction: "Complete liveness verification and upload incorporation evidence for parcel 11.",
    onboardingStatus: "in_review",
    checklist: [
      { key: "nin", label: "NIN verification", completed: true },
      { key: "bvn", label: "BVN verification", completed: true },
      { key: "liveness", label: "Liveness verification", completed: false },
      { key: "kyc_documents", label: "KYC documents", completed: true },
      { key: "cac", label: "CAC verification", completed: true },
      { key: "tin", label: "TIN verification", completed: false },
      { key: "kyb_documents", label: "KYB documents", completed: true },
    ],
    identityDocuments: [
      {
        id: "nin-slip-1",
        type: "National Identification Slip",
        fileName: "amina-nin-slip.jpg",
        status: "verified",
        confidence: 94,
        engine: "vlm",
        extractedSummary: "NIN slip verified for Amina Yusuf.",
        uploadedAt: "2026-07-19T15:30:00Z",
      },
      {
        id: "utility-1",
        type: "Proof of Address",
        fileName: "amina-utility-bill.jpg",
        status: "verified",
        confidence: 88,
        engine: "paddleocr",
        extractedSummary: "Address evidence aligned to parcel region.",
        uploadedAt: "2026-07-19T15:42:00Z",
      },
    ],
    businessProfile: {
      stakeholderType: "business",
      companyName: "Crest Holdings Limited",
      cacNumber: "RC1234567",
      tinNumber: "12345678-0001",
      businessEmail: "compliance@crestholdings.example",
      businessPhone: "+234 803 555 0199",
      businessAddress: "12 Admiralty Way, Lekki Phase 1, Lagos",
      contactPerson: "Amina Bello",
      onboardingStatus: "in_review",
      cacStatus: "verified",
      tinStatus: "failed",
      submittedAt: "2026-07-18T10:00:00.000Z",
      verifiedAt: null,
      documents: [
        {
          id: 1,
          type: "Certificate of Incorporation",
          fileName: "crest-holdings-cac.pdf",
          documentUrl: "https://storage.idlr.local/onboarding/crest-holdings-cac.pdf",
          status: "verified",
          engine: "docling",
          confidence: 94,
          extractedSummary: "Certificate of Incorporation for Crest Holdings Limited with RC1234567.",
          uploadedAt: "2026-07-18T10:05:00.000Z",
        },
        {
          id: 2,
          type: "Tax Identification Letter",
          fileName: "crest-holdings-tin.pdf",
          documentUrl: "https://storage.idlr.local/onboarding/crest-holdings-tin.pdf",
          status: "requires_review",
          engine: "paddleocr",
          confidence: 79,
          extractedSummary: "TIN letter uploaded, awaiting compliance confirmation.",
          uploadedAt: "2026-07-18T10:08:00.000Z",
        },
      ],
    },
    latestLivenessSession: null,
  },
  legalWorkflows: [
    {
      id: "cofo-epe-6",
      parcelId: 6,
      transactionId: "TXN-LG-EPE-006",
      type: "Certificate of Occupancy",
      status: "registered",
      registrationNumber: "COFO-LA-EPE-2026-0006",
      assignedDesk: "Issuance Desk",
      preparedBy: "Registry Legal Unit",
      reviewedBy: "Senior Registrar",
      updatedAt: "2026-07-20T02:10:00Z",
      timeline: timeline("registered", "2026-07-20T02:10:00Z"),
    },
    {
      id: "roo-amac-11",
      parcelId: 11,
      transactionId: "TXN-FC-AMAC-011",
      type: "Right of Occupancy",
      status: "approved",
      assignedDesk: "Legal Review",
      preparedBy: "AMAC Land Desk",
      reviewedBy: "Registry Counsel",
      updatedAt: "2026-07-20T01:20:00Z",
      timeline: timeline("approved", "2026-07-20T01:20:00Z"),
    },
    {
      id: "gc-kano-15",
      parcelId: 15,
      transactionId: "TXN-KN-NASS-015",
      type: "Governor Consent",
      status: "pending_review",
      assignedDesk: "Verification Desk",
      preparedBy: "Kano State Title Office",
      reviewedBy: null,
      updatedAt: "2026-07-19T19:00:00Z",
      timeline: timeline("pending_review", "2026-07-19T19:00:00Z"),
    },
  ],
  syncMeta: {
    source: "seed",
    lastSyncedAt: null,
    pendingMutations: 0,
    offlineReady: true,
  },
};

export const parcels = seedPlatformBundle.parcels;
export const missions = seedPlatformBundle.missions;
export const onboarding = seedPlatformBundle.onboarding;
export const legalWorkflows = seedPlatformBundle.legalWorkflows;

export function cloneSeedBundle(): MobilePlatformBundle {
  return JSON.parse(JSON.stringify(seedPlatformBundle)) as MobilePlatformBundle;
}

export function findParcel(parcelId: number, source: ParcelRecord[] = parcels) {
  return source.find((parcel) => parcel.id === parcelId) ?? source[0];
}

export function findMissionByParcel(parcelId: number, source: MissionRecord[] = missions) {
  return source.find((mission) => mission.parcelId === parcelId);
}

export function findWorkflowByParcel(parcelId: number, source: LegalWorkflowRecord[] = legalWorkflows) {
  return source.find((workflow) => workflow.parcelId === parcelId);
}
