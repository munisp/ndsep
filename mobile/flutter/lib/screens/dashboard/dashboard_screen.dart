import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';

final dashboardStatsProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return ApiService().getDashboardStats();
});

final leaderboardProvider = FutureProvider<List<dynamic>>((ref) async {
  return ApiService().getLeaderboard(limit: 5);
});

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statsAsync = ref.watch(dashboardStatsProvider);
    final leaderboardAsync = ref.watch(leaderboardProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard', style: TextStyle(fontWeight: FontWeight.w800)),
        leading: Builder(builder: (ctx) => IconButton(
          icon: const Icon(Icons.menu),
          onPressed: () => Scaffold.of(ctx).openDrawer(),
        )),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.invalidate(dashboardStatsProvider);
              ref.invalidate(leaderboardProvider);
            },
          ),
        ],
      ),
      body: statsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF))),
        error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Color(0xFFEF4444)))),
        data: (stats) {
          final org = (stats['orgStats'] as Map?) ?? {};
          final asset = (stats['assetStats'] as Map?) ?? {};
          final violation = (stats['violationStats'] as Map?) ?? {};
          final penalty = (stats['penaltyStats'] as Map?) ?? {};
          final alert = (stats['alertStats'] as Map?) ?? {};
          final riskScore = double.tryParse(org['avgRisk']?.toString() ?? '0') ?? 0;
          final riskColor = riskScore > 70 ? const Color(0xFFEF4444) : riskScore > 40 ? const Color(0xFFF59E0B) : const Color(0xFF22C55E);

          return RefreshIndicator(
            color: const Color(0xFF00D4FF),
            onRefresh: () async {
              ref.invalidate(dashboardStatsProvider);
              ref.invalidate(leaderboardProvider);
            },
            child: ListView(padding: const EdgeInsets.all(16), children: [
              // Hero Card
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: const Color(0xFF0F172A),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFF1E293B)),
                ),
                child: Column(children: [
                  const Text('NATIONAL RISK SCORE', style: TextStyle(color: Color(0xFF64748B), fontSize: 11, letterSpacing: 2, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  Text(riskScore.toStringAsFixed(1), style: TextStyle(color: riskColor, fontSize: 64, fontWeight: FontWeight.w900)),
                  Text('Avg compliance: ${(double.tryParse(org['avgScore']?.toString() ?? '0') ?? 0).toStringAsFixed(1)}%',
                    style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
                ]),
              ),
              const SizedBox(height: 16),

              // KPI Grid
              GridView.count(
                crossAxisCount: 3, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                crossAxisSpacing: 8, mainAxisSpacing: 8, childAspectRatio: 1.1,
                children: [
                  _kpi('Organizations', org['total']?.toString() ?? '0', const Color(0xFF00D4FF)),
                  _kpi('Compliant', org['compliant']?.toString() ?? '0', const Color(0xFF22C55E)),
                  _kpi('Non-Compliant', org['nonCompliant']?.toString() ?? '0', const Color(0xFFEF4444)),
                  _kpi('Assets', asset['total']?.toString() ?? '0', const Color(0xFFA78BFA)),
                  _kpi('Outside Borders', asset['outsideBorders']?.toString() ?? '0', const Color(0xFFF59E0B)),
                  _kpi('Open Violations', violation['open']?.toString() ?? '0', const Color(0xFFF97316)),
                  _kpi('Critical', violation['critical']?.toString() ?? '0', const Color(0xFFDC2626)),
                  _kpi('Unresolved Alerts', alert['unresolved']?.toString() ?? '0', const Color(0xFFFB923C)),
                  _kpi('Pending \$', '\$${_fmt(penalty['pendingAmount'])}', const Color(0xFFFBBF24)),
                ],
              ),
              const SizedBox(height: 16),

              // Leaderboard
              leaderboardAsync.when(
                loading: () => const SizedBox.shrink(),
                error: (_, __) => const SizedBox.shrink(),
                data: (leaders) => Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0F172A),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFF1E293B)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Top Compliant Organizations', style: TextStyle(color: Color(0xFFF1F5F9), fontSize: 14, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 12),
                      ...leaders.asMap().entries.map((e) {
                        final org = e.value as Map;
                        final score = double.tryParse(org['complianceScore']?.toString() ?? '0') ?? 0;
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Row(children: [
                            Text('#${e.key + 1}', style: const TextStyle(color: Color(0xFF64748B), fontSize: 13, fontWeight: FontWeight.w600, fontFamily: 'monospace'), ),
                            const SizedBox(width: 12),
                            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(org['name']?.toString() ?? '', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 13, fontWeight: FontWeight.w600)),
                              Text(org['sector']?.toString() ?? '', style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                            ])),
                            Text('${score.toStringAsFixed(1)}%', style: TextStyle(
                              color: score >= 80 ? const Color(0xFF22C55E) : const Color(0xFFF59E0B),
                              fontSize: 15, fontWeight: FontWeight.w800,
                            )),
                          ]),
                        );
                      }),
                    ],
                  ),
                ),
              ),
            ]),
          );
        },
      ),
    );
  }

  Widget _kpi(String label, String value, Color color) => Container(
    padding: const EdgeInsets.all(10),
    decoration: BoxDecoration(
      color: const Color(0xFF0F172A),
      borderRadius: BorderRadius.circular(10),
      border: Border.all(color: const Color(0xFF1E293B)),
    ),
    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      Text(value, style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.w800)),
      const SizedBox(height: 4),
      Text(label, style: const TextStyle(color: Color(0xFF64748B), fontSize: 9), textAlign: TextAlign.center),
    ]),
  );

  String _fmt(dynamic val) {
    final n = double.tryParse(val?.toString() ?? '0') ?? 0;
    if (n >= 1e6) return '${(n / 1e6).toStringAsFixed(1)}M';
    if (n >= 1e3) return '${(n / 1e3).toStringAsFixed(0)}K';
    return n.toStringAsFixed(0);
  }
}
