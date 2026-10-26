/// NDSEP Flutter — API Service
/// Calls the NDSEP tRPC backend via HTTP batch requests.
/// Mirrors the React Native tRPC client behaviour.
library;

import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const String _defaultApiUrl = 'https://ndsep.ndpc.gov.ng';
const _storage = FlutterSecureStorage();

class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  late final Dio _dio = Dio(BaseOptions(
    baseUrl: const String.fromEnvironment('NDSEP_API_URL', defaultValue: _defaultApiUrl),
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 30),
    headers: {'Content-Type': 'application/json'},
  ))
    ..interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _storage.read(key: 'ndsep_session_token');
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (error, handler) {
        if (error.response?.statusCode == 401) {
          _storage.delete(key: 'ndsep_session_token');
        }
        handler.next(error);
      },
    ));

  /// Generic tRPC query call
  Future<T> query<T>(
    String procedure,
    Map<String, dynamic>? input,
    T Function(dynamic json) fromJson,
  ) async {
    final inputParam = input != null ? Uri.encodeComponent(jsonEncode({'0': {'json': input}})) : Uri.encodeComponent('{"0":{"json":null}}');
    final response = await _dio.get(
      '/api/trpc/$procedure',
      queryParameters: {'batch': '1', 'input': inputParam},
    );
    final data = (response.data as List).first;
    if (data['result'] == null) throw Exception(data['error']?['message'] ?? 'Unknown error');
    return fromJson(data['result']['data']['json']);
  }

  /// Generic tRPC mutation call
  Future<T> mutate<T>(
    String procedure,
    Map<String, dynamic> input,
    T Function(dynamic json) fromJson,
  ) async {
    final response = await _dio.post(
      '/api/trpc/$procedure?batch=1',
      data: {'0': {'json': input}},
    );
    final data = (response.data as List).first;
    if (data['result'] == null) throw Exception(data['error']?['message'] ?? 'Unknown error');
    return fromJson(data['result']['data']['json']);
  }

  List<dynamic> _records(dynamic json) {
    if (json is List<dynamic>) return json;
    if (json is Map) {
      final rows = json['rows'] ?? json['records'] ?? json['items'];
      if (rows is List<dynamic>) return rows;
    }
    throw const FormatException('NDSEP API returned an invalid collection payload');
  }

  // ─── Auth ────────────────────────────────────────────────────────────────────
  Future<Map<String, dynamic>?> getMe() => query('auth.me', null, (j) => j as Map<String, dynamic>?);

  // ─── Dashboard ───────────────────────────────────────────────────────────────
  Future<Map<String, dynamic>> getDashboardStats() =>
      query('dashboard.stats', null, (j) => j as Map<String, dynamic>);

  // ─── Organizations ───────────────────────────────────────────────────────────
  Future<List<dynamic>> listOrganizations({int limit = 100}) =>
      query('organizations.list', {'limit': limit}, (j) => j as List<dynamic>);

  /// Real path: organizations.byId (organizations.get does not exist)
  Future<Map<String, dynamic>> getOrganization(int id) =>
      query('organizations.byId', {'id': id}, (j) => j as Map<String, dynamic>);

  // ─── Compliance ──────────────────────────────────────────────────────────────
  /// Real path: compliance.violations accepts {limit, severity} only
  /// (organizationId is not a server input; org admins are filtered server-side)
  Future<List<dynamic>> listViolations({int limit = 50, String? severity, int? organizationId}) =>
      query('compliance.violations', {
        'limit': limit,
        if (severity != null) 'severity': severity,
      }, (j) => j as List<dynamic>);

  Future<void> resolveViolation(int id) =>
      mutate('compliance.resolveViolation', {'id': id}, (_) => null);

  // ─── Enforcement ─────────────────────────────────────────────────────────────
  /// Correct path: enforcementCases.list (not enforcement.cases)
  Future<List<dynamic>> listEnforcementCases({int limit = 50}) =>
      query('enforcementCases.list', {'limit': limit}, (j) => j as List<dynamic>);

  // ─── Financial ───────────────────────────────────────────────────────────────
  /// financial.penalties accepts {limit} only
  Future<List<dynamic>> listPenalties({int limit = 50, int? organizationId}) =>
      query('financial.penalties', {'limit': limit}, (j) => j as List<dynamic>);

  /// Issue penalty via orchestration workflow (orchestration.issuePenalty)
  Future<Map<String, dynamic>> issuePenalty({
    required String penaltyId,
    required String orgId,
    required String violationId,
    required double amountUsd,
    String currency = 'USD',
  }) => mutate('orchestration.issuePenalty', {
        'penaltyId': penaltyId,
        'orgId': orgId,
        'violationId': violationId,
        'amountUsd': amountUsd,
        'currency': currency,
      }, (j) => j as Map<String, dynamic>);

  /// Create penalty directly via financial.createPenalty
  Future<Map<String, dynamic>> createPenalty({
    required int organizationId,
    required double amount,
    String currency = 'NGN',
    required String description,
    String? violationId,
  }) => mutate('financial.createPenalty', {
        'organizationId': organizationId,
        'amount': amount,
        'currency': currency,
        'description': description,
        if (violationId != null) 'violationId': int.tryParse(violationId),
      }, (j) => j as Map<String, dynamic>);

  Future<Map<String, dynamic>> getPenaltyReceipt(int penaltyId) =>
      query('financial.receipt', {'penaltyId': penaltyId}, (j) => j as Map<String, dynamic>);

  /// Dispute penalty via orchestration.disputePenalty
  Future<void> disputePenalty({
    required String penaltyId,
    required String orgId,
    required double amountUsd,
    required String disputeRef,
  }) => mutate('orchestration.disputePenalty', {
        'penaltyId': penaltyId,
        'orgId': orgId,
        'amountUsd': amountUsd,
        'disputeRef': disputeRef,
      }, (_) => null);

  // ─── Security / SIEM ─────────────────────────────────────────────────────────
  /// Correct path: siem.alerts (not security.alerts)
  Future<List<dynamic>> listAlerts({int limit = 50, bool resolved = false}) =>
      query('siem.alerts', {'limit': limit, 'resolved': resolved}, (j) => j as List<dynamic>);

  /// Correct path: siem.resolveAlert (not security.resolveAlert)
  /// Real input key: siem.resolveAlert takes {alertId} (not {id})
  Future<void> resolveAlert(int id) =>
      mutate('siem.resolveAlert', {'alertId': id}, (_) => null);

  // ─── Assets ──────────────────────────────────────────────────────────────────
  /// Real input key: assets.list takes {orgId, limit} (not organizationId)
  Future<List<dynamic>> listAssets({int limit = 100, int? organizationId}) =>
      query('assets.list', {
        'limit': limit,
        if (organizationId != null) 'orgId': organizationId,
      }, (j) => j as List<dynamic>);

  // ─── Citizen Rights ──────────────────────────────────────────────────────────
  /// citizenRights.list accepts {status, requestType} only (no limit server-side)
  Future<List<dynamic>> listCitizenRequests({int limit = 50, String? status, String? requestType}) =>
      query('citizenRights.list', {
        if (status != null) 'status': status,
        if (requestType != null) 'requestType': requestType,
      }, (j) => j as List<dynamic>);

  /// Real path: citizenRights.submit (citizenRights.create does not exist)
  Future<Map<String, dynamic>> createCitizenRequest({
    required String requestType,
    required String description,
    required String citizenName,
    required String citizenEmail,
  }) => mutate('citizenRights.submit', {
        'requestType': requestType,
        'description': description,
        'citizenName': citizenName,
        'citizenEmail': citizenEmail,
      }, (j) => j as Map<String, dynamic>);

  // ─── Audit ───────────────────────────────────────────────────────────────────
  /// Canonical path: siem.auditLogs (the duplicate top-level `auditLogs` mount was
  /// unmounted in Round-16 integration; siem.auditLogs accepts {limit, search, action}).
  Future<List<dynamic>> listAuditLogs({int limit = 100}) =>
      query('siem.auditLogs', {'limit': limit}, (j) => j as List<dynamic>);

  // ─── Notifications ───────────────────────────────────────────────────────────
  Future<List<dynamic>> listNotifications({int limit = 50}) =>
      query('notifications.list', {'limit': limit}, (j) => j as List<dynamic>);

  /// notifications.markRead takes {id} only; the "mark all" path is
  /// notifications.markAllRead (no input).
  Future<void> markNotificationRead({int? id, bool all = false}) {
    if (all || id == null) {
      return mutate('notifications.markAllRead', {}, (_) => null);
    }
    return mutate('notifications.markRead', {'id': id}, (_) => null);
  }

  // ─── Portal ──────────────────────────────────────────────────────────────────
  Future<Map<String, dynamic>> getMyOrgPortal() =>
      query('portal.myOrg', null, (j) => j as Map<String, dynamic>);

  // ─── Leaderboard ─────────────────────────────────────────────────────────────
  Future<List<dynamic>> getLeaderboard({int limit = 5, String? sector}) =>
      query('leaderboard.list', {'limit': limit, if (sector != null) 'sector': sector}, (j) => j as List<dynamic>);

  // ─── Reports ─────────────────────────────────────────────────────────────────
  Future<List<dynamic>> listViolationReports({int limit = 50}) =>
      query('reports.violations', {'limit': limit}, (j) => j as List<dynamic>);

  Future<List<dynamic>> listPenaltyReports({int limit = 50}) =>
      query('reports.penalties', {'limit': limit}, (j) => j as List<dynamic>);

  Future<Map<String, dynamic>> generateReport({required String reportType, String format = 'json'}) =>
      mutate('reports.generate', {'reportType': reportType, 'format': format}, (j) => j as Map<String, dynamic>);

  Future<Map<String, dynamic>> scheduleReport({required String reportType, required String frequency, List<String> recipients = const []}) =>
      mutate('reports.schedule', {'reportType': reportType, 'frequency': frequency, 'recipients': recipients}, (j) => j as Map<String, dynamic>);

  // ─── TIA Assessments ─────────────────────────────────────────────────────────
  /// tia.list accepts {orgId} only (no limit server-side)
  Future<List<dynamic>> listTiaAssessments({int limit = 50}) =>
      query('tia.list', {}, (j) => j as List<dynamic>);

  /// Real input: tia.create takes {organizationId, destinationCountry,
  /// legalBasis (required), dataCategories: string[], riskLevel}
  Future<Map<String, dynamic>> createTiaAssessment({
    required int organizationId,
    required String destinationCountry,
    List<String>? dataCategories,
    required String legalBasis,
    String riskLevel = 'medium',
  }) => mutate('tia.create', {
        'organizationId': organizationId,
        'destinationCountry': destinationCountry,
        if (dataCategories != null) 'dataCategories': dataCategories,
        'legalBasis': legalBasis,
        'riskLevel': riskLevel,
      }, (j) => j as Map<String, dynamic>);

  // ─── Remediation ─────────────────────────────────────────────────────────────
  /// remediation.list accepts {orgId, status} only (no limit server-side)
  Future<List<dynamic>> listRemediationWorkflows({int limit = 100, String? status}) =>
      query('remediation.list', {if (status != null) 'status': status}, (j) => j as List<dynamic>);

  /// Real input: remediation.create takes {orgId, actionType, priority,
  /// description, notes} (title/dueDate are not server inputs)
  Future<Map<String, dynamic>> createRemediationWorkflow({
    required int organizationId,
    required String actionType,
    String? description,
    String priority = 'medium',
    String? notes,
  }) => mutate('remediation.create', {
        'orgId': organizationId,
        'actionType': actionType,
        if (description != null) 'description': description,
        'priority': priority,
        if (notes != null) 'notes': notes,
      }, (j) => j as Map<String, dynamic>);

  /// Real path: remediation.update with status 'completed'
  /// (remediation.complete does not exist)
  Future<void> completeRemediationWorkflow(int id) =>
      mutate('remediation.update', {'id': id, 'status': 'completed'}, (_) => null);

  // ─── DPCO Operations ─────────────────────────────────────────────────────────
  Future<Map<String, dynamic>> getDpcoDashboardStats() =>
      query('dpco.dashboardStats', null, (j) => j as Map<String, dynamic>);

  Future<List<dynamic>> listDpcoOrganisations({int limit = 50, int offset = 0}) =>
      query('dpco.listOrganisations', {'limit': limit, 'offset': offset}, _records);

  Future<List<dynamic>> listDpcoClients() =>
      query('dpco.listClients', null, _records);

  Future<List<dynamic>> listDpcoAuditEngagements() =>
      query('dpco.listAuditEngagements', null, _records);

  Future<List<dynamic>> listDpcoVerificationStatements() =>
      query('dpco.listVerificationStatements', null, _records);

  Future<List<dynamic>> listDpcoTrainingSessions() =>
      query('dpco.listTrainingSessions', null, _records);

  Future<List<dynamic>> listDpcoPolicyDrafts() =>
      query('dpco.listPolicyDrafts', null, _records);

  // ─── Banking / KYC ───────────────────────────────────────────────────────────
  Future<Map<String, dynamic>> getBankingInstitutionStats() =>
      query('banking.institutions.institutionStats', null, (j) => j as Map<String, dynamic>);

  Future<Map<String, dynamic>> listBankingInstitutions({int page = 1, int limit = 20}) =>
      query('banking.institutions.listInstitutions', {'page': page, 'limit': limit}, (j) => j as Map<String, dynamic>);

  Future<List<dynamic>> listKycRecords({int limit = 50, String? status, int? bankId}) =>
      query('banking.kyc.list', {
        'limit': limit,
        if (status != null) 'status': status,
        if (bankId != null) 'bankId': bankId,
      }, _records);

  /// Real path: banking.kyc.create (banking.kyc.submit does not exist)
  Future<Map<String, dynamic>> submitKyc({
    required int bankId,
    required String subjectType,
    required String fullName,
    required String bvn,
    String nationality = 'Nigerian',
    String? dateOfBirth,
  }) => mutate('banking.kyc.create', {
        'bankId': bankId,
        'subjectType': subjectType,
        'fullName': fullName,
        'bvn': bvn,
        'nationality': nationality,
        if (dateOfBirth != null) 'dateOfBirth': dateOfBirth,
      }, (j) => j as Map<String, dynamic>);

  Future<List<dynamic>> listBankingWatchlist({int limit = 50}) =>
      query('banking.watchlist.list', {'limit': limit}, _records);

  /// Real path: banking.payments.listNip (banking.payments.list does not exist;
  /// the payments router exposes listNip/listRtgs/paymentStats)
  Future<List<dynamic>> listBankingPayments({int limit = 50}) =>
      query('banking.payments.listNip', {'limit': limit}, _records);

  Future<List<dynamic>> listSwiftMessages({int limit = 50}) =>
      query('banking.swift.list', {'limit': limit}, _records);

  Future<List<dynamic>> listFraudAlerts({int limit = 50}) =>
      query('banking.fraud.list', {'limit': limit}, _records);

  Future<List<dynamic>> listCbnReports({int limit = 50}) =>
      query('banking.cbnReports.list', {'limit': limit}, _records);

  Future<List<dynamic>> listCorrespondentBanks({int limit = 50}) =>
      query('banking.correspondents.list', {'limit': limit}, _records);

  // ─── AML ─────────────────────────────────────────────────────────────────────
  Future<List<dynamic>> listAmlCases({int limit = 50, String? status}) =>
      query('banking.aml.list', {
        'limit': limit,
        if (status != null) 'status': status,
      }, _records);

  // ─── Monitoring ──────────────────────────────────────────────────────────────
  Future<Map<String, dynamic>> getMonitoringStats() =>
      query('monitoring.stats', null, (j) => j as Map<String, dynamic>);

  Future<List<dynamic>> listSlaBreaches({int limit = 50}) =>
      query('monitoring.slaBreaches', {'limit': limit}, (j) => j as List<dynamic>);

  Future<List<dynamic>> listDriftAlerts({int limit = 50}) =>
      query('monitoring.driftAlerts', {'limit': limit}, (j) => j as List<dynamic>);

  // ─── Workers ─────────────────────────────────────────────────────────────────
  Future<List<dynamic>> getWorkerStatus() =>
      query('workers.status', null, (j) => j as List<dynamic>);

  // ─── Compliance Calendar ──────────────────────────────────────────────────────
  Future<List<dynamic>> getCalendarEvents({required String startDate, required String endDate, int? orgId, String? sector}) =>
      query('complianceCalendar.events', {
        'startDate': startDate,
        'endDate': endDate,
        if (orgId != null) 'orgId': orgId,
        if (sector != null) 'sector': sector,
      }, (j) => j as List<dynamic>);

  Future<List<dynamic>> getUpcomingDeadlines({int days = 30}) =>
      query('complianceCalendar.upcomingDeadlines', {'days': days}, (j) => j as List<dynamic>);

  Future<List<dynamic>> listCustomCalendarEvents({int page = 1, int limit = 20, String? sector, String? priority, String? status, String? search}) =>
      query('complianceCalendar.listCustom', {
        'page': page,
        'limit': limit,
        if (sector != null) 'sector': sector,
        if (priority != null) 'priority': priority,
        if (status != null) 'status': status,
        if (search != null) 'search': search,
      }, (j) => j as List<dynamic>);

  Future<Map<String, dynamic>> createCalendarEvent({
    required String title,
    required String eventType,
    required String priority,
    required String eventDate,
    required String status,
    String? description,
    String? endDate,
    int? organizationId,
    String? sector,
    String? assignedTo,
    String? recurrence,
    int reminderDays = 7,
    String? notes,
  }) => mutate('complianceCalendar.createEvent', {
        'title': title,
        'eventType': eventType,
        'priority': priority,
        'eventDate': eventDate,
        'status': status,
        if (description != null) 'description': description,
        if (endDate != null) 'endDate': endDate,
        if (organizationId != null) 'organizationId': organizationId,
        if (sector != null) 'sector': sector,
        if (assignedTo != null) 'assignedTo': assignedTo,
        if (recurrence != null) 'recurrence': recurrence,
        'reminderDays': reminderDays,
        if (notes != null) 'notes': notes,
      }, (j) => j as Map<String, dynamic>);

  // ─── Public Complaints (NDPA s.46) ───────────────────────────────────────────
  /// Staff triage queue. Returns {data, total, page, limit}.
  Future<Map<String, dynamic>> listComplaints({String? status, String? category, String? search, bool slaBreachedOnly = false, bool unassignedOnly = false, int page = 1, int limit = 20}) =>
      query('publicComplaints.list', {
        if (status != null) 'status': status,
        if (category != null) 'category': category,
        if (search != null && search.isNotEmpty) 'search': search,
        'slaBreachedOnly': slaBreachedOnly,
        'unassignedOnly': unassignedOnly,
        'page': page,
        'limit': limit,
      }, (j) => j as Map<String, dynamic>);

  /// Complaint detail incl. status timeline (events), attachments, merges.
  Future<Map<String, dynamic>> getComplaint(int id) =>
      query('publicComplaints.get', {'id': id}, (j) => j as Map<String, dynamic>);

  Future<Map<String, dynamic>> getComplaintStats() =>
      query('publicComplaints.stats', null, (j) => j as Map<String, dynamic>);

  /// Public reference-code tracking (publicProcedure, rate-limited server-side).
  Future<Map<String, dynamic>> trackComplaint({required String referenceCode, String? complainantEmail}) =>
      query('publicComplaints.trackComplaint', {
        'referenceCode': referenceCode,
        if (complainantEmail != null && complainantEmail.isNotEmpty) 'complainantEmail': complainantEmail,
      }, (j) => j as Map<String, dynamic>);

  // ─── Enforcement case detail ─────────────────────────────────────────────────
  Future<List<dynamic>> getEnforcementCaseTimeline(int caseId) =>
      query('enforcementCases.timeline', {'caseId': caseId}, (j) => j as List<dynamic>);

  Future<Map<String, dynamic>> getEnforcementOpenCount() =>
      query('enforcementCases.openCount', null, (j) => j as Map<String, dynamic>);

  // ─── Settlement workflow ─────────────────────────────────────────────────────
  /// Returns {rows}.
  Future<List<dynamic>> listSettlements({String? status, String? caseRef, int limit = 50}) =>
      query('settlementWorkflow.listSettlements', {
        if (status != null) 'status': status,
        if (caseRef != null && caseRef.isNotEmpty) 'caseRef': caseRef,
        'limit': limit,
      }, _records);

  /// Returns {settlement, terms, approvals, instalments}.
  Future<Map<String, dynamic>> getSettlement(int settlementId) =>
      query('settlementWorkflow.getSettlement', {'settlementId': settlementId}, (j) => j as Map<String, dynamic>);

  // ─── Data Sovereignty / Hosting verification ─────────────────────────────────
  /// Verification queue: latest run per declaration. Returns {rows, note}.
  Future<List<dynamic>> listHostingVerdicts({String? status, int limit = 200}) =>
      query('hostingVerification.listVerdicts', {
        if (status != null) 'status': status,
        'limit': limit,
      }, _records);

  /// Latest verdict + per-host evidence for one declaration.
  /// Returns {run, hosts, note}.
  Future<Map<String, dynamic>> getDeclarationVerdict(int declarationId) =>
      query('hostingVerification.declarationVerdict', {'declarationId': declarationId}, (j) => j as Map<String, dynamic>);

  Future<Map<String, dynamic>> getHostingVerificationStats() =>
      query('hostingVerification.stats', null, (j) => j as Map<String, dynamic>);

  /// Hosting declarations register. Returns {rows, note}.
  Future<List<dynamic>> listHostingDeclarations({String? status, int limit = 200}) =>
      query('dataSovereignty.listDeclarations', {
        if (status != null) 'status': status,
        'limit': limit,
      }, _records);

  /// Latest sovereignty score per entity, worst first. Returns {rows, note}.
  Future<List<dynamic>> getSovereigntyScoreRegister({String? tier, int limit = 200}) =>
      query('dataSovereignty.scoreRegister', {
        if (tier != null) 'tier': tier,
        'limit': limit,
      }, _records);

  /// Sector heat map rows (avg score, at-risk counts per entity_type).
  Future<List<dynamic>> getSovereigntySectorHeatMap() =>
      query('dataSovereignty.sectorHeatMap', null, _records);
}
