import fs from "node:fs";
import path from "node:path";

const root = "/home/ubuntu/idlr_pts_mobile/server/data";
const now = "2026-07-20T19:40:00Z";

const mobileStore = {
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
      lastAction: "Certificate of Occupancy package delivered and audit package cached for inspection.",
      geolibreReady: true
    },
    {
      id: 11,
      parcelNumber: "FC-AMAC-2026-011",
      owner: "Crest Meridian Housing Cooperative",
      state: "FCT",
      lga: "AMAC",
      areaHectares: 12.8,
      titleStatus: "pending",
      workflowStage: "issuance",
      latitude: 9.0765,
      longitude: 7.3986,
      riskScore: 46,
      lastAction: "Affordable housing right-of-occupancy package awaiting planning and environmental close-out.",
      geolibreReady: true
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
      lastAction: "Governor consent file synchronized after low-connectivity field review.",
      geolibreReady: false
    },
    {
      id: 22,
      parcelNumber: "OG-IFO-2026-022",
      owner: "TransitWorks Consortium",
      state: "Ogun",
      lga: "Ifo",
      areaHectares: 47.3,
      titleStatus: "under_review",
      workflowStage: "coordination",
      latitude: 6.815,
      longitude: 3.195,
      riskScore: 62,
      lastAction: "ROW acquisition map and resettlement evidence linked to unified permit case.",
      geolibreReady: true
    },
    {
      id: 31,
      parcelNumber: "RV-ELE-2026-031",
      owner: "Delta Frontier Energy",
      state: "Rivers",
      lga: "Eleme",
      areaHectares: 63.4,
      titleStatus: "registered",
      workflowStage: "active_monitoring",
      latitude: 4.789,
      longitude: 7.118,
      riskScore: 54,
      lastAction: "Pipeline corridor monitoring mission synchronized with environmental observations.",
      geolibreReady: true
    }
  ],
  missions: [
    {
      id: "mission-epe-6",
      parcelId: 6,
      title: "Boundary validation and issuance confirmation",
      status: "active",
      syncRisk: "low",
      evidenceCount: 8,
      lastUpdated: "2026-07-20T13:10:00Z"
    },
    {
      id: "mission-amac-11",
      parcelId: 11,
      title: "Affordable housing ownership verification package",
      status: "queued",
      syncRisk: "moderate",
      evidenceCount: 6,
      lastUpdated: "2026-07-20T15:40:00Z"
    },
    {
      id: "mission-kano-15",
      parcelId: 15,
      title: "Consent evidence recovery and registry sync review",
      status: "queued",
      syncRisk: "high",
      evidenceCount: 4,
      lastUpdated: "2026-07-20T11:20:00Z"
    },
    {
      id: "mission-ogun-22",
      parcelId: 22,
      title: "Corridor resettlement and community engagement validation",
      status: "active",
      syncRisk: "moderate",
      evidenceCount: 11,
      lastUpdated: "2026-07-20T16:05:00Z"
    },
    {
      id: "mission-rivers-31",
      parcelId: 31,
      title: "Environmental monitoring and geofence compliance patrol",
      status: "active",
      syncRisk: "low",
      evidenceCount: 9,
      lastUpdated: "2026-07-20T14:50:00Z"
    }
  ],
  onboarding: {
    stakeholder: "Crest Meridian Housing Cooperative",
    readiness: 84,
    ninStatus: "verified",
    bvnStatus: "verified",
    livenessStatus: "verified",
    kybStatus: "in_review",
    nextAction: "Upload final cooperative board approval and beneficiary allocation schedule.",
    onboardingStatus: "in_review",
    checklist: [
      { key: "nin", label: "NIN verification", completed: true },
      { key: "bvn", label: "BVN verification", completed: true },
      { key: "liveness", label: "Liveness verification", completed: true },
      { key: "kyc_documents", label: "KYC documents", completed: true },
      { key: "cac", label: "CAC verification", completed: true },
      { key: "tin", label: "TIN verification", completed: true },
      { key: "kyb_documents", label: "KYB documents", completed: false }
    ],
    identityDocuments: [
      {
        id: "kyc-seed-11",
        type: "Director Identity Verification",
        fileName: "crest-meridian-director-id.png",
        status: "verified",
        extractedSummary: "Executive sponsor identity matched cooperative filing and active phone verification.",
        confidence: 96,
        engine: "vlm",
        uploadedAt: "2026-07-20T10:30:00Z"
      },
      {
        id: "kyc-seed-12",
        type: "Proof of Address",
        fileName: "crest-meridian-office-address.pdf",
        status: "verified",
        extractedSummary: "Abuja registered office matched supporting utility and tax documents.",
        confidence: 93,
        engine: "docling",
        uploadedAt: "2026-07-20T10:45:00Z"
      }
    ],
    businessProfile: {
      stakeholderType: "business",
      companyName: "Crest Meridian Housing Cooperative",
      cacNumber: "RC-449921",
      tinNumber: "TIN-9982711",
      businessEmail: "permits@crestmeridian.ng",
      businessPhone: "+2348011111111",
      businessAddress: "Plot 22, Central Area, Abuja",
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
          fileName: "crest-meridian-cac-certificate.pdf",
          documentUrl: null,
          status: "verified",
          engine: "docling",
          confidence: 93,
          extractedSummary: "Company incorporation certificate matched CAC reference and directors list.",
          uploadedAt: "2026-07-19T21:10:00Z"
        },
        {
          id: 992,
          type: "Cooperative Board Resolution",
          fileName: "crest-meridian-board-resolution.pdf",
          documentUrl: null,
          status: "pending",
          engine: "docling",
          confidence: 81,
          extractedSummary: "Board resolution is legible, but beneficiary schedule attachment is still missing.",
          uploadedAt: "2026-07-20T00:45:00Z"
        }
      ]
    },
    latestLivenessSession: {
      id: "live-session-crest-001",
      status: "completed",
      startedAt: "2026-07-20T09:05:00Z",
      completedAt: "2026-07-20T09:11:00Z"
    }
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
      preparedBy: "Lagos Land Services",
      reviewedBy: "Senior Registrar",
      updatedAt: "2026-07-20T13:00:00Z",
      timeline: [
        { key: "draft", label: "Draft prepared", completed: true, timestamp: "2026-07-19T15:20:00Z" },
        { key: "pending_review", label: "Review in progress", completed: true, timestamp: "2026-07-19T18:45:00Z" },
        { key: "approved", label: "Approved", completed: true, timestamp: "2026-07-20T08:30:00Z" },
        { key: "signed", label: "Signed", completed: true, timestamp: "2026-07-20T10:10:00Z" },
        { key: "registered", label: "Registered", completed: true, timestamp: "2026-07-20T12:40:00Z" }
      ]
    },
    {
      id: "roo-amac-11",
      parcelId: 11,
      transactionId: "TX-AMAC-2026-011",
      type: "Right of Occupancy",
      status: "pending_review",
      assignedDesk: "Verification Desk",
      preparedBy: "FCT Cooperative Housing Desk",
      reviewedBy: null,
      updatedAt: "2026-07-20T15:15:00Z",
      timeline: [
        { key: "draft", label: "Draft prepared", completed: true, timestamp: "2026-07-19T17:20:00Z" },
        { key: "pending_review", label: "Review in progress", completed: true, timestamp: "2026-07-20T09:15:00Z" },
        { key: "approved", label: "Approved", completed: false },
        { key: "signed", label: "Signed", completed: false },
        { key: "registered", label: "Registered", completed: false }
      ]
    },
    {
      id: "gc-kano-15",
      parcelId: 15,
      transactionId: "TX-KN-2026-015",
      type: "Governor Consent",
      status: "approved",
      assignedDesk: "Legal Review",
      preparedBy: "Regional Desk",
      reviewedBy: "Senior Counsel",
      updatedAt: "2026-07-20T11:05:00Z",
      timeline: [
        { key: "draft", label: "Draft prepared", completed: true, timestamp: "2026-07-18T12:05:00Z" },
        { key: "pending_review", label: "Review in progress", completed: true, timestamp: "2026-07-19T10:00:00Z" },
        { key: "approved", label: "Approved", completed: true, timestamp: "2026-07-20T09:40:00Z" },
        { key: "signed", label: "Signed", completed: false },
        { key: "registered", label: "Registered", completed: false }
      ]
    },
    {
      id: "row-ogun-22",
      parcelId: 22,
      transactionId: "TX-OG-2026-022",
      type: "Right of Way Clearance",
      status: "pending_review",
      assignedDesk: "Corridor Coordination Desk",
      preparedBy: "Interstate Infrastructure Desk",
      reviewedBy: "Planning Supervisor",
      updatedAt: "2026-07-20T16:10:00Z",
      timeline: [
        { key: "draft", label: "Draft prepared", completed: true, timestamp: "2026-07-19T13:10:00Z" },
        { key: "pending_review", label: "Review in progress", completed: true, timestamp: "2026-07-20T08:50:00Z" },
        { key: "approved", label: "Approved", completed: false },
        { key: "signed", label: "Signed", completed: false },
        { key: "registered", label: "Registered", completed: false }
      ]
    }
  ],
  notificationPreferences: {
    pushEnabled: true,
    fieldAlerts: true,
    onboardingAlerts: true,
    legalAlerts: true,
    geospatialAlerts: true,
    geofenceAlerts: true,
    onlyAssignedParcels: false,
    followedParcelIds: [6, 11, 22, 31],
    parcelMutes: [
      {
        parcelId: 15,
        duration: "1d",
        mutedAt: "2026-07-20T12:00:00Z",
        mutedUntil: "2026-07-21T12:00:00Z",
        workflowId: "gc-kano-15"
      }
    ],
    geofenceSubscriptions: [
      { parcelId: 6, radiusMeters: 150, transition: "both", enabled: true, lastTriggeredAt: "2026-07-20T13:30:00Z", lastTransition: "enter" },
      { parcelId: 11, radiusMeters: 300, transition: "enter", enabled: true, lastTriggeredAt: "2026-07-20T15:30:00Z", lastTransition: "enter" },
      { parcelId: 22, radiusMeters: 400, transition: "both", enabled: true, lastTriggeredAt: "2026-07-20T16:00:00Z", lastTransition: "exit" },
      { parcelId: 31, radiusMeters: 500, transition: "both", enabled: true, lastTriggeredAt: "2026-07-20T14:45:00Z", lastTransition: "enter" }
    ],
    updatedAt: now
  },
  syncMeta: {
    source: "live",
    lastSyncedAt: now,
    pendingMutations: 1,
    offlineReady: true
  },
  syncQueue: [
    {
      id: "queued-geofence-ogun-22",
      type: "geofence_transition",
      status: "pending",
      createdAt: "2026-07-20T16:02:00Z",
      summary: "Ogun corridor exit transition captured offline and awaiting replay confirmation."
    }
  ]
};

const baseRoles = ["applicant", "mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"];
const allViewable = [...baseRoles];
const ts = {
  intake1: "2026-07-18T09:00:00Z",
  intake2: "2026-07-18T11:30:00Z",
  intake3: "2026-07-19T08:15:00Z",
  intake4: "2026-07-19T10:20:00Z",
  intake5: "2026-07-19T13:10:00Z"
};

const permittingPlatform = {
  agencies: [
    { id: "mining-cadastre", name: "Mining Cadastre Office", role: "Mineral title administration, cadastre validation, and licence record management", jurisdiction: "Federal", reviewSlaHours: 72, queueDepth: 21, active: true },
    { id: "petroleum-regulator", name: "Petroleum Licensing Authority", role: "Oil and gas licensing, drilling approvals, safety conditions, and abandonment oversight", jurisdiction: "Federal", reviewSlaHours: 96, queueDepth: 14, active: true },
    { id: "environment-agency", name: "Environmental Compliance Agency", role: "EIA, resettlement review, mitigation plans, and compliance conditions", jurisdiction: "Federal and state", reviewSlaHours: 120, queueDepth: 28, active: true },
    { id: "planning-authority", name: "State Planning and Infrastructure Authority", role: "Unified intake, physical planning review, and cross-agency coordination", jurisdiction: "State", reviewSlaHours: 48, queueDepth: 17, active: true },
    { id: "land-bureau", name: "Land Administration Bureau", role: "Parcel rights, title regularization, and allocation records", jurisdiction: "State", reviewSlaHours: 72, queueDepth: 23, active: true }
  ],
  agencyUsers: [
    { id: "user-applicant-1", displayName: "Binta Abdul", role: "applicant", agencyId: null, email: "binta@crestmeridian.ng", queueIds: [] },
    { id: "user-applicant-2", displayName: "Ngozi Udeh", role: "applicant", agencyId: null, email: "ngozi@transitworks.ng", queueIds: [] },
    { id: "user-mining-1", displayName: "Haruna Bello", role: "mining_reviewer", agencyId: "mining-cadastre", email: "haruna.bello@cadastre.gov.ng", queueIds: ["queue-mining-review"] },
    { id: "user-mining-2", displayName: "Fatima Lawal", role: "mining_reviewer", agencyId: "mining-cadastre", email: "fatima.lawal@cadastre.gov.ng", queueIds: ["queue-mining-review"] },
    { id: "user-petroleum-1", displayName: "Ijeoma Peters", role: "petroleum_reviewer", agencyId: "petroleum-regulator", email: "ijeoma.peters@petroleum.gov.ng", queueIds: ["queue-petroleum-review"] },
    { id: "user-petroleum-2", displayName: "Dare Ogunleye", role: "petroleum_reviewer", agencyId: "petroleum-regulator", email: "dare.ogunleye@petroleum.gov.ng", queueIds: ["queue-petroleum-review"] },
    { id: "user-env-1", displayName: "Grace Ogbodo", role: "environment_reviewer", agencyId: "environment-agency", email: "grace.ogbodo@environment.gov.ng", queueIds: ["queue-env-review"] },
    { id: "user-env-2", displayName: "Ibrahim Musa", role: "environment_reviewer", agencyId: "environment-agency", email: "ibrahim.musa@environment.gov.ng", queueIds: ["queue-env-review"] },
    { id: "user-planning-1", displayName: "Tunde Solarin", role: "planning_supervisor", agencyId: "planning-authority", email: "tunde.solarin@planning.gov.ng", queueIds: ["queue-multi-agency"] },
    { id: "user-planning-2", displayName: "Aishat Balogun", role: "planning_supervisor", agencyId: "planning-authority", email: "aishat.balogun@planning.gov.ng", queueIds: ["queue-multi-agency"] }
  ],
  activeAgencyUserId: "user-planning-1",
  permitCases: [
    {
      id: "permit-mining-001",
      sector: "mining",
      permitType: "Exploration Licence",
      title: "North Plateau Lithium Exploration Licence",
      applicantName: "Plateau Critical Minerals Ltd",
      locationLabel: "Jos East, Plateau State",
      assetReference: "MCU-PLT-EL-144",
      stage: "environmental_review",
      priority: "elevated",
      leadAgencyId: "mining-cadastre",
      participatingAgencyIds: ["environment-agency", "land-bureau"],
      updatedAt: now,
      summary: "The licence is commercially attractive and job-creating, but it still requires a final environmental baseline, community consent confirmation, and proof of rehabilitation funding.",
      timeline: [
        { key: "intake", label: "Unified intake", completed: true, timestamp: ts.intake1 },
        { key: "spatial_clearance", label: "Spatial clearance", completed: true, timestamp: "2026-07-18T12:00:00Z" },
        { key: "technical_review", label: "Technical review", completed: true, timestamp: "2026-07-19T08:00:00Z" },
        { key: "environmental_review", label: "Environmental review", completed: false },
        { key: "agency_coordination", label: "Agency coordination", completed: false },
        { key: "payment_pending", label: "Payment confirmation", completed: false },
        { key: "approval", label: "Approval decision", completed: false },
        { key: "issued", label: "Permit issued", completed: false },
        { key: "active_monitoring", label: "Active monitoring", completed: false }
      ],
      obligations: [
        { id: "obl-mining-001", title: "Submit signed community development framework", dueAt: "2026-07-22T17:00:00Z", status: "pending", owner: "Applicant" },
        { id: "obl-mining-002", title: "Complete environmental baseline screening", dueAt: "2026-07-21T15:00:00Z", status: "at_risk", owner: "Environmental Compliance Agency" },
        { id: "obl-mining-003", title: "Confirm rehabilitation bond coverage", dueAt: "2026-07-23T17:00:00Z", status: "pending", owner: "Mining Cadastre Office" }
      ],
      formSections: [
        {
          id: "mining-applicant",
          title: "Applicant profile",
          description: "Corporate identity, licence references, tax standing, and responsible persons.",
          fields: [
            { key: "company_name", label: "Company name", value: "Plateau Critical Minerals Ltd", required: true, fieldType: "text", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "mining_reviewer", "planning_supervisor"] },
            { key: "mineral_type", label: "Mineral commodity", value: "Lithium", required: true, fieldType: "text", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "mining_reviewer"] },
            { key: "cadastre_units", label: "Cadastre units", value: "144", required: true, fieldType: "number", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "mining_reviewer"] },
            { key: "community_liaison_contact", label: "Community liaison contact", value: "Maryam Dung - +2348032241188", required: true, fieldType: "text", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "planning_supervisor"] }
          ]
        },
        {
          id: "mining-work-programme",
          title: "Work programme and safeguards",
          description: "Exploration sequence, financial capability, landowner consent, and rehabilitation commitments.",
          fields: [
            { key: "work_programme_summary", label: "Work programme summary", value: "Year 1 reconnaissance mapping, trenching, and low-impact drilling over 144 cadastre units.", required: true, fieldType: "textarea", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "mining_reviewer"] },
            { key: "financial_capability", label: "Financial capability evidence", value: "USD 8.2m bank-backed exploration budget and parent-company support letter.", required: true, fieldType: "textarea", source: "ai", viewableBy: allViewable, editableBy: ["mining_reviewer", "planning_supervisor"] },
            { key: "landowner_consent", label: "Landowner consent status", value: "Consent register signed by 7 host communities; one annex still pending witness seal.", required: true, fieldType: "text", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "environment_reviewer", "planning_supervisor"] }
          ]
        }
      ],
      reviewNotes: [
        { id: "note-mining-001", author: "Haruna Bello", role: "mining_reviewer", agencyId: "mining-cadastre", decision: "needs_changes", note: "Rehabilitation bond wording should explicitly cover trench reclamation and drill-pad closure.", createdAt: "2026-07-20T09:40:00Z" },
        { id: "note-mining-002", author: "Grace Ogbodo", role: "environment_reviewer", agencyId: "environment-agency", decision: "comment", note: "Community baseline annex is strong, but one water sampling schedule is still missing from the environmental attachment.", createdAt: "2026-07-20T12:15:00Z" }
      ],
      lastAiExtraction: { documentName: "plateau-work-programme.pdf", model: "ollama-doc-extract", sourceType: "pdf", confidence: 86, populatedKeys: ["financial_capability", "work_programme_summary"] },
      uploadedDocuments: [
        { id: "doc-mining-001", fileName: "plateau-work-programme.pdf", mimeType: "application/pdf", extractedTextPreview: "Exploration work programme covering mapping, trenching, drilling, rehabilitation bond, and community development commitments.", uploadedByRole: "applicant", uploadedAt: "2026-07-20T08:50:00Z", extractionEngine: "pdf-parse" },
        { id: "doc-mining-002", fileName: "host-community-consent.jpg", mimeType: "image/jpeg", extractedTextPreview: "Signed host community consent sheets and witness signatures captured from image upload.", uploadedByRole: "applicant", uploadedAt: "2026-07-20T10:05:00Z", extractionEngine: "vision-ocr" }
      ],
      activeAssignment: { assignedUserId: "user-env-1", assignedAt: "2026-07-20T12:20:00Z", reason: "Environmental obligation nearing breach", status: "active" },
      approvalHandoffs: [
        { id: "handoff-mining-001-env", fromRole: "mining_reviewer", toRole: "environment_reviewer", startedAt: "2026-07-20T12:20:00Z", dueAt: "2026-07-21T12:20:00Z", status: "pending", reason: "Environmental obligation nearing breach" },
        { id: "handoff-mining-001-supervisor", fromRole: "environment_reviewer", toRole: "planning_supervisor", startedAt: "2026-07-20T13:30:00Z", dueAt: "2026-07-21T08:00:00Z", status: "accepted", reason: "Cross-agency dependency review" }
      ],
      latestAuditPackage: { generatedAt: "2026-07-20T16:00:00Z", format: "csv", fileName: "permit-mining-001-audit.csv", sha256: "seeded-demo-sha-mining-001", signature: "seeded-demo-signature-mining-001", signedBy: "Permitting Orchestrator", algorithm: "RSA-SHA256", publicKeyId: "audit-key-active", verifierHint: "Verify with published RSA public key and matching SHA-256 digest." },
      custodyTimeline: [
        { id: "custody-mining-001-1", packageType: "evidence", packageRef: "plateau-work-programme.pdf", occurredAt: "2026-07-20T08:50:00Z", actor: "Plateau Critical Minerals Ltd", role: "applicant", action: "uploaded", summary: "Applicant uploaded signed exploration work programme." },
        { id: "custody-mining-001-2", packageType: "audit", packageRef: "permit-mining-001-audit.csv", occurredAt: "2026-07-20T16:00:00Z", actor: "Permitting Orchestrator", role: "system", action: "generated", summary: "Signed audit package generated for permit-mining-001." },
        { id: "custody-mining-001-3", packageType: "audit", packageRef: "permit-mining-001-audit.csv", occurredAt: "2026-07-20T16:10:00Z", actor: "Federal Verification Desk", role: "system", action: "verified", summary: "Signed audit package verified with active public key registry entry." }
      ],
      auditHistory: [
        { id: "audit-mining-001-a", createdAt: "2026-07-20T12:20:00Z", actor: "Grace Ogbodo", role: "environment_reviewer", type: "assignment", summary: "Auto-assigned escalated case to Grace Ogbodo for environmental obligation review." },
        { id: "audit-mining-001-b", createdAt: "2026-07-20T09:40:00Z", actor: "Haruna Bello", role: "mining_reviewer", type: "review_note", summary: "needs changes: Rehabilitation bond wording should explicitly cover trench reclamation and drill-pad closure." },
        { id: "audit-mining-001-c", createdAt: ts.intake1, actor: "system", role: "system", type: "status_change", summary: "Permit case initialized at unified intake." }
      ]
    },
    {
      id: "permit-oilgas-014",
      sector: "oil_gas",
      permitType: "Drilling and Workover Approval",
      title: "Offshore Delta Appraisal Well Package",
      applicantName: "Delta Frontier Energy",
      locationLabel: "OML-118 Offshore Block, Delta and Rivers maritime corridor",
      assetReference: "WELL-DFE-A7",
      stage: "agency_coordination",
      priority: "critical",
      leadAgencyId: "petroleum-regulator",
      participatingAgencyIds: ["environment-agency", "planning-authority"],
      updatedAt: now,
      summary: "The package can unlock drilling, service-sector demand, and export revenue, but abandonment security, spill response capacity, and final environmental mitigation sign-off remain live risks.",
      timeline: [
        { key: "intake", label: "Unified intake", completed: true, timestamp: ts.intake2 },
        { key: "spatial_clearance", label: "Spatial clearance", completed: true, timestamp: "2026-07-18T12:30:00Z" },
        { key: "technical_review", label: "Technical review", completed: true, timestamp: "2026-07-19T07:45:00Z" },
        { key: "environmental_review", label: "Environmental review", completed: true, timestamp: "2026-07-20T10:05:00Z" },
        { key: "agency_coordination", label: "Agency coordination", completed: false },
        { key: "payment_pending", label: "Payment confirmation", completed: false },
        { key: "approval", label: "Approval decision", completed: false },
        { key: "issued", label: "Permit issued", completed: false },
        { key: "active_monitoring", label: "Active monitoring", completed: false }
      ],
      obligations: [
        { id: "obl-oil-014-1", title: "Upload updated abandonment security letter", dueAt: "2026-07-21T11:00:00Z", status: "at_risk", owner: "Applicant" },
        { id: "obl-oil-014-2", title: "Confirm offshore spill response contractor availability", dueAt: "2026-07-22T10:00:00Z", status: "pending", owner: "Petroleum Licensing Authority" },
        { id: "obl-oil-014-3", title: "Approve environmental mitigation annex", dueAt: "2026-07-21T18:00:00Z", status: "pending", owner: "Environmental Compliance Agency" }
      ],
      formSections: [
        {
          id: "petroleum-core",
          title: "Operational package",
          description: "Well identity, operator, safety envelope, and commercial context.",
          fields: [
            { key: "operator_name", label: "Operator name", value: "Delta Frontier Energy", required: true, fieldType: "text", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "petroleum_reviewer"] },
            { key: "well_reference", label: "Well reference", value: "DFE-A7", required: true, fieldType: "text", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "petroleum_reviewer"] },
            { key: "estimated_capex", label: "Estimated CAPEX (USD m)", value: "48", required: true, fieldType: "number", source: "ai", viewableBy: allViewable, editableBy: ["petroleum_reviewer", "planning_supervisor"] },
            { key: "local_content_plan", label: "Local content plan", value: "76% local marine support, fabrication, and logistics participation across Delta and Rivers vendors.", required: true, fieldType: "textarea", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "petroleum_reviewer", "planning_supervisor"] }
          ]
        },
        {
          id: "petroleum-compliance",
          title: "Safety and environmental commitments",
          description: "Abandonment security, spill response, and environmental assurance.",
          fields: [
            { key: "abandonment_security", label: "Abandonment security", value: "Draft guarantee submitted; awaiting final bank confirmation.", required: true, fieldType: "textarea", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "petroleum_reviewer", "planning_supervisor"] },
            { key: "spill_response_capacity", label: "Spill response capacity", value: "Tier-2 offshore response contractor confirmed within 8-hour mobilization window.", required: true, fieldType: "textarea", source: "ai", viewableBy: allViewable, editableBy: ["environment_reviewer", "petroleum_reviewer"] }
          ]
        }
      ],
      reviewNotes: [
        { id: "note-oil-014-1", author: "Ijeoma Peters", role: "petroleum_reviewer", agencyId: "petroleum-regulator", decision: "comment", note: "Operational sequence is acceptable, but abandonment security wording must match the latest regulator template.", createdAt: "2026-07-20T10:05:00Z" },
        { id: "note-oil-014-2", author: "Grace Ogbodo", role: "environment_reviewer", agencyId: "environment-agency", decision: "needs_changes", note: "Mitigation annex should include fisheries compensation triggers for nearby communities.", createdAt: "2026-07-20T13:25:00Z" }
      ],
      lastAiExtraction: { documentName: "offshore-drilling-package.pdf", model: "ollama-doc-extract", sourceType: "pdf", confidence: 82, populatedKeys: ["estimated_capex", "spill_response_capacity"] },
      uploadedDocuments: [
        { id: "doc-oil-014-1", fileName: "offshore-drilling-package.pdf", mimeType: "application/pdf", extractedTextPreview: "Integrated drilling package covering well design, safety case, abandonment security, and local content commitments.", uploadedByRole: "petroleum_reviewer", uploadedAt: "2026-07-20T09:50:00Z", extractionEngine: "pdf-parse" }
      ],
      activeAssignment: { assignedUserId: "user-petroleum-1", assignedAt: "2026-07-20T10:10:00Z", reason: "Critical permit priority escalation", status: "active" },
      approvalHandoffs: [
        { id: "handoff-oil-014-petroleum", fromRole: "system", toRole: "petroleum_reviewer", startedAt: "2026-07-20T10:10:00Z", dueAt: "2026-07-21T08:00:00Z", status: "escalated", reason: "Critical permit priority escalation" },
        { id: "handoff-oil-014-supervisor", fromRole: "petroleum_reviewer", toRole: "planning_supervisor", startedAt: "2026-07-20T14:30:00Z", dueAt: "2026-07-20T22:00:00Z", status: "pending", reason: "Cross-sector exception requiring supervisor coordination" }
      ],
      latestAuditPackage: { generatedAt: "2026-07-20T16:45:00Z", format: "pdf", fileName: "permit-oilgas-014-audit.pdf", sha256: "seeded-demo-sha-oil-014", signature: "seeded-demo-signature-oil-014", signedBy: "Permitting Orchestrator", algorithm: "RSA-SHA256", publicKeyId: "audit-key-active", verifierHint: "Validate signature with the active public key shown on the platform verification page." },
      custodyTimeline: [
        { id: "custody-oil-014-1", packageType: "evidence", packageRef: "offshore-drilling-package.pdf", occurredAt: "2026-07-20T09:50:00Z", actor: "Ijeoma Peters", role: "petroleum_reviewer", action: "uploaded", summary: "Reviewer uploaded consolidated drilling package for extraction and audit linking." },
        { id: "custody-oil-014-2", packageType: "audit", packageRef: "permit-oilgas-014-audit.pdf", occurredAt: "2026-07-20T16:45:00Z", actor: "Permitting Orchestrator", role: "system", action: "generated", summary: "Signed PDF audit package generated for external sharing." }
      ],
      auditHistory: [
        { id: "audit-oil-014-a", createdAt: "2026-07-20T14:30:00Z", actor: "Tunde Solarin", role: "planning_supervisor", type: "assignment", summary: "Supervisor monitoring activated for cross-sector exception and imminent escalation." },
        { id: "audit-oil-014-b", createdAt: "2026-07-20T10:05:00Z", actor: "Ijeoma Peters", role: "petroleum_reviewer", type: "review_note", summary: "comment: Operational sequence is acceptable, but abandonment security wording must match the latest regulator template." },
        { id: "audit-oil-014-c", createdAt: ts.intake2, actor: "system", role: "system", type: "status_change", summary: "Permit case initialized at unified intake." }
      ]
    },
    {
      id: "permit-multi-023",
      sector: "multi_agency",
      permitType: "Integrated Development and Right-of-Way Permit",
      title: "Eastern Corridor Logistics Hub Approval",
      applicantName: "TransitWorks Consortium",
      locationLabel: "Aba–Port Harcourt growth corridor",
      assetReference: "ROW-COR-2026-23",
      stage: "agency_coordination",
      priority: "elevated",
      leadAgencyId: "planning-authority",
      participatingAgencyIds: ["environment-agency", "land-bureau", "petroleum-regulator"],
      updatedAt: now,
      summary: "This case links road, warehousing, utilities, housing, and resettlement approvals. It showcases how one platform can reduce project delay, lower dispute risk, and speed productive infrastructure.",
      timeline: [
        { key: "intake", label: "Unified intake", completed: true, timestamp: ts.intake3 },
        { key: "spatial_clearance", label: "Spatial clearance", completed: true, timestamp: "2026-07-19T12:40:00Z" },
        { key: "technical_review", label: "Technical review", completed: true, timestamp: "2026-07-20T09:00:00Z" },
        { key: "environmental_review", label: "Environmental review", completed: false },
        { key: "agency_coordination", label: "Agency coordination", completed: false },
        { key: "payment_pending", label: "Payment confirmation", completed: false },
        { key: "approval", label: "Approval decision", completed: false },
        { key: "issued", label: "Permit issued", completed: false },
        { key: "active_monitoring", label: "Active monitoring", completed: false }
      ],
      obligations: [
        { id: "obl-multi-023-1", title: "Close environmental deficiency notice", dueAt: "2026-07-21T09:30:00Z", status: "at_risk", owner: "Applicant" },
        { id: "obl-multi-023-2", title: "Upload revised resettlement budget", dueAt: "2026-07-22T16:00:00Z", status: "pending", owner: "Applicant" },
        { id: "obl-multi-023-3", title: "Confirm utility trench coordination plan", dueAt: "2026-07-22T12:00:00Z", status: "pending", owner: "Planning Authority" }
      ],
      formSections: [
        {
          id: "multi-intake",
          title: "Unified intake summary",
          description: "Shared investment overview for coordinated federal and state review.",
          fields: [
            { key: "project_name", label: "Project name", value: "Eastern Corridor Logistics Hub", required: true, fieldType: "text", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "planning_supervisor"] },
            { key: "corridor_scope", label: "Corridor scope", value: "Logistics park, truck terminal, low-cost worker housing, utilities, and 18km right-of-way clearance package.", required: true, fieldType: "textarea", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "planning_supervisor", "environment_reviewer"] },
            { key: "projected_jobs", label: "Projected jobs", value: "3,600 construction jobs and 1,150 permanent operating jobs", required: true, fieldType: "text", source: "ai", viewableBy: allViewable, editableBy: ["planning_supervisor", "environment_reviewer"] }
          ]
        }
      ],
      reviewNotes: [
        { id: "note-multi-023-1", author: "Tunde Solarin", role: "planning_supervisor", agencyId: "planning-authority", decision: "comment", note: "Parallel agency queues are active. Environmental deficiency response is the current blocker.", createdAt: "2026-07-20T08:30:00Z" },
        { id: "note-multi-023-2", author: "Ibrahim Musa", role: "environment_reviewer", agencyId: "environment-agency", decision: "needs_changes", note: "Resettlement budget should clearly separate livelihood restoration from compensation logistics.", createdAt: "2026-07-20T12:55:00Z" }
      ],
      lastAiExtraction: { documentName: "corridor-impact-assessment.pdf", model: "ollama-doc-extract", sourceType: "pdf", confidence: 88, populatedKeys: ["projected_jobs", "corridor_scope"] },
      uploadedDocuments: [
        { id: "doc-multi-023-1", fileName: "corridor-impact-assessment.pdf", mimeType: "application/pdf", extractedTextPreview: "Impact assessment covers logistics throughput, resettlement exposure, phased utility works, and projected employment.", uploadedByRole: "applicant", uploadedAt: "2026-07-20T11:05:00Z", extractionEngine: "pdf-parse" },
        { id: "doc-multi-023-2", fileName: "community-hearing-photo.jpg", mimeType: "image/jpeg", extractedTextPreview: "Community hearing attendance boards and consent banners photographed on site.", uploadedByRole: "planning_supervisor", uploadedAt: "2026-07-20T14:15:00Z", extractionEngine: "vision-ocr" }
      ],
      activeAssignment: { assignedUserId: "user-env-2", assignedAt: "2026-07-20T13:05:00Z", reason: "Deficiency notice nearing breach", status: "active" },
      approvalHandoffs: [
        { id: "handoff-multi-023-env", fromRole: "planning_supervisor", toRole: "environment_reviewer", startedAt: "2026-07-20T13:05:00Z", dueAt: "2026-07-21T07:00:00Z", status: "pending", reason: "Deficiency notice nearing breach" },
        { id: "handoff-multi-023-supervisor", fromRole: "environment_reviewer", toRole: "planning_supervisor", startedAt: "2026-07-20T15:20:00Z", dueAt: "2026-07-21T09:00:00Z", status: "pending", reason: "Resettlement budget exception requires supervisor sign-off" }
      ],
      latestAuditPackage: null,
      custodyTimeline: [
        { id: "custody-multi-023-1", packageType: "evidence", packageRef: "corridor-impact-assessment.pdf", occurredAt: "2026-07-20T11:05:00Z", actor: "TransitWorks Consortium", role: "applicant", action: "uploaded", summary: "Applicant uploaded impact assessment for coordinated review." }
      ],
      auditHistory: [
        { id: "audit-multi-023-a", createdAt: "2026-07-20T13:05:00Z", actor: "Ibrahim Musa", role: "environment_reviewer", type: "assignment", summary: "Auto-assigned escalated case for environmental deficiency notice review." },
        { id: "audit-multi-023-b", createdAt: "2026-07-20T12:55:00Z", actor: "Ibrahim Musa", role: "environment_reviewer", type: "review_note", summary: "needs changes: Resettlement budget should clearly separate livelihood restoration from compensation logistics." },
        { id: "audit-multi-023-c", createdAt: ts.intake3, actor: "system", role: "system", type: "status_change", summary: "Permit case initialized at unified intake." }
      ]
    },
    {
      id: "permit-housing-041",
      sector: "multi_agency",
      permitType: "Affordable Housing Estate Approval",
      title: "Sunrise Homes Social Housing Estate",
      applicantName: "Sunrise Shelter Initiative",
      locationLabel: "Mowe, Ogun State",
      assetReference: "SHI-OG-EST-041",
      stage: "payment_pending",
      priority: "normal",
      leadAgencyId: "planning-authority",
      participatingAgencyIds: ["land-bureau", "environment-agency"],
      updatedAt: now,
      summary: "This blended public-private housing programme demonstrates how the platform supports builders, NGOs, and end buyers through transparent approvals, land security, and affordable delivery.",
      timeline: [
        { key: "intake", label: "Unified intake", completed: true, timestamp: ts.intake4 },
        { key: "spatial_clearance", label: "Spatial clearance", completed: true, timestamp: "2026-07-19T16:20:00Z" },
        { key: "technical_review", label: "Technical review", completed: true, timestamp: "2026-07-20T09:10:00Z" },
        { key: "environmental_review", label: "Environmental review", completed: true, timestamp: "2026-07-20T11:00:00Z" },
        { key: "agency_coordination", label: "Agency coordination", completed: true, timestamp: "2026-07-20T12:45:00Z" },
        { key: "payment_pending", label: "Payment confirmation", completed: false },
        { key: "approval", label: "Approval decision", completed: false },
        { key: "issued", label: "Permit issued", completed: false },
        { key: "active_monitoring", label: "Active monitoring", completed: false }
      ],
      obligations: [
        { id: "obl-housing-041-1", title: "Confirm beneficiary mortgage support list", dueAt: "2026-07-23T16:00:00Z", status: "pending", owner: "Applicant" },
        { id: "obl-housing-041-2", title: "Settle planning and infrastructure fees", dueAt: "2026-07-22T15:00:00Z", status: "pending", owner: "Applicant" }
      ],
      formSections: [
        {
          id: "housing-core",
          title: "Project and beneficiary profile",
          description: "Estate scope, affordability structure, and end-buyer access model.",
          fields: [
            { key: "unit_count", label: "Planned units", value: "420", required: true, fieldType: "number", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "planning_supervisor"] },
            { key: "target_income_band", label: "Target income band", value: "Civil servants, artisans, and low- to middle-income first-time buyers", required: true, fieldType: "text", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "planning_supervisor"] },
            { key: "ngo_partner", label: "NGO partner", value: "Shelter Access Africa", required: false, fieldType: "text", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "planning_supervisor"] }
          ]
        }
      ],
      reviewNotes: [
        { id: "note-housing-041-1", author: "Aishat Balogun", role: "planning_supervisor", agencyId: "planning-authority", decision: "approved", note: "Affordable housing mix is strong and aligns with state inclusion targets; proceed to payment confirmation.", createdAt: "2026-07-20T12:45:00Z" }
      ],
      lastAiExtraction: null,
      uploadedDocuments: [],
      activeAssignment: { assignedUserId: "user-planning-2", assignedAt: "2026-07-20T12:50:00Z", reason: "Payment confirmation follow-up", status: "active" },
      approvalHandoffs: [
        { id: "handoff-housing-041-supervisor", fromRole: "planning_supervisor", toRole: "planning_supervisor", startedAt: "2026-07-20T12:50:00Z", dueAt: "2026-07-22T12:00:00Z", status: "accepted", reason: "Payment confirmation follow-up" }
      ],
      latestAuditPackage: null,
      custodyTimeline: [],
      auditHistory: [
        { id: "audit-housing-041-a", createdAt: "2026-07-20T12:45:00Z", actor: "Aishat Balogun", role: "planning_supervisor", type: "review_note", summary: "approved: Affordable housing mix is strong and aligns with state inclusion targets; proceed to payment confirmation." },
        { id: "audit-housing-041-b", createdAt: ts.intake4, actor: "system", role: "system", type: "status_change", summary: "Permit case initialized at unified intake." }
      ]
    },
    {
      id: "permit-mining-052",
      sector: "mining",
      permitType: "Small-Scale Quarry Lease",
      title: "Kogi Granite Community Quarry Lease",
      applicantName: "Kogi Community Aggregates Cooperative",
      locationLabel: "Lokoja outskirts, Kogi State",
      assetReference: "KOG-QRY-052",
      stage: "approval",
      priority: "normal",
      leadAgencyId: "mining-cadastre",
      participatingAgencyIds: ["environment-agency", "planning-authority"],
      updatedAt: now,
      summary: "A smaller quarry case illustrates community enterprise formalization, royalty visibility, and safer local material supply for builders.",
      timeline: [
        { key: "intake", label: "Unified intake", completed: true, timestamp: ts.intake5 },
        { key: "spatial_clearance", label: "Spatial clearance", completed: true, timestamp: "2026-07-19T15:30:00Z" },
        { key: "technical_review", label: "Technical review", completed: true, timestamp: "2026-07-20T09:20:00Z" },
        { key: "environmental_review", label: "Environmental review", completed: true, timestamp: "2026-07-20T11:10:00Z" },
        { key: "agency_coordination", label: "Agency coordination", completed: true, timestamp: "2026-07-20T13:40:00Z" },
        { key: "payment_pending", label: "Payment confirmation", completed: true, timestamp: "2026-07-20T15:05:00Z" },
        { key: "approval", label: "Approval decision", completed: false },
        { key: "issued", label: "Permit issued", completed: false },
        { key: "active_monitoring", label: "Active monitoring", completed: false }
      ],
      obligations: [
        { id: "obl-mining-052-1", title: "Finalize safety induction roster", dueAt: "2026-07-24T16:00:00Z", status: "pending", owner: "Applicant" }
      ],
      formSections: [
        {
          id: "quarry-core",
          title: "Community quarry profile",
          description: "Lease scope, local employment plan, and site controls.",
          fields: [
            { key: "lease_area_hectares", label: "Lease area (ha)", value: "8.4", required: true, fieldType: "number", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "mining_reviewer"] },
            { key: "local_employment_plan", label: "Local employment plan", value: "42 direct jobs with 30 reserved for host-community youth and women cooperative members.", required: true, fieldType: "textarea", source: "manual", viewableBy: allViewable, editableBy: ["applicant", "planning_supervisor", "mining_reviewer"] }
          ]
        }
      ],
      reviewNotes: [
        { id: "note-mining-052-1", author: "Fatima Lawal", role: "mining_reviewer", agencyId: "mining-cadastre", decision: "approved", note: "Technical review complete. Quarry geometry, haul route, and safety stand-off distances are acceptable.", createdAt: "2026-07-20T15:10:00Z" }
      ],
      lastAiExtraction: null,
      uploadedDocuments: [],
      activeAssignment: { assignedUserId: "user-mining-2", assignedAt: "2026-07-20T15:15:00Z", reason: "Approval pack preparation", status: "active" },
      approvalHandoffs: [
        { id: "handoff-mining-052-supervisor", fromRole: "mining_reviewer", toRole: "planning_supervisor", startedAt: "2026-07-20T15:15:00Z", dueAt: "2026-07-22T09:00:00Z", status: "pending", reason: "Final approval pack preparation" }
      ],
      latestAuditPackage: null,
      custodyTimeline: [],
      auditHistory: [
        { id: "audit-mining-052-a", createdAt: "2026-07-20T15:10:00Z", actor: "Fatima Lawal", role: "mining_reviewer", type: "review_note", summary: "approved: Technical review complete. Quarry geometry, haul route, and safety stand-off distances are acceptable." },
        { id: "audit-mining-052-b", createdAt: ts.intake5, actor: "system", role: "system", type: "status_change", summary: "Permit case initialized at unified intake." }
      ]
    }
  ],
  approvalQueues: [
    { id: "queue-mining-review", agencyId: "mining-cadastre", role: "mining_reviewer", title: "Mining cadastre review queue", description: "Exploration, quarry, and mining lease cases awaiting cadastre and technical review.", caseIds: ["permit-mining-001", "permit-mining-052"], pendingCount: 2, overdueCount: 1, avgSlaHours: 72, breachedCaseIds: ["permit-mining-001"] },
    { id: "queue-petroleum-review", agencyId: "petroleum-regulator", role: "petroleum_reviewer", title: "Petroleum licensing queue", description: "Drilling, workover, abandonment, and field development packages awaiting review.", caseIds: ["permit-oilgas-014"], pendingCount: 1, overdueCount: 1, avgSlaHours: 96, breachedCaseIds: ["permit-oilgas-014"] },
    { id: "queue-env-review", agencyId: "environment-agency", role: "environment_reviewer", title: "Environmental compliance queue", description: "EIA, mitigation, and deficiency review across all permit sectors.", caseIds: ["permit-mining-001", "permit-oilgas-014", "permit-multi-023"], pendingCount: 3, overdueCount: 2, avgSlaHours: 120, breachedCaseIds: ["permit-mining-001", "permit-multi-023"] },
    { id: "queue-multi-agency", agencyId: "planning-authority", role: "planning_supervisor", title: "Multi-agency coordination queue", description: "Unified intake, routing, and cross-agency decision queues for shared permits.", caseIds: ["permit-multi-023", "permit-housing-041", "permit-oilgas-014"], pendingCount: 3, overdueCount: 2, avgSlaHours: 48, breachedCaseIds: ["permit-multi-023", "permit-oilgas-014"] }
  ],
  middleware: [
    { key: "kafka", name: "Kafka Event Bus", purpose: "Permit, obligation, and review-state event streaming", status: "connected", ownerService: "go-event-gateway" },
    { key: "temporal", name: "Temporal Workflow Engine", purpose: "Long-running agency review, escalation, and renewal workflows", status: "connected", ownerService: "typescript-orchestrator" },
    { key: "keycloak", name: "Keycloak Identity", purpose: "SSO and federated user identity for applicants and agencies", status: "planned", ownerService: "typescript-orchestrator" },
    { key: "permify", name: "Permify Authorization", purpose: "Fine-grained case, agency, and obligation access control", status: "planned", ownerService: "rust-policy-engine" },
    { key: "redis", name: "Redis Cache and Replay State", purpose: "Notification fan-out, queue caching, and replay coordination", status: "connected", ownerService: "go-event-gateway" },
    { key: "apisix", name: "APISIX Gateway", purpose: "Unified ingress, routing, and policy enforcement", status: "planned", ownerService: "typescript-orchestrator" },
    { key: "tigerbeetle", name: "TigerBeetle Ledger", purpose: "Fee assessment, payment settlement, and inter-agency apportionment", status: "planned", ownerService: "go-event-gateway" },
    { key: "lakehouse", name: "Lakehouse Analytics", purpose: "Cross-domain analytics, compliance scoring, and model features", status: "planned", ownerService: "python-compliance-api" }
  ],
  services: [
    { id: "typescript-orchestrator", name: "Permitting Orchestrator", language: "typescript", responsibility: "Unified permit APIs, case orchestration, mobile and PWA feature aggregation, and workflow coordination.", runtimeMode: "webdev_backend", endpointPath: "/api/permitting", health: "healthy", middlewareKeys: ["temporal", "keycloak", "apisix"] },
    { id: "python-compliance-api", name: "Compliance Intelligence Service", language: "python", responsibility: "Spatial suitability analytics, compliance scoring, document intelligence pipelines, and lakehouse export preparation.", runtimeMode: "external_service", endpointPath: "/services/python/compliance", health: "healthy", middlewareKeys: ["lakehouse", "redis"] },
    { id: "go-event-gateway", name: "Event Gateway", language: "go", responsibility: "Permit event publishing, middleware fan-out, replay processing, and ledger integration adapters.", runtimeMode: "external_service", endpointPath: "/services/go/events", health: "healthy", middlewareKeys: ["kafka", "redis", "tigerbeetle"] },
    { id: "rust-policy-engine", name: "Policy and Authorization Engine", language: "rust", responsibility: "Deterministic entitlement checks, cross-agency policy evaluation, and immutable policy decision traces.", runtimeMode: "external_service", endpointPath: "/services/rust/policy", health: "healthy", middlewareKeys: ["permify", "apisix"] }
  ],
  parity: [
    { surface: "native_mobile", score: 91, strengths: ["offline inspection continuity", "field-first audit packages", "handoff alerts and biometric audit access"], nextFocus: "add richer map overlays and deeper beneficiary workflows for housing and land buyers" },
    { surface: "pwa", score: 90, strengths: ["executive dashboards", "supervisor exception analytics", "permit verification and chain-of-custody review"], nextFocus: "add larger-screen evidence comparison workspaces and deeper export tooling" }
  ],
  signingKeys: [
    { keyId: "audit-key-active", algorithm: "RSA-SHA256", createdAt: "2026-06-15T08:00:00Z", active: true, publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAruntimegeneratedseed\n-----END PUBLIC KEY-----" },
    { keyId: "audit-key-2025-q4", algorithm: "RSA-SHA256", createdAt: "2025-10-01T08:00:00Z", active: false, revokedAt: "2026-06-15T08:05:00Z", revocationReason: "Routine annual rotation completed", publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAretiredseedkey\n-----END PUBLIC KEY-----" }
  ],
  reminderQueue: [
    { id: "reminder-oil-014", caseId: "permit-oilgas-014", role: "petroleum_reviewer", severity: "critical", dueAt: "2026-07-21T08:00:00Z", message: "Offshore Delta Appraisal Well Package handoff will escalate within 12 hours unless accepted or completed." },
    { id: "reminder-multi-023", caseId: "permit-multi-023", role: "environment_reviewer", severity: "warning", dueAt: "2026-07-21T07:00:00Z", message: "Eastern Corridor Logistics Hub deficiency response is approaching SLA breach." },
    { id: "reminder-mining-001", caseId: "permit-mining-001", role: "planning_supervisor", severity: "warning", dueAt: "2026-07-21T08:00:00Z", message: "Supervisor review remains open for North Plateau Lithium environmental dependency handoff." }
  ],
  supervisorDigests: [
    { id: "digest-planning-1", agencyId: "planning-authority", subject: "Daily queue digest: 3 permits at risk", summary: "Two coordination cases and one petroleum exception are within escalation windows. Multi-agency approvals remain the main source of backlog.", channel: "in_app", backlogCount: 7, overdueHandoffs: 2, generatedAt: "2026-07-20T17:00:00Z" },
    { id: "digest-planning-2", agencyId: "planning-authority", subject: "Email digest: overdue handoffs and bottlenecks", summary: "Environmental deficiency notices and late reassignment responses are the main causes of delay across the planning coordination queue.", channel: "email", backlogCount: 7, overdueHandoffs: 2, generatedAt: "2026-07-20T17:00:00Z" }
  ],
  supervisorExceptionAnalytics: [
    { agencyId: "planning-authority", escalatedCount: 4, reassignmentCount: 2, averageHoursToResolution: 19, topBottleneck: "Environmental deficiency closure" },
    { agencyId: "petroleum-regulator", escalatedCount: 2, reassignmentCount: 1, averageHoursToResolution: 14, topBottleneck: "Abandonment security confirmation" },
    { agencyId: "mining-cadastre", escalatedCount: 2, reassignmentCount: 0, averageHoursToResolution: 17, topBottleneck: "Community consent annex completion" }
  ]
};

fs.writeFileSync(path.join(root, "mobile-platform-store.json"), JSON.stringify(mobileStore, null, 2) + "\n");
fs.writeFileSync(path.join(root, "permitting-platform.json"), JSON.stringify(permittingPlatform, null, 2) + "\n");
console.log("Seeded realistic platform data.");
