import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';

final assetsProvider = FutureProvider<List<dynamic>>((ref) async => ApiService().listAssets(limit: 100));

class AssetRegistryScreen extends ConsumerStatefulWidget {
  const AssetRegistryScreen({super.key});
  @override ConsumerState<AssetRegistryScreen> createState() => _AssetRegistryScreenState();
}
class _AssetRegistryScreenState extends ConsumerState<AssetRegistryScreen> {
  String _search = '';
  @override
  Widget build(BuildContext context) {
    final assetsAsync = ref.watch(assetsProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Asset Registry', style: TextStyle(fontWeight: FontWeight.w800)),
        leading: Builder(builder: (ctx) => IconButton(icon: const Icon(Icons.menu), onPressed: () => Scaffold.of(ctx).openDrawer())),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: TextField(
            decoration: InputDecoration(
              hintText: 'Search assets…', hintStyle: const TextStyle(color: Color(0xFF475569)),
              filled: true, fillColor: const Color(0xFF0F172A),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFF1E293B))),
              prefixIcon: const Icon(Icons.search, color: Color(0xFF64748B), size: 20),
            ),
            style: const TextStyle(color: Color(0xFFF1F5F9)),
            onChanged: (v) => setState(() => _search = v),
          ),
        ),
        Expanded(child: assetsAsync.when(
          loading: () => const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF))),
          error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Color(0xFFEF4444)))),
          data: (assets) {
            final filtered = assets.where((a) => _search.isEmpty ||
              (a['name']?.toString().toLowerCase().contains(_search.toLowerCase()) ?? false) ||
              (a['assetType']?.toString().toLowerCase().contains(_search.toLowerCase()) ?? false) ||
              (a['ipAddress']?.toString().contains(_search) ?? false)).toList();
            return ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 12), itemCount: filtered.length,
              itemBuilder: (_, i) {
                final a = filtered[i] as Map;
                final outside = a['isOutsideBorders'] == true;
                return Container(
                  margin: const EdgeInsets.only(bottom: 8), padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: outside ? const Color(0xFFEF444430) : const Color(0xFF1E293B))),
                  child: Row(children: [
                    Container(width: 40, height: 40, decoration: BoxDecoration(color: const Color(0xFF1E293B), borderRadius: BorderRadius.circular(8)),
                      child: Icon(_assetIcon(a['assetType']?.toString() ?? ''), color: const Color(0xFF64748B), size: 20)),
                    const SizedBox(width: 12),
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(a['name']?.toString() ?? '', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 13, fontWeight: FontWeight.w700)),
                      Text('${a['assetType'] ?? ''} · ${a['ipAddress'] ?? 'No IP'}', style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                    ])),
                    if (outside) Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                      decoration: BoxDecoration(color: const Color(0xFFEF444420), borderRadius: BorderRadius.circular(4)),
                      child: const Text('OUTSIDE', style: TextStyle(color: Color(0xFFEF4444), fontSize: 9, fontWeight: FontWeight.w700))),
                  ]),
                );
              },
            );
          },
        )),
      ]),
    );
  }
  IconData _assetIcon(String type) {
    switch (type.toLowerCase()) {
      case 'server': return Icons.dns;
      case 'database': return Icons.storage;
      case 'api': return Icons.api;
      case 'cloud': return Icons.cloud;
      default: return Icons.device_hub;
    }
  }
}
