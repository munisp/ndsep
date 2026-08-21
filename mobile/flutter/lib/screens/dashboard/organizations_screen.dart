import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../services/api_service.dart';

final orgsProvider = FutureProvider<List<dynamic>>((ref) async => ApiService().listOrganizations(limit: 100));

class OrganizationsScreen extends ConsumerStatefulWidget {
  const OrganizationsScreen({super.key});
  @override ConsumerState<OrganizationsScreen> createState() => _OrganizationsScreenState();
}
class _OrganizationsScreenState extends ConsumerState<OrganizationsScreen> {
  String _search = '';
  @override
  Widget build(BuildContext context) {
    final orgsAsync = ref.watch(orgsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Organizations', style: TextStyle(fontWeight: FontWeight.w800)),
        leading: Builder(builder: (ctx) => IconButton(icon: const Icon(Icons.menu), onPressed: () => Scaffold.of(ctx).openDrawer()))),
      body: Column(children: [
        Padding(padding: const EdgeInsets.all(12), child: TextField(
          decoration: InputDecoration(hintText: 'Search organizations…', hintStyle: const TextStyle(color: Color(0xFF475569)),
            filled: true, fillColor: const Color(0xFF0F172A),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFF1E293B))),
            prefixIcon: const Icon(Icons.search, color: Color(0xFF64748B), size: 20)),
          style: const TextStyle(color: Color(0xFFF1F5F9)),
          onChanged: (v) => setState(() => _search = v),
        )),
        Expanded(child: orgsAsync.when(
          loading: () => const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF))),
          error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Color(0xFFEF4444)))),
          data: (orgs) {
            final filtered = orgs.where((o) => _search.isEmpty || (o['name']?.toString().toLowerCase().contains(_search.toLowerCase()) ?? false)).toList();
            return ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 12), itemCount: filtered.length,
              itemBuilder: (_, i) {
                final o = filtered[i] as Map;
                final score = double.tryParse(o['complianceScore']?.toString() ?? '0') ?? 0;
                final sc = score >= 80 ? const Color(0xFF22C55E) : score >= 60 ? const Color(0xFFF59E0B) : const Color(0xFFEF4444);
                return GestureDetector(
                  onTap: () => context.go('/organizations/${o['id']}'),
                  child: Container(
                    margin: const EdgeInsets.only(bottom: 8), padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF1E293B))),
                    child: Row(children: [
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(o['name']?.toString() ?? '', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 14, fontWeight: FontWeight.w700)),
                        Text('${o['sector'] ?? ''} · ${o['country'] ?? ''}', style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                      ])),
                      Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Text('${score.toStringAsFixed(1)}%', style: TextStyle(color: sc, fontSize: 16, fontWeight: FontWeight.w800)),
                        Text(o['complianceStatus']?.toString() ?? '', style: TextStyle(color: sc, fontSize: 10)),
                      ]),
                    ]),
                  ),
                );
              },
            );
          },
        )),
      ]),
    );
  }
}
