import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';

final violationsProvider = FutureProvider.family<List<dynamic>, String?>((ref, severity) async {
  return ApiService().listViolations(limit: 50, severity: severity == 'all' ? null : severity);
});

class ComplianceScreen extends ConsumerStatefulWidget {
  const ComplianceScreen({super.key});
  @override
  ConsumerState<ComplianceScreen> createState() => _ComplianceScreenState();
}

class _ComplianceScreenState extends ConsumerState<ComplianceScreen> {
  String _severity = 'all';
  String _search = '';
  final _severities = ['all', 'critical', 'high', 'medium', 'low'];
  final _severityColors = {'critical': Color(0xFFDC2626), 'high': Color(0xFFF97316), 'medium': Color(0xFFF59E0B), 'low': Color(0xFF22C55E)};

  @override
  Widget build(BuildContext context) {
    final violationsAsync = ref.watch(violationsProvider(_severity));
    return Scaffold(
      appBar: AppBar(
        title: const Text('Compliance', style: TextStyle(fontWeight: FontWeight.w800)),
        leading: Builder(builder: (ctx) => IconButton(icon: const Icon(Icons.menu), onPressed: () => Scaffold.of(ctx).openDrawer())),
      ),
      body: Column(children: [
        // Search
        Padding(
          padding: const EdgeInsets.all(12),
          child: TextField(
            decoration: InputDecoration(
              hintText: 'Search violations…', hintStyle: const TextStyle(color: Color(0xFF475569)),
              filled: true, fillColor: const Color(0xFF0F172A),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFF1E293B))),
              prefixIcon: const Icon(Icons.search, color: Color(0xFF64748B), size: 20),
            ),
            style: const TextStyle(color: Color(0xFFF1F5F9)),
            onChanged: (v) => setState(() => _search = v),
          ),
        ),
        // Severity Filter
        SizedBox(
          height: 36,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12),
            children: _severities.map((s) => Padding(
              padding: const EdgeInsets.only(right: 8),
              child: FilterChip(
                label: Text(s.toUpperCase(), style: TextStyle(fontSize: 10, color: _severity == s ? const Color(0xFF00D4FF) : const Color(0xFF64748B), fontWeight: FontWeight.w700)),
                selected: _severity == s,
                onSelected: (_) => setState(() => _severity = s),
                backgroundColor: const Color(0xFF0F172A),
                selectedColor: const Color(0xFF00D4FF15),
                side: BorderSide(color: _severity == s ? const Color(0xFF00D4FF) : const Color(0xFF1E293B)),
              ),
            )).toList(),
          ),
        ),
        // List
        Expanded(child: violationsAsync.when(
          loading: () => const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF))),
          error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Color(0xFFEF4444)))),
          data: (violations) {
            final filtered = violations.where((v) => _search.isEmpty ||
              (v['title']?.toString().toLowerCase().contains(_search.toLowerCase()) ?? false)).toList();
            if (filtered.isEmpty) return const Center(child: Text('No violations found.', style: TextStyle(color: Color(0xFF475569))));
            return ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: filtered.length,
              itemBuilder: (_, i) {
                final v = filtered[i] as Map;
                final sev = v['severity']?.toString() ?? '';
                final sevColor = _severityColors[sev] ?? const Color(0xFF64748B);
                return Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF1E293B))),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3), decoration: BoxDecoration(color: sevColor.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                        child: Text(sev.toUpperCase(), style: TextStyle(color: sevColor, fontSize: 10, fontWeight: FontWeight.w700))),
                      const Spacer(),
                      Text(v['status']?.toString() ?? '', style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                    ]),
                    const SizedBox(height: 6),
                    Text(v['title']?.toString() ?? '', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 14, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    Text(v['description']?.toString() ?? '', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12), maxLines: 2, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 4),
                    Text(v['organizationName']?.toString() ?? '', style: const TextStyle(color: Color(0xFF00D4FF), fontSize: 11, fontWeight: FontWeight.w600)),
                    if (v['status'] == 'open') ...[
                      const SizedBox(height: 10),
                      SizedBox(width: double.infinity, child: OutlinedButton(
                        style: OutlinedButton.styleFrom(foregroundColor: const Color(0xFF22C55E), side: const BorderSide(color: Color(0xFF22C55E50))),
                        onPressed: () async {
                          await ApiService().resolveViolation(v['id'] as int);
                          ref.invalidate(violationsProvider);
                        },
                        child: const Text('Resolve', style: TextStyle(fontSize: 12)),
                      )),
                    ],
                  ]),
                );
              },
            );
          },
        )),
      ]),
    );
  }
}
