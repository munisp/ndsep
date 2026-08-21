import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';

final tiaProvider = FutureProvider<List<dynamic>>((ref) async {
  return ApiService().listTiaAssessments(limit: 50);
});

class TiaAssessmentsScreen extends ConsumerStatefulWidget {
  const TiaAssessmentsScreen({super.key});
  @override
  ConsumerState<TiaAssessmentsScreen> createState() => _TiaAssessmentsScreenState();
}

class _TiaAssessmentsScreenState extends ConsumerState<TiaAssessmentsScreen> {
  bool _showForm = false;
  final _orgCtrl = TextEditingController();
  final _destCtrl = TextEditingController();
  final _catCtrl = TextEditingController();
  final _basisCtrl = TextEditingController();
  String _riskLevel = 'medium';

  final _riskColors = {'low': const Color(0xFF22C55E), 'medium': const Color(0xFFF59E0B), 'high': const Color(0xFFF97316), 'critical': const Color(0xFFEF4444)};
  final _statusColors = {'pending': Colors.grey, 'in_progress': const Color(0xFF3B82F6), 'completed': const Color(0xFF22C55E), 'approved': const Color(0xFF10B981), 'rejected': const Color(0xFFEF4444)};

  @override
  Widget build(BuildContext context) {
    final tiaAsync = ref.watch(tiaProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('TIA Assessments', style: TextStyle(fontWeight: FontWeight.w800)),
        leading: Builder(builder: (ctx) => IconButton(icon: const Icon(Icons.menu), onPressed: () => Scaffold.of(ctx).openDrawer())),
        actions: [IconButton(icon: const Icon(Icons.add), onPressed: () => setState(() => _showForm = !_showForm))],
      ),
      body: Column(children: [
        if (_showForm) _buildForm(context),
        Expanded(child: tiaAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Colors.red))),
          data: (items) {
            if (items.isEmpty) return const Center(child: Text('No TIA assessments', style: TextStyle(color: Colors.grey)));
            return ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: items.length,
              itemBuilder: (ctx, i) {
                final item = items[i];
                final status = item['status'] ?? 'pending';
                final risk = item['riskLevel'] ?? 'medium';
                return Card(color: const Color(0xFF1F2937), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                      Text('TIA-${item['id']}', style: const TextStyle(color: Colors.grey, fontSize: 12, fontFamily: 'monospace')),
                      Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3), decoration: BoxDecoration(color: _statusColors[status] ?? Colors.grey, borderRadius: BorderRadius.circular(12)),
                        child: Text(status, style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600))),
                    ]),
                    const SizedBox(height: 6),
                    Text('→ ${item['transferDestination'] ?? 'Unknown'}', style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Text(item['dataCategories'] ?? 'N/A', style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                    const SizedBox(height: 8),
                    Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                      Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3), decoration: BoxDecoration(color: (_riskColors[risk] ?? Colors.grey).withOpacity(0.15), borderRadius: BorderRadius.circular(6)),
                        child: Text('$risk risk', style: TextStyle(color: _riskColors[risk] ?? Colors.grey, fontSize: 12, fontWeight: FontWeight.w600))),
                      Text('Org #${item['organizationId']}', style: const TextStyle(color: Colors.grey, fontSize: 11)),
                    ]),
                  ])),
                );
              },
            );
          },
        )),
      ]),
    );
  }

  Widget _buildForm(BuildContext context) {
    return Container(color: const Color(0xFF1F2937), padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('New TIA Assessment', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 12),
        TextField(controller: _orgCtrl, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Organization ID', border: OutlineInputBorder()), style: const TextStyle(color: Colors.white)),
        const SizedBox(height: 8),
        TextField(controller: _destCtrl, decoration: const InputDecoration(labelText: 'Transfer Destination', border: OutlineInputBorder()), style: const TextStyle(color: Colors.white)),
        const SizedBox(height: 8),
        TextField(controller: _catCtrl, decoration: const InputDecoration(labelText: 'Data Categories', border: OutlineInputBorder()), style: const TextStyle(color: Colors.white)),
        const SizedBox(height: 8),
        TextField(controller: _basisCtrl, decoration: const InputDecoration(labelText: 'Legal Basis', border: OutlineInputBorder()), style: const TextStyle(color: Colors.white)),
        const SizedBox(height: 8),
        Wrap(spacing: 8, children: ['low', 'medium', 'high', 'critical'].map((r) =>
          ChoiceChip(label: Text(r), selected: _riskLevel == r, onSelected: (_) => setState(() => _riskLevel = r), selectedColor: _riskColors[r])
        ).toList()),
        const SizedBox(height: 12),
        ElevatedButton(style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF7C3AED), minimumSize: const Size.fromHeight(44)),
          onPressed: () async {
            try {
              await ApiService().createTiaAssessment(organizationId: int.parse(_orgCtrl.text), transferDestination: _destCtrl.text, dataCategories: _catCtrl.text, legalBasis: _basisCtrl.text, riskLevel: _riskLevel);
              setState(() => _showForm = false);
              ref.invalidate(tiaProvider);
              if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('TIA created')));
            } catch (e) {
              if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
            }
          },
          child: const Text('Create TIA'),
        ),
      ]),
    );
  }
}
