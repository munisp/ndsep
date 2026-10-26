import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../services/api_service.dart';

final enforcementCasesProvider = FutureProvider<List<dynamic>>((ref) async => ApiService().listEnforcementCases(limit: 50));
final penaltiesProvider = FutureProvider<List<dynamic>>((ref) async => ApiService().listPenalties(limit: 50));

class EnforcementScreen extends ConsumerStatefulWidget {
  const EnforcementScreen({super.key});
  @override ConsumerState<EnforcementScreen> createState() => _EnforcementScreenState();
}
class _EnforcementScreenState extends ConsumerState<EnforcementScreen> with SingleTickerProviderStateMixin {
  late TabController _tabs;
  @override void initState() { super.initState(); _tabs = TabController(length: 2, vsync: this); }
  @override void dispose() { _tabs.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Enforcement', style: TextStyle(fontWeight: FontWeight.w800)),
        leading: Builder(builder: (ctx) => IconButton(icon: const Icon(Icons.menu), onPressed: () => Scaffold.of(ctx).openDrawer())),
        bottom: TabBar(controller: _tabs, tabs: const [Tab(text: 'Cases'), Tab(text: 'Penalties')],
          labelColor: const Color(0xFF00D4FF), unselectedLabelColor: const Color(0xFF64748B),
          indicatorColor: const Color(0xFF00D4FF)),
      ),
      body: TabBarView(controller: _tabs, children: [
        // Cases Tab
        ref.watch(enforcementCasesProvider).when(
          loading: () => const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF))),
          error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Color(0xFFEF4444)))),
          data: (cases) => ListView.builder(
            padding: const EdgeInsets.all(12), itemCount: cases.length,
            itemBuilder: (_, i) {
              final c = cases[i] as Map;
              // enforcementCases.list rows are raw SQL (snake_case)
              final statusColors = {'open': const Color(0xFFEF4444), 'under_investigation': const Color(0xFFF59E0B), 'notice_issued': const Color(0xFF3B82F6), 'settled': const Color(0xFF22C55E), 'closed': const Color(0xFF22C55E), 'escalated_to_ndpc': const Color(0xFFA78BFA), 'escalated_to_nitda': const Color(0xFFA78BFA)};
              final status = c['status']?.toString() ?? '';
              final sc = statusColors[status] ?? const Color(0xFF64748B);
              return GestureDetector(
                onTap: () => context.go('/enforcement/cases/${c['id']}'),
                child: Container(
                margin: const EdgeInsets.only(bottom: 10), padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF1E293B))),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3), decoration: BoxDecoration(color: sc.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                      child: Text(status.toUpperCase().replaceAll('_', ' '), style: TextStyle(color: sc, fontSize: 10, fontWeight: FontWeight.w700))),
                    const Spacer(),
                    Text(c['case_reference']?.toString() ?? '', style: const TextStyle(color: Color(0xFF64748B), fontSize: 11, fontFamily: 'monospace')),
                  ]),
                  const SizedBox(height: 6),
                  Text(c['escalation_reason']?.toString() ?? 'Penalty escalation', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 14, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 4),
                  Text(c['org_name']?.toString() ?? '', style: const TextStyle(color: Color(0xFF00D4FF), fontSize: 11)),
                ]),
                ),
              );
            },
          ),
        ),
        // Penalties Tab
        ref.watch(penaltiesProvider).when(
          loading: () => const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF))),
          error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Color(0xFFEF4444)))),
          data: (penalties) => ListView.builder(
            padding: const EdgeInsets.all(12), itemCount: penalties.length,
            itemBuilder: (_, i) {
              final p = penalties[i] as Map;
              // financial.penalties rows are drizzle camelCase
              final statusColors = {'paid': const Color(0xFF22C55E), 'unpaid': const Color(0xFFEF4444), 'disputed': const Color(0xFFA78BFA), 'waived': const Color(0xFF64748B)};
              final status = p['paymentStatus']?.toString() ?? '';
              final sc = statusColors[status] ?? const Color(0xFF64748B);
              return GestureDetector(
                onTap: () => context.go('/penalties/${p['id']}?orgId=${p['organizationId']}&amount=${p['amount']}'),
                child: Container(
                margin: const EdgeInsets.only(bottom: 10), padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF1E293B))),
                child: Row(children: [
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(p['organizationName']?.toString() ?? '', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 13, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    Text(p['description']?.toString() ?? '', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11), maxLines: 1, overflow: TextOverflow.ellipsis),
                  ])),
                  const SizedBox(width: 12),
                  Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text('${p['currency'] ?? 'NGN'} ${(double.tryParse(p['amount']?.toString() ?? '0') ?? 0).toStringAsFixed(0)}', style: const TextStyle(color: Color(0xFFFBBF24), fontSize: 16, fontWeight: FontWeight.w800)),
                    Container(margin: const EdgeInsets.only(top: 4), padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(color: sc.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                      child: Text(status.toUpperCase(), style: TextStyle(color: sc, fontSize: 9, fontWeight: FontWeight.w700))),
                  ]),
                ]),
                ),
              );
            },
          ),
        ),
      ]),
    );
  }
}
