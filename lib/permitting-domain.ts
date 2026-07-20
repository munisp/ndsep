export type PermitSector = "mining" | "oil_gas" | "multi_agency";
export type PermitStage =
  | "intake"
  | "spatial_clearance"
  | "technical_review"
  | "environmental_review"
  | "agency_coordination"
  | "payment_pending"
  | "approval"
  | "issued"
  | "active_monitoring";
export type PermitPriority = "routine" | "elevated" | "critical";
export type MiddlewareStatus = "planned" | "connected" | "degraded";
export type ServiceLanguage = "typescript" | "python" | "go" | "rust";

export type AgencyRecord = {
  id: string;
  name: string;
  role: string;
  jurisdiction: string;
  reviewSlaHours: number;
  queueDepth: number;
  active: boolean;
};

export type PermitTimelineEntry = {
  key: PermitStage;
  label: string;
  completed: boolean;
  timestamp?: string;
};

export type PermitObligation = {
  id: string;
  title: string;
  dueAt: string;
  status: "pending" | "satisfied" | "at_risk";
  owner: string;
};

export type PermitCaseRecord = {
  id: string;
  sector: PermitSector;
  permitType: string;
  title: string;
  applicantName: string;
  locationLabel: string;
  assetReference: string;
  stage: PermitStage;
  priority: PermitPriority;
  leadAgencyId: string;
  participatingAgencyIds: string[];
  updatedAt: string;
  summary: string;
  timeline: PermitTimelineEntry[];
  obligations: PermitObligation[];
};

export type MiddlewareComponentRecord = {
  key: string;
  name: string;
  purpose: string;
  status: MiddlewareStatus;
  ownerService: string;
};

export type ServiceTopologyRecord = {
  id: string;
  name: string;
  language: ServiceLanguage;
  responsibility: string;
  runtimeMode: "webdev_backend" | "external_service" | "reserved_worker";
  endpointPath: string;
  health: "healthy" | "warning";
  middlewareKeys: string[];
};

export type ProductParityRecord = {
  surface: "native_mobile" | "pwa";
  score: number;
  strengths: string[];
  nextFocus: string;
};

export type PermittingPlatformSnapshot = {
  agencies: AgencyRecord[];
  permitCases: PermitCaseRecord[];
  middleware: MiddlewareComponentRecord[];
  services: ServiceTopologyRecord[];
  parity: ProductParityRecord[];
};

const orderedStages: Array<{ key: PermitStage; label: string }> = [
  { key: "intake", label: "Unified intake" },
  { key: "spatial_clearance", label: "Spatial clearance" },
  { key: "technical_review", label: "Technical review" },
  { key: "environmental_review", label: "Environmental review" },
  { key: "agency_coordination", label: "Agency coordination" },
  { key: "payment_pending", label: "Payment confirmation" },
  { key: "approval", label: "Approval decision" },
  { key: "issued", label: "Permit issued" },
  { key: "active_monitoring", label: "Active monitoring" },
];

function buildTimeline(stage: PermitStage, updatedAt: string) {
  const rank = orderedStages.findIndex((item) => item.key === stage);
  return orderedStages.map((item, index) => ({
    key: item.key,
    label: item.label,
    completed: index <= rank,
    timestamp: index <= rank ? updatedAt : undefined,
  } satisfies PermitTimelineEntry));
}

export const seedPermittingPlatform: PermittingPlatformSnapshot = {
  agencies: [
    {
      id: "mining-cadastre",
      name: "Mining Cadastre Office",
      role: "Mineral title administration and cadastre validation",
      jurisdiction: "National",
      reviewSlaHours: 72,
      queueDepth: 18,
      active: true,
    },
    {
      id: "petroleum-regulator",
      name: "Petroleum Licensing Authority",
      role: "Operator licensing, drilling approvals, and abandonment oversight",
      jurisdiction: "National",
      reviewSlaHours: 96,
      queueDepth: 11,
      active: true,
    },
    {
      id: "environment-agency",
      name: "Environmental Compliance Agency",
      role: "EIA, mitigation, and environmental condition review",
      jurisdiction: "Federal and state",
      reviewSlaHours: 120,
      queueDepth: 24,
      active: true,
    },
    {
      id: "planning-authority",
      name: "Regional Planning and Infrastructure Authority",
      role: "Land-use conformity, rights-of-way, and cross-agency coordination",
      jurisdiction: "Regional",
      reviewSlaHours: 48,
      queueDepth: 9,
      active: true,
    },
  ],
  permitCases: [
    {
      id: "permit-mining-001",
      sector: "mining",
      permitType: "Exploration Licence",
      title: "North Plateau Lithium Exploration Licence",
      applicantName: "Plateau Critical Minerals Ltd",
      locationLabel: "Jos East, Plateau State",
      assetReference: "MCU-PLT-EL-144",
      stage: "technical_review",
      priority: "elevated",
      leadAgencyId: "mining-cadastre",
      participatingAgencyIds: ["environment-agency"],
      updatedAt: "2026-07-20T11:30:00Z",
      summary: "Awaiting work-programme validation, financial capability confirmation, and environmental screening before payment confirmation.",
      timeline: buildTimeline("technical_review", "2026-07-20T11:30:00Z"),
      obligations: [
        {
          id: "obl-mining-001",
          title: "Submit signed exploration work programme",
          dueAt: "2026-07-24T17:00:00Z",
          status: "pending",
          owner: "Applicant",
        },
        {
          id: "obl-mining-002",
          title: "Complete environmental baseline screening",
          dueAt: "2026-07-26T17:00:00Z",
          status: "at_risk",
          owner: "Environmental Compliance Agency",
        },
      ],
    },
    {
      id: "permit-oilgas-014",
      sector: "oil_gas",
      permitType: "Drilling and Workover Approval",
      title: "Offshore Delta Appraisal Well Package",
      applicantName: "Delta Frontier Energy",
      locationLabel: "OML-118 Offshore Block",
      assetReference: "WELL-DFE-A7",
      stage: "environmental_review",
      priority: "critical",
      leadAgencyId: "petroleum-regulator",
      participatingAgencyIds: ["environment-agency", "planning-authority"],
      updatedAt: "2026-07-20T09:45:00Z",
      summary: "Local infrastructure dependencies cleared, but mitigation conditions and abandonment security confirmation remain outstanding.",
      timeline: buildTimeline("environmental_review", "2026-07-20T09:45:00Z"),
      obligations: [
        {
          id: "obl-oil-001",
          title: "Upload revised spill response plan",
          dueAt: "2026-07-22T16:00:00Z",
          status: "pending",
          owner: "Applicant",
        },
        {
          id: "obl-oil-002",
          title: "Confirm abandonment bond receipt",
          dueAt: "2026-07-23T12:00:00Z",
          status: "pending",
          owner: "Petroleum Licensing Authority",
        },
      ],
    },
    {
      id: "permit-multi-023",
      sector: "multi_agency",
      permitType: "Integrated Development and Right-of-Way Permit",
      title: "Eastern Corridor Logistics Hub Approval",
      applicantName: "TransitWorks Consortium",
      locationLabel: "Aba–Port Harcourt corridor",
      assetReference: "ROW-COR-2026-23",
      stage: "agency_coordination",
      priority: "elevated",
      leadAgencyId: "planning-authority",
      participatingAgencyIds: ["environment-agency", "mining-cadastre", "petroleum-regulator"],
      updatedAt: "2026-07-20T08:10:00Z",
      summary: "Unified intake completed. The case is in parallel agency review with one deficiency notice pending from environmental compliance.",
      timeline: buildTimeline("agency_coordination", "2026-07-20T08:10:00Z"),
      obligations: [
        {
          id: "obl-multi-001",
          title: "Resolve environmental deficiency notice",
          dueAt: "2026-07-21T14:00:00Z",
          status: "at_risk",
          owner: "Applicant",
        },
      ],
    },
  ],
  middleware: [
    {
      key: "kafka",
      name: "Kafka Event Bus",
      purpose: "Permit, obligation, and review-state event streaming",
      status: "connected",
      ownerService: "go-event-gateway",
    },
    {
      key: "temporal",
      name: "Temporal Workflow Engine",
      purpose: "Long-running agency review, escalation, and renewal workflows",
      status: "connected",
      ownerService: "typescript-orchestrator",
    },
    {
      key: "keycloak",
      name: "Keycloak Identity",
      purpose: "SSO and federated user identity for applicants and agencies",
      status: "planned",
      ownerService: "typescript-orchestrator",
    },
    {
      key: "permify",
      name: "Permify Authorization",
      purpose: "Fine-grained case, agency, and obligation access control",
      status: "planned",
      ownerService: "rust-policy-engine",
    },
    {
      key: "redis",
      name: "Redis Cache and Replay State",
      purpose: "Notification fan-out, queue caching, and replay coordination",
      status: "connected",
      ownerService: "go-event-gateway",
    },
    {
      key: "apisix",
      name: "APISIX Gateway",
      purpose: "Unified ingress, routing, and policy enforcement",
      status: "planned",
      ownerService: "typescript-orchestrator",
    },
    {
      key: "tigerbeetle",
      name: "TigerBeetle Ledger",
      purpose: "Fee assessment, payment settlement, and inter-agency apportionment",
      status: "planned",
      ownerService: "go-event-gateway",
    },
    {
      key: "lakehouse",
      name: "Lakehouse Analytics",
      purpose: "Cross-domain analytics, compliance scoring, and model features",
      status: "planned",
      ownerService: "python-compliance-api",
    },
  ],
  services: [
    {
      id: "typescript-orchestrator",
      name: "Permitting Orchestrator",
      language: "typescript",
      responsibility: "Unified permit APIs, case orchestration, mobile and PWA feature aggregation, and Temporal workflow coordination.",
      runtimeMode: "webdev_backend",
      endpointPath: "/api/permitting",
      health: "healthy",
      middlewareKeys: ["temporal", "keycloak", "apisix"],
    },
    {
      id: "python-compliance-api",
      name: "Compliance Intelligence Service",
      language: "python",
      responsibility: "Spatial suitability analytics, compliance scoring, document intelligence pipelines, and lakehouse export preparation.",
      runtimeMode: "external_service",
      endpointPath: "/services/python/compliance",
      health: "healthy",
      middlewareKeys: ["lakehouse", "redis"],
    },
    {
      id: "go-event-gateway",
      name: "Event Gateway",
      language: "go",
      responsibility: "Permit event publishing, middleware fan-out, replay processing, and ledger integration adapters.",
      runtimeMode: "external_service",
      endpointPath: "/services/go/events",
      health: "healthy",
      middlewareKeys: ["kafka", "redis", "tigerbeetle"],
    },
    {
      id: "rust-policy-engine",
      name: "Policy and Authorization Engine",
      language: "rust",
      responsibility: "Deterministic entitlement checks, cross-agency policy evaluation, and immutable policy decision traces.",
      runtimeMode: "external_service",
      endpointPath: "/services/rust/policy",
      health: "warning",
      middlewareKeys: ["permify", "apisix"],
    },
  ],
  parity: [
    {
      surface: "native_mobile",
      score: 84,
      strengths: ["offline review continuity", "field-first notifications", "parcel and permit detail sheets"],
      nextFocus: "deeper reviewer handoff and evidence upload flows for sector-specific permits",
    },
    {
      surface: "pwa",
      score: 82,
      strengths: ["wider workflow overview layout", "agency and middleware dashboards", "shared permit timelines"],
      nextFocus: "install experience, background sync visibility, and richer admin data tables",
    },
  ],
};

export function clonePermittingPlatform() {
  return JSON.parse(JSON.stringify(seedPermittingPlatform)) as PermittingPlatformSnapshot;
}

export function findPermitCase(caseId: string, source: PermitCaseRecord[] = seedPermittingPlatform.permitCases) {
  return source.find((item) => item.id === caseId) ?? null;
}

export function findAgency(agencyId: string, source: AgencyRecord[] = seedPermittingPlatform.agencies) {
  return source.find((item) => item.id === agencyId) ?? null;
}
