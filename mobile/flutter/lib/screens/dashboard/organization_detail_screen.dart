import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';

class OrganizationDetailScreen extends ConsumerWidget {
  final int orgId;
  const OrganizationDetailScreen({super.key, required this.orgId});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final orgAsync = FutureProvider<Map<String, dynamic>>((ref) async => ApiService().getOrganization(orgId));
    final org = ref.watch(orgAsync);
    return Scaffold(
      appBar: AppBar(title: const Text('Organization', style: TextStyle(fontWeight: FontWeight.w800))),
      body: org.when(
        loading: () => const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF))),
        error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Color(0xFFEF4444)))),
        data: (o) {
          final score = double.tryParse(o['complianceScore']?.toString() ?? '0') ?? 0;
          final sc = score >= 80 ? const Color(0xFF22C55E) : score >= 60 ? const Color(0xFFF59E0B) : const Color(0xFFEF4444);
          return ListView(padding: const EdgeInsets.all(16), children: [
            Container(padding: const EdgeInsets.all(20), decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF1E293B))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(o['name']?.toString() ?? '', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 20, fontWeight: FontWeight.w800)),
                Text('${o['sector'] ?? ''} · ${o['country'] ?? ''} · ${o['registrationNumber'] ?? ''}', style: const TextStyle(color: Color(0xFF64748B), fontSize: 12)),
                const SizedBox(height: 16),
                Row(children: [
                  Text(score.toStringAsFixed(1), style: TextStyle(color: sc, fontSize: 48, fontWeight: FontWeight.w900)),
                  const SizedBox(width: 12),
                  Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('Compliance Score', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                    Text(o['complianceStatus']?.toString().toUpperCase() ?? '', style: TextStyle(color: sc, fontSize: 12, fontWeight: FontWeight.w700)),
                  ]),
                ]),
              ])),
          ]);
        },
      ),
    );
  }
}
