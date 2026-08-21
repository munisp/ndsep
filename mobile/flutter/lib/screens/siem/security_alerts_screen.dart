import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';

final alertsProvider = FutureProvider<List<dynamic>>((ref) async => ApiService().listAlerts(limit: 50));

class SecurityAlertsScreen extends ConsumerWidget {
  const SecurityAlertsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final alertsAsync = ref.watch(alertsProvider);
    final sevColors = {'critical': const Color(0xFFDC2626), 'high': const Color(0xFFF97316), 'medium': const Color(0xFFF59E0B), 'low': const Color(0xFF22C55E)};
    return Scaffold(
      appBar: AppBar(
        title: const Text('Security Alerts', style: TextStyle(fontWeight: FontWeight.w800)),
        leading: Builder(builder: (ctx) => IconButton(icon: const Icon(Icons.menu), onPressed: () => Scaffold.of(ctx).openDrawer())),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: () => ref.invalidate(alertsProvider))],
      ),
      body: alertsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF))),
        error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Color(0xFFEF4444)))),
        data: (alerts) => ListView.builder(
          padding: const EdgeInsets.all(12), itemCount: alerts.length,
          itemBuilder: (_, i) {
            final a = alerts[i] as Map;
            final sev = a['severity']?.toString() ?? '';
            final sc = sevColors[sev] ?? const Color(0xFF64748B);
            return Container(
              margin: const EdgeInsets.only(bottom: 10), padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(10), border: Border.all(color: a['resolvedAt'] == null ? sc.withOpacity(0.3) : const Color(0xFF1E293B))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Container(width: 8, height: 8, decoration: BoxDecoration(color: sc, shape: BoxShape.circle)),
                  const SizedBox(width: 8),
                  Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: sc.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                    child: Text(sev.toUpperCase(), style: TextStyle(color: sc, fontSize: 10, fontWeight: FontWeight.w700))),
                  const Spacer(),
                  if (a['resolvedAt'] == null) TextButton(
                    style: TextButton.styleFrom(foregroundColor: const Color(0xFF22C55E), padding: EdgeInsets.zero, minimumSize: const Size(60, 28)),
                    onPressed: () async { await ApiService().resolveAlert(a['id'] as int); ref.invalidate(alertsProvider); },
                    child: const Text('Resolve', style: TextStyle(fontSize: 11)),
                  ),
                ]),
                const SizedBox(height: 6),
                Text(a['title']?.toString() ?? '', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 14, fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                Text(a['description']?.toString() ?? '', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12), maxLines: 2, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 4),
                Text(a['sourceIp'] != null ? 'Source: ${a['sourceIp']}' : a['alertType']?.toString() ?? '', style: const TextStyle(color: Color(0xFF64748B), fontSize: 11, fontFamily: 'monospace')),
              ]),
            );
          },
        ),
      ),
    );
  }
}
