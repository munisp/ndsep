/// NDSEP Flutter — Entry Point
/// Full navigation with drawer (grouped sections) + bottom tabs + go_router
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'screens/dashboard/dashboard_screen.dart';
import 'screens/compliance/compliance_screen.dart';
import 'screens/enforcement/enforcement_screen.dart';
import 'screens/siem/security_alerts_screen.dart';
import 'screens/assets/asset_registry_screen.dart';
import 'screens/portal/portal_screen.dart';
import 'screens/compliance/citizen_rights_screen.dart';
import 'screens/dashboard/organizations_screen.dart';
import 'screens/dashboard/organization_detail_screen.dart';
import 'screens/enforcement/penalty_detail_screen.dart';
import 'screens/audit/audit_log_screen.dart';
import 'screens/dashboard/notifications_screen.dart';
import 'screens/auth/login_screen.dart';
import 'screens/compliance/leaderboard_screen.dart';
import 'screens/enforcement/remediation_workflows_screen.dart';
import 'screens/compliance/breach_incidents_screen.dart';
import 'screens/compliance/consent_management_screen.dart';
import 'screens/compliance/cookie_consent_screen.dart';
import 'screens/compliance/dpia_screen.dart';
import 'screens/compliance/dpo_registry_screen.dart';
import 'screens/compliance/vendor_risk_screen.dart';
import 'screens/tia/tia_assessments_screen.dart';
import 'screens/financial/financial_enforcement_screen.dart';
import 'screens/banking/banking_dashboard_screen.dart';
import 'screens/middleware/middleware_health_screen.dart';
import 'screens/reports/regulatory_reports_screen.dart';
import 'screens/ai/ai_advisor_screen.dart';
import 'screens/dpco/dpco_portal_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  const storage = FlutterSecureStorage();
  final token = await storage.read(key: 'ndsep_session_token');
  runApp(ProviderScope(child: NdsepApp(isAuthenticated: token != null)));
}

class NdsepApp extends StatelessWidget {
  final bool isAuthenticated;
  const NdsepApp({super.key, required this.isAuthenticated});

  @override
  Widget build(BuildContext context) {
    final router = GoRouter(
      initialLocation: isAuthenticated ? '/' : '/login',
      routes: [
        ShellRoute(
          builder: (context, state, child) => AppShell(child: child),
          routes: [
            GoRoute(path: '/', builder: (_, __) => const DashboardScreen()),
            GoRoute(path: '/compliance', builder: (_, __) => const ComplianceScreen()),
            GoRoute(path: '/enforcement', builder: (_, __) => const EnforcementScreen()),
            GoRoute(path: '/alerts', builder: (_, __) => const SecurityAlertsScreen()),
            GoRoute(path: '/organizations', builder: (_, __) => const OrganizationsScreen()),
            GoRoute(path: '/organizations/:id', builder: (_, state) => OrganizationDetailScreen(orgId: int.parse(state.pathParameters['id']!))),
            GoRoute(path: '/assets', builder: (_, __) => const AssetRegistryScreen()),
            GoRoute(path: '/citizen-rights', builder: (_, __) => const CitizenRightsScreen()),
            GoRoute(path: '/portal', builder: (_, __) => const PortalScreen()),
            GoRoute(path: '/audit', builder: (_, __) => const AuditLogScreen()),
            GoRoute(path: '/notifications', builder: (_, __) => const NotificationsScreen()),
            GoRoute(path: '/penalties/:id', builder: (_, state) => PenaltyDetailScreen(penaltyId: int.parse(state.pathParameters['id']!))),
            GoRoute(path: '/leaderboard', builder: (_, __) => const ComplianceLeaderboardScreen()),
            GoRoute(path: '/remediation', builder: (_, __) => const RemediationWorkflowsScreen()),
            // Compliance & Governance
            GoRoute(path: '/breaches', builder: (_, __) => const BreachIncidentsScreen()),
            GoRoute(path: '/consent', builder: (_, __) => const ConsentManagementScreen()),
            GoRoute(path: '/cookie-consent', builder: (_, __) => const CookieConsentScreen()),
            GoRoute(path: '/dpia', builder: (_, __) => const DpiaScreen()),
            GoRoute(path: '/dpo-registry', builder: (_, __) => const DpoRegistryScreen()),
            GoRoute(path: '/vendor-risk', builder: (_, __) => const VendorRiskScreen()),
            GoRoute(path: '/tia', builder: (_, __) => const TiaAssessmentsScreen()),
            // Enforcement & Finance
            GoRoute(path: '/financial', builder: (_, __) => const FinancialEnforcementScreen()),
            // Operations
            GoRoute(path: '/banking', builder: (_, __) => const BankingDashboardScreen()),
            GoRoute(path: '/middleware', builder: (_, __) => const MiddlewareHealthScreen()),
            GoRoute(path: '/reports', builder: (_, __) => const RegulatoryReportsScreen()),
            GoRoute(path: '/ai-advisor', builder: (_, __) => const AiAdvisorScreen()),
            GoRoute(path: '/dpco', builder: (_, __) => const DpcoPortalScreen()),
          ],
        ),
        GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      ],
    );

    return MaterialApp.router(
      title: 'NDSEP',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF00D4FF),
          brightness: Brightness.dark,
          surface: const Color(0xFF0A0E1A),
          primary: const Color(0xFF00D4FF),
        ),
        scaffoldBackgroundColor: const Color(0xFF0A0E1A),
        cardColor: const Color(0xFF0F172A),
        useMaterial3: true,
        fontFamily: 'Inter',
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF0A0E1A),
          foregroundColor: Color(0xFFF1F5F9),
          elevation: 0,
          surfaceTintColor: Colors.transparent,
        ),
        drawerTheme: const DrawerThemeData(
          backgroundColor: Color(0xFF0A0E1A),
          surfaceTintColor: Colors.transparent,
        ),
        navigationBarTheme: const NavigationBarThemeData(
          backgroundColor: Color(0xFF0A0E1A),
          indicatorColor: Color(0xFF00D4FF20),
        ),
      ),
      routerConfig: router,
    );
  }
}

/// App shell with drawer + bottom navigation bar
class AppShell extends StatefulWidget {
  final Widget child;
  const AppShell({super.key, required this.child});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _selectedBottomIndex = 0;

  static const _bottomTabs = [
    {'path': '/', 'label': 'Dashboard', 'icon': Icons.dashboard_outlined},
    {'path': '/compliance', 'label': 'Compliance', 'icon': Icons.verified_outlined},
    {'path': '/enforcement', 'label': 'Enforcement', 'icon': Icons.gavel_outlined},
    {'path': '/alerts', 'label': 'Alerts', 'icon': Icons.security_outlined},
    {'path': '/reports', 'label': 'Reports', 'icon': Icons.assessment_outlined},
  ];

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.toString();
    // Sync bottom tab selection with current route
    for (int i = 0; i < _bottomTabs.length; i++) {
      if (location == _bottomTabs[i]['path']) {
        _selectedBottomIndex = i;
        break;
      }
    }

    return Scaffold(
      drawer: const AppDrawer(),
      body: widget.child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedBottomIndex,
        onDestinationSelected: (index) {
          setState(() => _selectedBottomIndex = index);
          context.go(_bottomTabs[index]['path'] as String);
        },
        destinations: _bottomTabs.map((tab) => NavigationDestination(
          icon: Icon(tab['icon'] as IconData),
          label: tab['label'] as String,
        )).toList(),
      ),
    );
  }
}

class AppDrawer extends StatelessWidget {
  const AppDrawer({super.key});

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.toString();

    Widget navItem(String label, String path, IconData icon) {
      final isActive = location == path || (path != '/' && location.startsWith(path));
      return ListTile(
        leading: Icon(icon, color: isActive ? const Color(0xFF00D4FF) : const Color(0xFF64748B), size: 20),
        title: Text(label, style: TextStyle(
          color: isActive ? const Color(0xFF00D4FF) : const Color(0xFF94A3B8),
          fontSize: 14, fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
        )),
        tileColor: isActive ? const Color(0xFF00D4FF08) : Colors.transparent,
        onTap: () { Navigator.pop(context); context.go(path); },
      );
    }

    Widget sectionHeader(String title) {
      return Padding(
        padding: const EdgeInsets.only(left: 16, top: 16, bottom: 4),
        child: Text(title, style: const TextStyle(
          color: Color(0xFF64748B), fontSize: 11, fontWeight: FontWeight.w700,
          letterSpacing: 1.2,
        )),
      );
    }

    return Drawer(
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(20),
              child: Row(children: [
                Container(
                  width: 40, height: 40, decoration: BoxDecoration(
                    color: const Color(0xFF00D4FF20), borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: const Color(0xFF00D4FF50)),
                  ),
                  child: const Center(child: Text('NG', style: TextStyle(color: Color(0xFF00D4FF), fontWeight: FontWeight.w900, fontSize: 14))),
                ),
                const SizedBox(width: 12),
                const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('NDSEP', style: TextStyle(color: Color(0xFFF1F5F9), fontWeight: FontWeight.w900, fontSize: 16, letterSpacing: 2)),
                  Text('Enforcement Platform', style: TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                ]),
              ]),
            ),
            const Divider(color: Color(0xFF1E293B)),
            Expanded(child: ListView(padding: EdgeInsets.zero, children: [
              // Core
              sectionHeader('CORE'),
              navItem('Dashboard', '/', Icons.dashboard_outlined),
              navItem('Organizations', '/organizations', Icons.business_outlined),
              navItem('Notifications', '/notifications', Icons.notifications_outlined),

              // Compliance & Governance
              sectionHeader('COMPLIANCE'),
              navItem('Compliance', '/compliance', Icons.verified_outlined),
              navItem('Breach Incidents', '/breaches', Icons.warning_amber_outlined),
              navItem('Consent Management', '/consent', Icons.handshake_outlined),
              navItem('Cookie Consent', '/cookie-consent', Icons.cookie_outlined),
              navItem('DPIA', '/dpia', Icons.assignment_outlined),
              navItem('DPO Registry', '/dpo-registry', Icons.admin_panel_settings_outlined),
              navItem('Citizen Rights (DSAR)', '/citizen-rights', Icons.people_outlined),
              navItem('Vendor Risk', '/vendor-risk', Icons.shield_outlined),
              navItem('TIA Assessments', '/tia', Icons.travel_explore_outlined),
              navItem('Leaderboard', '/leaderboard', Icons.leaderboard_outlined),

              // Enforcement & Finance
              sectionHeader('ENFORCEMENT'),
              navItem('Enforcement', '/enforcement', Icons.gavel_outlined),
              navItem('Financial Enforcement', '/financial', Icons.account_balance_wallet_outlined),
              navItem('Remediation', '/remediation', Icons.build_circle_outlined),

              // Operations & Intelligence
              sectionHeader('OPERATIONS'),
              navItem('Security Alerts', '/alerts', Icons.security_outlined),
              navItem('Asset Registry', '/assets', Icons.storage_outlined),
              navItem('Banking & KYC', '/banking', Icons.account_balance_outlined),
              navItem('AI Advisor', '/ai-advisor', Icons.psychology_outlined),
              navItem('DPCO Portal', '/dpco', Icons.web_outlined),
              navItem('Middleware Health', '/middleware', Icons.monitor_heart_outlined),
              navItem('Org Portal', '/portal', Icons.web_outlined),
              navItem('Audit Log', '/audit', Icons.history_outlined),
              navItem('Reports', '/reports', Icons.assessment_outlined),
            ])),
          ],
        ),
      ),
    );
  }
}
