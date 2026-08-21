import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';

final auditLogsProvider = FutureProvider<List<dynamic>>((ref) async => ApiService().listAuditLogs(limit: 100));

class AuditLogScreen extends ConsumerWidget {
  const AuditLogScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final logsAsync = ref.watch(auditLogsProvider);
    final actionColors = {'create': const Color(0xFF22C55E), 'update': const Color(0xFF3B82F6), 'delete': const Color(0xFFEF4444), 'login': const Color(0xFFA78BFA)};
    return Scaffold(
      appBar: AppBar(title: const Text('Audit Log', style: TextStyle(fontWeight: FontWeight.w800)),
        leading: Builder(builder: (ctx) => IconButton(icon: const Icon(Icons.menu), onPressed: () => Scaffold.of(ctx).openDrawer()))),
      body: logsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF))),
        error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Color(0xFFEF4444)))),
        data: (logs) => ListView.builder(
          padding: const EdgeInsets.all(12), itemCount: logs.length,
          itemBuilder: (_, i) {
            final l = logs[i] as Map;
            final ac = actionColors[l['action']?.toString()] ?? const Color(0xFF64748B);
            return Container(
              margin: const EdgeInsets.only(bottom: 8), padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF1E293B))),
              child: Row(children: [
                Container(width: 6, height: 40, decoration: BoxDecoration(color: ac, borderRadius: BorderRadius.circular(3))),
                const SizedBox(width: 12),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2), decoration: BoxDecoration(color: ac.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                      child: Text(l['action']?.toString().toUpperCase() ?? '', style: TextStyle(color: ac, fontSize: 9, fontWeight: FontWeight.w700))),
                    const Spacer(),
                    Text(l['createdAt'] != null ? DateTime.parse(l['createdAt'].toString()).toLocal().toString().substring(0, 16) : '', style: const TextStyle(color: Color(0xFF475569), fontSize: 10)),
                  ]),
                  const SizedBox(height: 4),
                  Text('${l['resourceType'] ?? ''} #${l['resourceId'] ?? ''}', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 12, fontWeight: FontWeight.w600)),
                  Text(l['actorEmail']?.toString() ?? '', style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                ])),
              ]),
            );
          },
        ),
      ),
    );
  }
}
