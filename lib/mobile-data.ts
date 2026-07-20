export type ParcelRecord = {
  id: number;
  parcelNumber: string;
  owner: string;
  state: string;
  lga: string;
  areaHectares: number;
  titleStatus: 'registered' | 'pending' | 'under_review';
  workflowStage: 'survey' | 'verification' | 'issuance' | 'registered';
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
  status: 'queued' | 'active' | 'synced';
  syncRisk: 'low' | 'moderate' | 'high';
  evidenceCount: number;
  lastUpdated: string;
};

export type OnboardingRecord = {
  stakeholder: string;
  readiness: number;
  ninStatus: 'verified' | 'pending';
  bvnStatus: 'verified' | 'pending';
  livenessStatus: 'verified' | 'pending';
  kybStatus: 'verified' | 'pending';
  nextAction: string;
};

export type LegalWorkflowRecord = {
  id: string;
  parcelId: number;
  type: 'Certificate of Occupancy' | 'Right of Occupancy' | 'Governor Consent';
  status: 'draft' | 'review' | 'approved' | 'registered';
  registrationNumber?: string;
  assignedDesk: string;
  updatedAt: string;
};

export const parcels: ParcelRecord[] = [
  {
    id: 6,
    parcelNumber: 'LG-EPE-2026-006',
    owner: 'Amina Yusuf',
    state: 'Lagos',
    lga: 'Epe',
    areaHectares: 1.42,
    titleStatus: 'registered',
    workflowStage: 'registered',
    latitude: 6.583,
    longitude: 3.983,
    riskScore: 18,
    lastAction: 'GeoLibre parcel review prepared',
    geolibreReady: true,
  },
  {
    id: 11,
    parcelNumber: 'FC-AMAC-2026-011',
    owner: 'Crest Holdings Ltd',
    state: 'FCT',
    lga: 'AMAC',
    areaHectares: 2.75,
    titleStatus: 'pending',
    workflowStage: 'issuance',
    latitude: 9.0765,
    longitude: 7.3986,
    riskScore: 42,
    lastAction: 'Stakeholder onboarding still in progress',
    geolibreReady: true,
  },
  {
    id: 15,
    parcelNumber: 'KN-NASS-2026-015',
    owner: 'Musa Garba',
    state: 'Kano',
    lga: 'Nassarawa',
    areaHectares: 0.88,
    titleStatus: 'under_review',
    workflowStage: 'verification',
    latitude: 11.988,
    longitude: 8.525,
    riskScore: 27,
    lastAction: 'Field evidence queued for sync',
    geolibreReady: false,
  },
];

export const missions: MissionRecord[] = [
  {
    id: 'mission-epe-6',
    parcelId: 6,
    title: 'Boundary validation and issuance confirmation',
    status: 'active',
    syncRisk: 'low',
    evidenceCount: 5,
    lastUpdated: '2026-07-20T03:00:00Z',
  },
  {
    id: 'mission-amac-11',
    parcelId: 11,
    title: 'Corporate ownership verification package',
    status: 'queued',
    syncRisk: 'moderate',
    evidenceCount: 2,
    lastUpdated: '2026-07-20T01:30:00Z',
  },
  {
    id: 'mission-kano-15',
    parcelId: 15,
    title: 'Field evidence recovery and sync review',
    status: 'queued',
    syncRisk: 'high',
    evidenceCount: 3,
    lastUpdated: '2026-07-19T18:45:00Z',
  },
];

export const onboarding: OnboardingRecord = {
  stakeholder: 'Crest Holdings Ltd',
  readiness: 76,
  ninStatus: 'verified',
  bvnStatus: 'verified',
  livenessStatus: 'pending',
  kybStatus: 'pending',
  nextAction: 'Complete liveness verification and upload incorporation evidence for parcel 11.',
};

export const legalWorkflows: LegalWorkflowRecord[] = [
  {
    id: 'cofo-epe-6',
    parcelId: 6,
    type: 'Certificate of Occupancy',
    status: 'registered',
    registrationNumber: 'COFO-LA-EPE-2026-0006',
    assignedDesk: 'Issuance Desk',
    updatedAt: '2026-07-20T02:10:00Z',
  },
  {
    id: 'roo-amac-11',
    parcelId: 11,
    type: 'Right of Occupancy',
    status: 'approved',
    assignedDesk: 'Legal Review',
    updatedAt: '2026-07-20T01:20:00Z',
  },
  {
    id: 'gc-kano-15',
    parcelId: 15,
    type: 'Governor Consent',
    status: 'review',
    assignedDesk: 'Verification Desk',
    updatedAt: '2026-07-19T19:00:00Z',
  },
];

export function findParcel(parcelId: number) {
  return parcels.find((parcel) => parcel.id === parcelId) ?? parcels[0];
}

export function findMissionByParcel(parcelId: number) {
  return missions.find((mission) => mission.parcelId === parcelId);
}

export function findWorkflowByParcel(parcelId: number) {
  return legalWorkflows.find((workflow) => workflow.parcelId === parcelId);
}
