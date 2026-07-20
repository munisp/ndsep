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

export type ParcelMuteDuration = "1h" | "1d" | "until_workflow_completion";
export type GeofenceTransition = "enter" | "exit" | "both";

export type ParcelMuteRule = {
  parcelId: number;
  duration: ParcelMuteDuration;
  mutedAt: string;
  mutedUntil: string | null;
  workflowId?: string | null;
};

export type ParcelGeofenceSubscription = {
  parcelId: number;
  radiusMeters: number;
  transition: GeofenceTransition;
  enabled: boolean;
  lastTriggeredAt: string | null;
  lastTransition: "enter" | "exit" | null;
};

export type NotificationPreferences = {
  pushEnabled: boolean;
  fieldAlerts: boolean;
  onboardingAlerts: boolean;
  legalAlerts: boolean;
  geospatialAlerts: boolean;
  geofenceAlerts: boolean;
  onlyAssignedParcels: boolean;
  followedParcelIds: number[];
  parcelMutes: ParcelMuteRule[];
  geofenceSubscriptions: ParcelGeofenceSubscription[];
  updatedAt: string;
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
  notificationPreferences: NotificationPreferences;
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

export const defaultNotificationPreferences: NotificationPreferences = {
  pushEnabled: true,
  fieldAlerts: true,
  onboardingAlerts: true,
  legalAlerts: true,
  geospatialAlerts: true,
  geofenceAlerts: true,
  onlyAssignedParcels: false,
  followedParcelIds: [6, 11],
  parcelMutes: [],
  geofenceSubscriptions: [
    {
      parcelId: 6,
      radiusMeters: 150,
      transition: "both",
      enabled: true,
      lastTriggeredAt: null,
      lastTransition: null,
    },
    {
      parcelId: 11,
      radiusMeters: 150,
      transition: "enter",
      enabled: true,
      lastTriggeredAt: null,
      lastTransition: null,
    },
  ],
  updatedAt: "2026-07-20T00:00:00Z",
};

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
      { key: "tin", label: "TIN verification", completed: true },
      { key: "kyb_documents", label: "KYB documents", completed: false },
    ],
    identityDocuments: [
      {
        id: "kyc-seed-11",
        type: "Corporate ID Verification",
        fileName: "crest-holdings-director-id.png",
        status: "pending",
        extractedSummary: "Director identity document uploaded for review.",
        confidence: 84,
        engine: "vlm",
        uploadedAt: "2026-07-20T01:15:00Z",
      },
      {
        id: "kyc-seed-12",
        type: "Proof of Address",
        fileName: "crest-holdings-proof-address.pdf",
        status: "verified",
        extractedSummary: "Registered office address confirmed.",
        confidence: 92,
        engine: "docling",
        uploadedAt: "2026-07-19T23:40:00Z",
      },
    ],
    businessProfile: {
      stakeholderType: "business",
      companyName: "Crest Holdings Ltd",
      cacNumber: "RC-449921",
      tinNumber: "TIN-9982711",
      businessEmail: "ops@crestholdings.ng",
      businessPhone: "+2348011111111",
      businessAddress: "Plot 22, Central Business District, Abuja",
      contactPerson: "Binta Abdul",
      onboardingStatus: "in_review",
      cacStatus: "verified",
      tinStatus: "verified",
      submittedAt: "2026-07-19T21:00:00Z",
      verifiedAt: null,
      documents: [
        {
          id: 991,
          type: "Certificate of Incorporation",
          fileName: "crest-cac-certificate.pdf",
          documentUrl: null,
          status: "verified",
          engine: "docling",
          confidence: 93,
          extractedSummary: "Company incorporation certificate matched CAC reference.",
          uploadedAt: "2026-07-19T21:10:00Z",
        },
        {
          id: 992,
          type: "Board Resolution",
          fileName: "crest-board-resolution.pdf",
          documentUrl: null,
          status: "pending",
          engine: "docling",
          confidence: 74,
          extractedSummary: "Board resolution needs reviewer confirmation.",
          uploadedAt: "2026-07-20T00:45:00Z",
        },
      ],
    },
    latestLivenessSession: null,
  },
  legalWorkflows: [
    {
      id: "cofo-epe-6",
      parcelId: 6,
      transactionId: "TX-EPE-2026-006",
      type: "Certificate of Occupancy",
      status: "registered",
      registrationNumber: "COFO-LA-EPE-2026-0006",
      assignedDesk: "Registry Archive",
      preparedBy: "Registry Operations",
      reviewedBy: "Senior Registrar",
      updatedAt: "2026-07-20T02:55:00Z",
      timeline: timeline("registered", "2026-07-20T02:55:00Z"),
    },
    {
      id: "roo-amac-11",
      parcelId: 11,
      transactionId: "TX-AMAC-2026-011",
      type: "Right of Occupancy",
      status: "pending_review",
      assignedDesk: "Verification Desk",
      preparedBy: "Corporate Desk",
      reviewedBy: null,
      updatedAt: "2026-07-20T01:20:00Z",
      timeline: timeline("pending_review", "2026-07-20T01:20:00Z"),
    },
    {
      id: "legal-gc-15",
      parcelId: 15,
      transactionId: "TX-KN-2026-015",
      type: "Governor Consent",
      status: "approved",
      assignedDesk: "Legal Review",
      preparedBy: "Regional Desk",
      reviewedBy: "Senior Counsel",
      updatedAt: "2026-07-19T18:35:00Z",
      timeline: timeline("approved", "2026-07-19T18:35:00Z"),
    },
  ],
  notificationPreferences: defaultNotificationPreferences,
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

export function cloneSeedBundle() {
  return JSON.parse(JSON.stringify(seedPlatformBundle)) as MobilePlatformBundle;
}

export function findParcel(parcelId: number, source: ParcelRecord[] = parcels) {
  return source.find((parcel) => parcel.id === parcelId) ?? null;
}

export function findMissionByParcel(parcelId: number, source: MissionRecord[] = missions) {
  return source.find((mission) => mission.parcelId === parcelId) ?? null;
}

export function findWorkflowByParcel(parcelId: number, source: LegalWorkflowRecord[] = legalWorkflows) {
  return source.find((workflow) => workflow.parcelId === parcelId) ?? null;
}
