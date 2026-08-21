import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';

final portalProvider = FutureProvider<Map<String, dynamic>>((ref) async => ApiService().getMyOrgPortal());

class PortalScreen extends ConsumerWidget {
  const PortalScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final portalAsync = ref.watch(portalProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('My Portal', style: TextStyle(fontWeight: FontWeight.w800)),
        leading: Builder(builder: (ctx) => IconButton(icon: const Icon(Icons.menu), onPressed: () => Scaffold.of(ctx).openDrawer()))),
      body: portalAsync.when(
        loading: () => const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF))),
        error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Color(0xFFEF4444)))),
        data: (portal) {
          final org = portal['organization'] as Map? ?? {};
          final score = double.tryParse(org['complianceScore']?.toString() ?? '0') ?? 0;
          final scoreColor = score >= 80 ? const Color(0xFF22C55E) : score >= 60 ? const Color(0xFFF59E0B) : const Color(0xFFEF4444);
          return ListView(padding: const EdgeInsets.all(16), children: [
            Container(padding: const EdgeInsets.all(20), decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF1E293B))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(org['name']?.toString() ?? '', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 18, fontWeight: FontWeight.w800)),
                Text('${org['sector'] ?? ''} · ${org['country'] ?? ''}', style: const TextStyle(color: Color(0xFF64748B), fontSize: 13)),
                const SizedBox(height: 16),
                Row(children: [
                  Text(score.toStringAsFixed(1), style: TextStyle(color: scoreColor, fontSize: 48, fontWeight: FontWeight.w900)),
                  const SizedBox(width: 12),
                  const Text('Compliance\nScore', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
                ]),
              ])),
            const SizedBox(height: 12),
            if ((portal['violations'] as List? ?? []).isNotEmpty) _section('Open Violations',
              (portal['violations'] as List).take(5).map((v) => ListTile(
                dense: true, contentPadding: EdgeInsets.zero,
                leading: Icon(Icons.warning_outlined, color: v['severity'] == 'critical' ? const Color(0xFFDC2626) : const Color(0xFFF59E0B), size: 18),
                title: Text(v['title']?.toString() ?? '', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
              )).toList()),
            if ((portal['penalties'] as List? ?? []).isNotEmpty) _section('Pending Penalties',
              (portal['penalties'] as List).take(5).map((p) => ListTile(
                dense: true, contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.attach_money, color: Color(0xFFFBBF24), size: 18),
                title: Text('\$${(double.tryParse(p['amountUsd']?.toString() ?? '0') ?? 0).toStringAsFixed(0)}', style: const TextStyle(color: Color(0xFFFBBF24), fontSize: 13, fontWeight: FontWeight.w700)),
                subtitle: Text(p['reason']?.toString() ?? '', style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
              )).toList()),
          ]);
        },
      ),
    );
  }
  Widget _section(String title, List<Widget> children) => Container(
    margin: const EdgeInsets.only(bottom: 12), padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF1E293B))),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(title, style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 14, fontWeight: FontWeight.w700)),
      const SizedBox(height: 8),
      ...children,
    ]),
  );
}
