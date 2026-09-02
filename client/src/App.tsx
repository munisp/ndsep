import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { lazy, Suspense } from "react";

// Eager-load the layout shell; lazy-load all page components for code splitting
import DashboardLayout from "./components/DashboardLayout";

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px] animate-fade-in">
      <div className="flex flex-col items-center gap-3">
        <div className="relative h-10 w-10">
          <div className="absolute inset-0 rounded-full border-2 border-muted" />
          <div className="absolute inset-0 rounded-full border-2 border-t-primary animate-spin" />
        </div>
        <span className="text-xs text-muted-foreground font-medium tracking-wide">Loading...</span>
      </div>
    </div>
  );
}

const Dashboard = lazy(() => import("./pages/Dashboard"));
const ComponentShowcase = lazy(() => import("./pages/ComponentShowcase"));
const DiscoveryEngine = lazy(() => import("./pages/DiscoveryEngine"));
const DataCatalog = lazy(() => import("./pages/DataCatalog"));
const ComplianceEngine = lazy(() => import("./pages/ComplianceEngine"));
const SiemAudit = lazy(() => import("./pages/SiemAudit"));
const NetworkDPI = lazy(() => import("./pages/NetworkDPI"));
const FinancialEnforcement = lazy(() => import("./pages/FinancialEnforcement"));
const StreamingEvents = lazy(() => import("./pages/StreamingEvents"));
const EventBusMonitor = lazy(() => import("./pages/EventBusMonitor"));
const LedgerExplorer = lazy(() => import("./pages/LedgerExplorer"));
const AIAssistant = lazy(() => import("./pages/AIAssistant"));
const Organizations = lazy(() => import("./pages/Organizations"));
const RoleManagement = lazy(() => import("./pages/RoleManagement"));
const WorkerProcesses = lazy(() => import("./pages/WorkerProcesses"));
const BgpRoutes = lazy(() => import("./pages/BgpRoutes"));
const TemporalWorkflows = lazy(() => import("./pages/TemporalWorkflows"));
const PrometheusMetrics = lazy(() => import("./pages/PrometheusMetrics"));
const ArkimePcap = lazy(() => import("./pages/ArkimePcap"));
const OrgPortal = lazy(() => import("./pages/OrgPortal"));
const PortalReview = lazy(() => import("./pages/PortalReview"));
const TransferApprovals = lazy(() => import("./pages/TransferApprovals"));
const ContinuousMonitoring = lazy(() => import("./pages/ContinuousMonitoring"));
const OrchestrationDashboard = lazy(() => import("./pages/OrchestrationDashboard"));
const ComplianceLeaderboard = lazy(() => import("./pages/ComplianceLeaderboard"));
const CertificateVerify = lazy(() => import("@/pages/CertificateVerify"));
const ApiDocs = lazy(() => import("@/pages/ApiDocs"));
const PenaltyReceipt = lazy(() => import("@/pages/PenaltyReceipt"));
const RegulatoryReports = lazy(() => import("@/pages/RegulatoryReports"));
const OrgStatusTracker = lazy(() => import("@/pages/OrgStatusTracker"));
const AuditLogViewer = lazy(() => import("@/pages/AuditLogViewer"));
const PolicyTemplates = lazy(() => import("@/pages/PolicyTemplates"));
const AiGovernance = lazy(() => import("@/pages/AiGovernance"));
const EvidencePackages = lazy(() => import("@/pages/EvidencePackages"));
const SectorManagement = lazy(() => import("@/pages/SectorManagement"));
const CitizenRightsPortal = lazy(() => import("@/pages/CitizenRightsPortal"));
const GitopsConfig = lazy(() => import("@/pages/GitopsConfig"));
const DataFlowVisualization = lazy(() => import("@/pages/DataFlowVisualization"));
const TiaAssessments = lazy(() => import("@/pages/TiaAssessments"));
const RemediationWorkflows = lazy(() => import("@/pages/RemediationWorkflows"));
const AssetGraph = lazy(() => import("@/pages/AssetGraph"));
const FrameworkDashboard = lazy(() => import("@/pages/FrameworkDashboard"));
const MyOrg = lazy(() => import("@/pages/MyOrg"));
const EnforcementCases = lazy(() => import("@/pages/EnforcementCases"));
const NotificationSettings = lazy(() => import("@/pages/NotificationSettings"));
const AlertingSettings = lazy(() => import("@/pages/AlertingSettings"));
const CertificateRotation = lazy(() => import("@/pages/CertificateRotation"));
const SectorBenchmark = lazy(() => import("@/pages/SectorBenchmark"));
const ConsentManagement = lazy(() => import("@/pages/ConsentManagement"));
const BreachNotification = lazy(() => import("@/pages/BreachNotification"));
const DpoRegistry = lazy(() => import("@/pages/DpoRegistry"));
const DpoDashboard = lazy(() => import("@/pages/DpoDashboard"));
const DpiaAssessments = lazy(() => import("@/pages/DpiaAssessments"));
const RopaRecords = lazy(() => import("@/pages/RopaRecords"));
const RetentionPolicies = lazy(() => import("@/pages/RetentionPolicies"));
const DpoReports = lazy(() => import("@/pages/DpoReports"));
const ComplianceAuditReturns = lazy(() => import("@/pages/ComplianceAuditReturns"));
const AdequacyRegistry = lazy(() => import("@/pages/AdequacyRegistry"));
const DataProcessingAgreements = lazy(() => import("@/pages/DataProcessingAgreements"));
const PrivacyNotices = lazy(() => import("@/pages/PrivacyNotices"));
const CookieConsent = lazy(() => import("@/pages/CookieConsent"));
const AutomatedDecisions = lazy(() => import("@/pages/AutomatedDecisions"));
const ParentalConsent = lazy(() => import("@/pages/ParentalConsent"));
const StaffTraining = lazy(() => import("@/pages/StaffTraining"));
const TransferInstruments = lazy(() => import("@/pages/TransferInstruments"));
const DataExportJobs = lazy(() => import("@/pages/DataExportJobs"));
const DcpmiThresholds = lazy(() => import("@/pages/DcpmiThresholds"));
const DpcoRegistry = lazy(() => import("@/pages/DpcoRegistry"));
const DpcoPortal = lazy(() => import("@/pages/DpcoPortal"));
const DpcoClients = lazy(() => import("@/pages/DpcoClients"));
const DpcoVerification = lazy(() => import("@/pages/DpcoVerification"));
const DpcoAuditWorkspace = lazy(() => import("@/pages/DpcoAuditWorkspace"));
const DpcoPolicyHub = lazy(() => import("@/pages/DpcoPolicyHub"));
const DpcoScorecard = lazy(() => import("@/pages/DpcoScorecard"));
const DpcoOnboard = lazy(() => import("@/pages/DpcoOnboard"));
const DpcoEvidenceVault = lazy(() => import("@/pages/DpcoEvidenceVault"));
const DpcoClientDashboard = lazy(() => import("@/pages/DpcoClientDashboard"));
const DpcoBilling = lazy(() => import("@/pages/dpco/DpcoBilling"));
const DpcoSubscription = lazy(() => import("@/pages/dpco/DpcoSubscription"));
const AdminRevenue = lazy(() => import("@/pages/admin/AdminRevenue"));
const AdminRegistrations = lazy(() => import("@/pages/admin/AdminRegistrations"));
const AdminPlatformSettings = lazy(() => import("@/pages/admin/AdminPlatformSettings"));
const AdminAccreditation = lazy(() => import("@/pages/admin/AdminAccreditation"));
const DpcoApply = lazy(() => import("@/pages/DpcoApply"));
const AccreditationStatus = lazy(() => import("@/pages/AccreditationStatus"));
const DpcoRenewal = lazy(() => import("@/pages/dpco/DpcoRenewal"));
const DpcoAiTools = lazy(() => import("@/pages/dpco/DpcoAiTools"));
const DpcoPerformanceScorecard = lazy(() => import("@/pages/dpco/DpcoPerformanceScorecard"));
const DpcoBrochure = lazy(() => import("@/pages/DpcoBrochure"));
const DpcoLanding = lazy(() => import("@/pages/DpcoLanding"));
const DpcoRegister = lazy(() => import("@/pages/DpcoRegister"));
const DpcoApp = lazy(() => import("@/pages/DpcoApp"));
const EngageDpco = lazy(() => import("@/pages/EngageDpco"));
const DpcoPwaDashboard = lazy(() => import("@/pages/DpcoPwaDashboard"));
const PwaDashboard = lazy(() => import("@/pages/PwaDashboard"));
const DpcoPwaUI = lazy(() => import("@/pages/DpcoPwaUI"));
const DsarPublicPortal = lazy(() => import("@/pages/DsarPublicPortal"));
const DpiaWizard = lazy(() => import("@/pages/DpiaWizard"));
const AiGovernanceScoring = lazy(() => import("@/pages/AiGovernanceScoring"));
const SectorBenchmarking = lazy(() => import("@/pages/SectorBenchmarking"));
const WebhookManagement = lazy(() => import("@/pages/WebhookManagement"));
const GlobalSearch = lazy(() => import("@/pages/GlobalSearch"));
const CarAutomation = lazy(() => import("@/pages/CarAutomation"));
const OpenApiPortal = lazy(() => import("@/pages/OpenApiPortal"));
const BankingDashboard = lazy(() => import("@/pages/banking/BankingDashboard"));
const KycManagement = lazy(() => import("@/pages/banking/KycManagement"));
const AmlCases = lazy(() => import("@/pages/banking/AmlCases"));
const WatchlistScreening = lazy(() => import("@/pages/banking/WatchlistScreening"));
const PaymentsMonitor = lazy(() => import("@/pages/banking/PaymentsMonitor"));
const SwiftTransactions = lazy(() => import("@/pages/banking/SwiftTransactions"));
const FraudAlerts = lazy(() => import("@/pages/banking/FraudAlerts"));
const LivenessVerification = lazy(() => import("@/pages/banking/LivenessVerification"));
const CbnReports = lazy(() => import("@/pages/banking/CbnReports"));
const CorrespondentBanks = lazy(() => import("@/pages/banking/CorrespondentBanks"));
const TelecomDashboard = lazy(() => import("@/pages/telecom/TelecomDashboard"));
const HealthcareDashboard = lazy(() => import("@/pages/healthcare/HealthcareDashboard"));
const EnergyDashboard = lazy(() => import("@/pages/energy/EnergyDashboard"));
const InsuranceDashboard = lazy(() => import("@/pages/insurance/InsuranceDashboard"));
const FintechDashboard = lazy(() => import("@/pages/fintech/FintechDashboard"));
const CrossSectorAlerts = lazy(() => import("@/pages/CrossSectorAlerts"));
const SlaTimers = lazy(() => import("@/pages/SlaTimers"));
const AdminUserManagement = lazy(() => import("@/pages/admin/AdminUserManagement"));
const SystemHealthDashboard = lazy(() => import("@/pages/admin/SystemHealthDashboard"));
const BreachIncidentCenter = lazy(() => import("@/pages/BreachIncidentCenter"));
const ConsentRecordManager = lazy(() => import("@/pages/ConsentRecordManager"));
const DpoAppointmentRegistry = lazy(() => import("@/pages/DpoAppointmentRegistry"));
const PublicComplianceRegistry = lazy(() => import("@/pages/PublicComplianceRegistry"));
const PenaltyCalculator = lazy(() => import("@/pages/PenaltyCalculator"));
const RiskScorecard = lazy(() => import("@/pages/RiskScorecard"));
const Article40Tracker = lazy(() => import("@/pages/Article40Tracker"));
const AdvancedAnalytics = lazy(() => import("@/pages/AdvancedAnalytics"));
const NotificationCenter = lazy(() => import("@/pages/NotificationCenter"));
const ComplianceCalendar = lazy(() => import("@/pages/ComplianceCalendar"));
const DocumentVault = lazy(() => import("@/pages/DocumentVault"));
const ApiKeyManagement = lazy(() => import("@/pages/ApiKeyManagement"));
const WebhookDelivery = lazy(() => import("@/pages/WebhookDelivery"));
const CrossSectorDataSharing = lazy(() => import("@/pages/CrossSectorDataSharing"));
const RetentionEnforcement = lazy(() => import("@/pages/RetentionEnforcement"));
const CertificateVerification = lazy(() => import("@/pages/CertificateVerification"));
const EnforcementTimeline = lazy(() => import("@/pages/EnforcementTimeline"));
const AiRiskEngine = lazy(() => import("@/pages/AiRiskEngine"));
const ComplianceRescoring = lazy(() => import("@/pages/ComplianceRescoring"));
const SmsAlerts = lazy(() => import("@/pages/SmsAlerts"));
const PdfExportCenter = lazy(() => import("@/pages/PdfExportCenter"));
const CustomizableDashboard = lazy(() => import("@/pages/CustomizableDashboard"));
const ChatSupport = lazy(() => import("@/pages/ChatSupport"));
const UserGuide = lazy(() => import("@/pages/UserGuide"));
const OnboardingChecklist = lazy(() => import("@/pages/OnboardingChecklist"));
const EmailDigestSettings = lazy(() => import("@/pages/EmailDigestSettings"));
const ChangelogAdmin = lazy(() => import("@/pages/ChangelogAdmin"));
const ComplianceTrend = lazy(() => import("@/pages/ComplianceTrend"));
const SecurityAuditDashboard = lazy(() => import("@/pages/SecurityAuditDashboard"));
const MultiOrgTrendCompare = lazy(() => import("@/pages/MultiOrgTrendCompare"));
const DSARLifecycle = lazy(() => import("@/pages/DSARLifecycle"));
const UserManagement = lazy(() => import("@/pages/UserManagement"));
const AuditExport = lazy(() => import("@/pages/AuditExport"));
const NIPReconciliation = lazy(() => import("@/pages/NIPReconciliation"));
const PlatformStats = lazy(() => import("@/pages/PlatformStats"));
const AIMLHub = lazy(() => import("@/pages/AIMLHub"));
const ModelRegistry = lazy(() => import("@/pages/ModelRegistry"));
const ARTDashboard = lazy(() => import("@/pages/ARTDashboard"));
const FeatureStorePage = lazy(() => import("@/pages/FeatureStorePage"));
const CertificateLifecycle = lazy(() => import("@/pages/CertificateLifecycle"));
const SectorBenchmarkDashboard = lazy(() => import("@/pages/SectorBenchmarkDashboard"));
const SectorComplianceDashboard = lazy(() => import("@/pages/SectorComplianceDashboard"));
const SectorComplianceDetail = lazy(() => import("@/pages/SectorComplianceDetail"));
const FinePaymentGateway = lazy(() => import("@/pages/FinePaymentGateway"));
const ComplianceCalendarPage = lazy(() => import("@/pages/ComplianceCalendarPage"));
const SBOMViewer = lazy(() => import("@/pages/SBOMViewer"));
const KnowledgeGraphVisualiser = lazy(() => import("@/pages/KnowledgeGraphVisualiser"));
const RAGAdvisor = lazy(() => import("@/pages/RAGAdvisor"));
const VectorSearchPage = lazy(() => import("@/pages/ai/VectorSearchPage"));
const LLMStudioPage = lazy(() => import("@/pages/ai/LLMStudioPage"));
const CocoIndexPage = lazy(() => import("@/pages/ai/CocoIndexPage"));
const AnomalyAlertsPage = lazy(() => import("@/pages/ai/AnomalyAlertsPage"));
const NetworkIntelligencePage = lazy(() => import("@/pages/NetworkIntelligencePage"));
const NocDashboard = lazy(() => import("@/pages/NocDashboard"));
const ThreatIntelligenceDashboard = lazy(() => import("@/pages/ThreatIntelligenceDashboard"));
const SocintDashboard = lazy(() => import("@/pages/SocintDashboard"));
const PhantomTideDashboard = lazy(() => import("@/pages/PhantomTideDashboard"));
const WazuhDashboard = lazy(() => import("@/pages/WazuhDashboard"));
const SigintDashboard = lazy(() => import("@/pages/SigintDashboard"));
const EstoridesDashboard = lazy(() => import("@/pages/EstoridesDashboard"));
const NocAgentDashboard = lazy(() => import("@/pages/NocAgentDashboard"));
const DataPipeline = lazy(() => import("@/pages/DataPipeline"));
const DataLineage = lazy(() => import("@/pages/DataLineage"));
const RegulatoryIntelligence = lazy(() => import("@/pages/RegulatoryIntelligence"));
const IncidentResponse = lazy(() => import("@/pages/IncidentResponse"));
const ComplianceGapAnalyzer = lazy(() => import("@/pages/ComplianceGapAnalyzer"));
const VendorRisk = lazy(() => import("@/pages/VendorRisk"));
const WhistleblowerPortal = lazy(() => import("@/pages/WhistleblowerPortal"));
const RegulatorySandbox = lazy(() => import("@/pages/RegulatorySandbox"));
const AIEthicsBoard = lazy(() => import("@/pages/AIEthicsBoard"));
const NationalIDVerification = lazy(() => import("@/pages/NationalIDVerification"));
const CrossAgencySharing = lazy(() => import("@/pages/CrossAgencySharing"));
const PrivacyImpactAssessment = lazy(() => import("@/pages/PrivacyImpactAssessment"));
const FinePayments = lazy(() => import("@/pages/FinePayments"));
const Phase13ConsentRecords = lazy(() => import("@/pages/Phase13ConsentRecords"));
const Phase13DpoRegistry = lazy(() => import("@/pages/Phase13DpoRegistry"));
const Phase13NotificationCenter = lazy(() => import("@/pages/Phase13NotificationCenter"));
const Phase13PenaltyCalculator = lazy(() => import("@/pages/Phase13PenaltyCalculator"));
const PenaltyDashboard = lazy(() => import("@/pages/PenaltyDashboard"));
const Phase13PublicRegistry = lazy(() => import("@/pages/Phase13PublicRegistry"));
const Phase13RiskScorecard = lazy(() => import("@/pages/Phase13RiskScorecard"));
const Phase13DataResidency = lazy(() => import("@/pages/Phase13DataResidency"));
const Phase13RateLimitDashboard = lazy(() => import("@/pages/Phase13RateLimitDashboard"));
const Phase13BulkDsar = lazy(() => import("@/pages/Phase13BulkDsar"));
const Phase13WhistleblowerCases = lazy(() => import("@/pages/Phase13WhistleblowerCases"));
const Phase13CrossBorderMonitor = lazy(() => import("@/pages/Phase13CrossBorderMonitor"));
const Phase13RegulatoryReporting = lazy(() => import("@/pages/Phase13RegulatoryReporting"));
const Phase13AdvancedAnalytics = lazy(() => import("@/pages/Phase13AdvancedAnalytics"));
const Phase13Article40 = lazy(() => import("@/pages/Phase13Article40"));
const Phase13ComplianceCalendar = lazy(() => import("@/pages/Phase13ComplianceCalendar"));
const HealthDashboard = lazy(() => import("@/pages/HealthDashboard"));
const AccreditationWorkflow = lazy(() => import("@/pages/AccreditationWorkflow"));
const SecurityDashboard = lazy(() => import("@/pages/SecurityDashboard"));
const MiddlewareHealth = lazy(() => import("@/pages/MiddlewareHealth"));
const PlatformIntelligence = lazy(() => import("@/pages/PlatformIntelligence"));
const DigitalTwin = lazy(() => import("@/pages/DigitalTwin"));

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
    <Switch>
      {/* Public pages — no DashboardLayout wrapper */}
      <Route path="/dpco-app" component={DpcoApp} />
      <Route path="/dpco-app/dashboard" component={DpcoPwaDashboard} />
      <Route path="/pwa-dashboard" component={PwaDashboard} />
      <Route path="/dpco-ui" component={DpcoPwaUI} />
      <Route path="/register" component={DpcoRegister} />
      <Route path="/status/:token" component={OrgStatusTracker} />
      <Route path="/status" component={OrgStatusTracker} />
      <Route>
    <DashboardLayout>
      {() => (
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/gov-dashboard" component={Dashboard} />
        <Route path="/discovery" component={DiscoveryEngine} />
        <Route path="/catalog" component={DataCatalog} />
        <Route path="/compliance" component={ComplianceEngine} />
        <Route path="/violations" component={ComplianceEngine} />
        <Route path="/siem" component={SiemAudit} />
        <Route path="/network" component={NetworkDPI} />
        <Route path="/financial" component={FinancialEnforcement} />
        <Route path="/streaming" component={StreamingEvents} />
        <Route path="/event-bus" component={EventBusMonitor} />
        <Route path="/ledger" component={LedgerExplorer} />
        <Route path="/ai-assistant" component={AIAssistant} />
        <Route path="/organizations" component={Organizations} />
        <Route path="/roles" component={RoleManagement} />
        <Route path="/workers" component={WorkerProcesses} />
        <Route path="/bgp" component={BgpRoutes} />
        <Route path="/bgp-routes" component={BgpRoutes} />
        <Route path="/network-intelligence" component={NetworkIntelligencePage} />
        <Route path="/noc" component={NocDashboard} />
        <Route path="/noc-agent" component={NocAgentDashboard} />
        <Route path="/platform-intelligence" component={PlatformIntelligence} />
        <Route path="/digital-twin" component={DigitalTwin} />
        <Route path="/temporal" component={TemporalWorkflows} />
        <Route path="/metrics" component={PrometheusMetrics} />
        <Route path="/pcap" component={ArkimePcap} />
        <Route path="/portal" component={OrgPortal} />
        <Route path="/engage-dpco" component={EngageDpco} />
        <Route path="/dpco/apply" component={DpcoApply} />
        <Route path="/accreditation/status" component={AccreditationStatus} />
        <Route path="/portal-review" component={PortalReview} />
        <Route path="/transfers" component={TransferApprovals} />
        <Route path="/monitoring" component={ContinuousMonitoring} />
        <Route path="/orchestration" component={OrchestrationDashboard} />
        <Route path="/leaderboard" component={ComplianceLeaderboard} />
        <Route path="/verify/:token" component={CertificateVerify} />
        <Route path="/receipt/:penaltyId" component={PenaltyReceipt} />
        <Route path="/reports" component={RegulatoryReports} />
        <Route path="/verify" component={CertificateVerify} />
        <Route path="/api-docs" component={ApiDocs} />
        <Route path="/audit-log" component={AuditLogViewer} />
        <Route path="/components" component={ComponentShowcase} />
        <Route path="/policy-templates" component={PolicyTemplates} />
        <Route path="/ai-governance" component={AiGovernance} />
        <Route path="/evidence" component={EvidencePackages} />
        <Route path="/sectors" component={SectorManagement} />
        <Route path="/citizen-rights" component={CitizenRightsPortal} />
        <Route path="/gitops" component={GitopsConfig} />
        <Route path="/data-flows" component={DataFlowVisualization} />
        <Route path="/tia" component={TiaAssessments} />
        <Route path="/remediation" component={RemediationWorkflows} />
        <Route path="/asset-graph" component={AssetGraph} />
        <Route path="/frameworks" component={FrameworkDashboard} />
        <Route path="/my-org" component={MyOrg} />
        <Route path="/enforcement-cases" component={EnforcementCases} />
        <Route path="/enforcement" component={EnforcementCases} />
        <Route path="/settings/notifications" component={NotificationSettings} />
        <Route path="/settings/alerting" component={AlertingSettings} />
        <Route path="/settings/cert-rotation" component={CertificateRotation} />
        <Route path="/sector-benchmark" component={SectorBenchmark} />
        <Route path="/consent" component={ConsentManagement} />
        <Route path="/breach-notification" component={BreachNotification} />
        <Route path="/dpo-registry" component={DpoRegistry} />
        <Route path="/dpo-dashboard" component={DpoDashboard} />
        <Route path="/dpia" component={DpiaAssessments} />
        <Route path="/ropa" component={RopaRecords} />
        <Route path="/retention" component={RetentionPolicies} />
        <Route path="/dpo-reports" component={DpoReports} />
        <Route path="/car" component={ComplianceAuditReturns} />
        <Route path="/audit-returns" component={ComplianceAuditReturns} />
        <Route path="/adequacy" component={AdequacyRegistry} />
        <Route path="/dpa" component={DataProcessingAgreements} />
        <Route path="/privacy-notices" component={PrivacyNotices} />
        <Route path="/cookie-consent" component={CookieConsent} />
        <Route path="/automated-decisions" component={AutomatedDecisions} />
        <Route path="/parental-consent" component={ParentalConsent} />
        <Route path="/staff-training" component={StaffTraining} />
        <Route path="/transfer-instruments" component={TransferInstruments} />
        <Route path="/data-export" component={DataExportJobs} />
        <Route path="/dcpmi" component={DcpmiThresholds} />
        {/* DPCO Stakeholder Portal */}
        <Route path="/dpco" component={DpcoPortal} />
        <Route path="/dpco/team" component={DpcoPortal} />
        <Route path="/dpco/training" component={StaffTraining} />
        <Route path="/dpco/registry" component={DpcoRegistry} />
        <Route path="/dpco/clients" component={DpcoClients} />
        <Route path="/dpco/verification" component={DpcoVerification} />
        <Route path="/dpco/audit" component={DpcoAuditWorkspace} />
        <Route path="/dpco/scorecard" component={DpcoScorecard} />
        <Route path="/dpco/onboard" component={DpcoOnboard} />
        <Route path="/dpco/evidence" component={DpcoEvidenceVault} />
        <Route path="/dpco/clients/:clientId" component={DpcoClientDashboard} />
        <Route path="/dpco/billing" component={DpcoBilling} />
        <Route path="/dpco/subscription" component={DpcoSubscription} />
        <Route path="/dpco/policy" component={DpcoPolicyHub} />
        <Route path="/dpco/renewal" component={DpcoRenewal} />
        <Route path="/dpco/ai-tools" component={DpcoAiTools} />
        <Route path="/dpco/performance-scorecard" component={DpcoPerformanceScorecard} />
        <Route path="/dpco-brochure" component={DpcoBrochure} />
        <Route path="/admin/revenue" component={AdminRevenue} />
        <Route path="/admin/registrations" component={AdminRegistrations} />
        <Route path="/admin/settings" component={AdminPlatformSettings} />
        <Route path="/admin" component={AdminPlatformSettings} />
        <Route path="/admin/accreditation" component={AdminAccreditation} />
        <Route path="/accreditation" component={AccreditationWorkflow} />
        <Route path="/dsar" component={DsarPublicPortal} />
        <Route path="/dsar-portal" component={DsarPublicPortal} />
        <Route path="/dpia-wizard" component={DpiaWizard} />
        <Route path="/ai-governance-scoring" component={AiGovernanceScoring} />
        <Route path="/sector-benchmarking" component={SectorBenchmarking} />
        <Route path="/webhooks" component={WebhookManagement} />
        <Route path="/search" component={GlobalSearch} />
        <Route path="/car-automation" component={CarAutomation} />
        <Route path="/developer" component={OpenApiPortal} />
        {/* Banking Services */}
        <Route path="/banking" component={BankingDashboard} />
        <Route path="/banking/institutions" component={BankingDashboard} />
        <Route path="/banking/kyc" component={KycManagement} />
        <Route path="/banking/aml" component={AmlCases} />
        <Route path="/aml-cases" component={AmlCases} />
        <Route path="/banking/watchlist" component={WatchlistScreening} />
        <Route path="/banking/payments" component={PaymentsMonitor} />
        <Route path="/banking/swift" component={SwiftTransactions} />
        <Route path="/banking/fraud" component={FraudAlerts} />
        <Route path="/banking/liveness" component={LivenessVerification} />
        <Route path="/banking/cbn-reports" component={CbnReports} />
        <Route path="/banking/correspondents" component={CorrespondentBanks} />
        {/* Sector Modules */}
        <Route path="/telecom" component={TelecomDashboard} />
        <Route path="/healthcare" component={HealthcareDashboard} />
        <Route path="/energy" component={EnergyDashboard} />
        <Route path="/insurance" component={InsuranceDashboard} />
        <Route path="/fintech" component={FintechDashboard} />
        {/* Operations & Admin */}
        <Route path="/cross-sector-alerts" component={CrossSectorAlerts} />
        <Route path="/alerts" component={CrossSectorAlerts} />
        <Route path="/sla-timers" component={SlaTimers} />
        <Route path="/admin/user-access" component={AdminUserManagement} />
        <Route path="/admin/system-health" component={SystemHealthDashboard} />
        <Route path="/breach-incidents" component={BreachIncidentCenter} />
        <Route path="/consent-records-legacy" component={ConsentRecordManager} />
        <Route path="/dpo-appointment-registry" component={DpoAppointmentRegistry} />
        <Route path="/public-registry-legacy" component={PublicComplianceRegistry} />
        <Route path="/penalty-calculator-legacy" component={PenaltyCalculator} />
        <Route path="/risk-scorecard-legacy" component={RiskScorecard} />
        <Route path="/article-40-tracker" component={Article40Tracker} />
        <Route path="/advanced-analytics" component={AdvancedAnalytics} />
        <Route path="/analytics" component={AdvancedAnalytics} />
        <Route path="/notifications" component={NotificationCenter} />
        <Route path="/compliance-calendar" component={ComplianceCalendar} />
        {/* Production Feature Sprint — Phase 3 */}
        <Route path="/document-vault" component={DocumentVault} />
        <Route path="/api-keys" component={ApiKeyManagement} />
        <Route path="/webhook-delivery" component={WebhookDelivery} />
        <Route path="/cross-sector-sharing" component={CrossSectorDataSharing} />
        <Route path="/retention-enforcement" component={RetentionEnforcement} />
        <Route path="/cert-verification" component={CertificateVerification} />
        <Route path="/enforcement-timeline" component={EnforcementTimeline} />
        <Route path="/ai-risk-engine" component={AiRiskEngine} />
        <Route path="/compliance-rescoring" component={ComplianceRescoring} />
        <Route path="/sms-alerts" component={SmsAlerts} />
        <Route path="/pdf-export" component={PdfExportCenter} />
        {/* Phase 5 — Customisable Dashboard, Chat Support, User Guide */}
        <Route path="/my-dashboard" component={CustomizableDashboard} />
        <Route path="/support-chat" component={ChatSupport} />
        <Route path="/user-guide" component={UserGuide} />
        {/* Phase 6 — Onboarding Checklist, Email Digest */}
        <Route path="/onboarding-checklist" component={OnboardingChecklist} />
        <Route path="/email-digest" component={EmailDigestSettings} />
        <Route path="/admin/changelog" component={ChangelogAdmin} />
        <Route path="/trends/:orgId" component={ComplianceTrend} />
        <Route path="/trends" component={ComplianceTrend} />
        {/* Phase 9 — Security Audit, Multi-Org Trends, DSAR Lifecycle, User Mgmt, Audit Export, NIP, Platform Stats */}
        <Route path="/security-audit" component={SecurityAuditDashboard} />
        <Route path="/security" component={SecurityAuditDashboard} />
        <Route path="/trend-compare" component={MultiOrgTrendCompare} />
        <Route path="/dsar-lifecycle" component={DSARLifecycle} />
        <Route path="/dsar-tracker" component={DSARLifecycle} />
        <Route path="/admin/users" component={UserManagement} />
        <Route path="/audit-export" component={AuditExport} />
        <Route path="/nip-reconciliation" component={NIPReconciliation} />
        <Route path="/platform-stats" component={PlatformStats} />
        <Route path="/ai/hub" component={AIMLHub} />
        <Route path="/ai-hub" component={AIMLHub} />
        <Route path="/ai/model-registry" component={ModelRegistry} />
        <Route path="/ai/art-dashboard" component={ARTDashboard} />
        <Route path="/ai/feature-store" component={FeatureStorePage} />
        <Route path="/ai/vector-search" component={VectorSearchPage} />
        <Route path="/ai/llm-studio" component={LLMStudioPage} />
        <Route path="/ai/cocoindex" component={CocoIndexPage} />
        <Route path="/ai/anomaly-alerts" component={AnomalyAlertsPage} />
        <Route path="/404" component={NotFound} />
        <Route path="/certificates" component={CertificateLifecycle} />
              <Route path="/sector-benchmarks" component={SectorBenchmarkDashboard} />
              <Route path="/fine-payments" component={FinePaymentGateway} />
              <Route path="/p11/compliance-calendar" component={ComplianceCalendarPage} />
              <Route path="/sbom" component={SBOMViewer} />
        <Route path="/data-pipeline" component={DataPipeline} />
        <Route path="/data-lineage" component={DataLineage} />
        <Route path="/regulatory-intelligence" component={RegulatoryIntelligence} />
        <Route path="/incident-response" component={IncidentResponse} />
        <Route path="/compliance-gap" component={ComplianceGapAnalyzer} />
        <Route path="/vendor-risk" component={VendorRisk} />
        <Route path="/whistleblower" component={WhistleblowerPortal} />
        <Route path="/regulatory-sandbox" component={RegulatorySandbox} />
        <Route path="/ai-ethics" component={AIEthicsBoard} />
        <Route path="/national-id" component={NationalIDVerification} />
        <Route path="/cross-agency" component={CrossAgencySharing} />
        <Route path="/pia" component={PrivacyImpactAssessment} />
        <Route path="/ndpa-fines" component={FinePayments} />
        {/* Phase 13 — Consent, DPO, Notifications, Penalty, Public Registry, Risk, Residency, Rate Limit, Bulk DSAR, Whistleblower, Cross-Border, Reporting */}
        <Route path="/consent-records" component={Phase13ConsentRecords} />
        <Route path="/p13/dpo-registry" component={Phase13DpoRegistry} />
        <Route path="/notification-center" component={Phase13NotificationCenter} />
        <Route path="/penalty-calculator" component={Phase13PenaltyCalculator} />
        <Route path="/penalty-dashboard" component={PenaltyDashboard} />
        <Route path="/public-registry" component={Phase13PublicRegistry} />
        <Route path="/risk-scorecard" component={Phase13RiskScorecard} />
        <Route path="/data-residency" component={Phase13DataResidency} />
        <Route path="/rate-limit-dashboard" component={Phase13RateLimitDashboard} />
        <Route path="/bulk-dsar" component={Phase13BulkDsar} />
        <Route path="/whistleblower-cases" component={Phase13WhistleblowerCases} />
        <Route path="/cross-border-monitor" component={Phase13CrossBorderMonitor} />
        <Route path="/regulatory-reporting" component={Phase13RegulatoryReporting} />
        <Route path="/p13-advanced-analytics" component={Phase13AdvancedAnalytics} />
        <Route path="/p13-article40" component={Phase13Article40} />
        <Route path="/p13-compliance-calendar" component={Phase13ComplianceCalendar} />
        <Route path="/knowledge-graph" component={KnowledgeGraphVisualiser} />
        <Route path="/ai/knowledge-graph" component={KnowledgeGraphVisualiser} />
        <Route path="/rag-advisor" component={RAGAdvisor} />
        <Route path="/ai/rag-advisor" component={RAGAdvisor} />
        <Route path="/sector-compliance" component={SectorComplianceDashboard} />
        <Route path="/sector-compliance/:sector" component={SectorComplianceDetail} />
        {/* Phase 25 — Health Dashboard, Accreditation Workflow */}
        <Route path="/health-dashboard" component={HealthDashboard} />
        <Route path="/middleware-health" component={MiddlewareHealth} />
        <Route path="/accreditation-workflow" component={AccreditationWorkflow} />
        {/* Security — wired from PR#19 */}
        <Route path="/security-dashboard" component={SecurityDashboard} />
        {/* Route aliases — common alternative URLs */}
        <Route path="/noc-dashboard" component={NocDashboard} />
        <Route path="/threat-intelligence" component={ThreatIntelligenceDashboard} />
        <Route path="/socint" component={SocintDashboard} />
        <Route path="/phantom-tide" component={PhantomTideDashboard} />
        <Route path="/wazuh" component={WazuhDashboard} />
        <Route path="/sigint" component={SigintDashboard} />
        <Route path="/estorides" component={EstoridesDashboard} />
        <Route path="/liveness-verification" component={LivenessVerification} />
        <Route path="/wiredigg" component={NetworkIntelligencePage} />
        {/* Catch-all — must be last */}
        <Route component={NotFound} />
      </Switch>
      )}
    </DashboardLayout>
      </Route>
    </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
