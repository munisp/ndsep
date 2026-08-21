import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';

final notificationsProvider = FutureProvider<List<dynamic>>((ref) async => ApiService().listNotifications(limit: 50));

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifAsync = ref.watch(notificationsProvider);
    final typeColors = {'penalty': const Color(0xFFEF4444), 'alert': const Color(0xFFF97316), 'compliance': const Color(0xFF22C55E), 'certificate': const Color(0xFF00D4FF)};
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications', style: TextStyle(fontWeight: FontWeight.w800)),
        leading: Builder(builder: (ctx) => IconButton(icon: const Icon(Icons.menu), onPressed: () => Scaffold.of(ctx).openDrawer())),
        actions: [TextButton(onPressed: () async { await ApiService().markNotificationRead(all: true); ref.invalidate(notificationsProvider); },
          child: const Text('Mark all read', style: TextStyle(color: Color(0xFF00D4FF), fontSize: 12)))]),
      body: notifAsync.when(
        loading: () => const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF))),
        error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Color(0xFFEF4444)))),
        data: (notifs) => ListView.builder(
          padding: const EdgeInsets.all(12), itemCount: notifs.length,
          itemBuilder: (_, i) {
            final n = notifs[i] as Map;
            final tc = typeColors[n['type']?.toString()] ?? const Color(0xFF64748B);
            final unread = n['readAt'] == null;
            return GestureDetector(
              onTap: () async { if (unread) { await ApiService().markNotificationRead(id: n['id'] as int); ref.invalidate(notificationsProvider); } },
              child: Container(
                margin: const EdgeInsets.only(bottom: 8), padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: unread ? const Color(0xFF00D4FF08) : const Color(0xFF0F172A), borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: unread ? const Color(0xFF00D4FF40) : const Color(0xFF1E293B))),
                child: Row(children: [
                  Container(width: 8, height: 8, decoration: BoxDecoration(color: tc, shape: BoxShape.circle)),
                  const SizedBox(width: 10),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(n['title']?.toString() ?? '', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 13, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 3),
                    Text(n['body']?.toString() ?? '', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12), maxLines: 2, overflow: TextOverflow.ellipsis),
                  ])),
                ]),
              ),
            );
          },
        ),
      ),
    );
  }
}
