import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';

final penaltiesProvider = FutureProvider.family<List<dynamic>, String?>((ref, status) async {
  return ApiService().listPenalties(limit: 100);
});

class FinancialEnforcementScreen extends ConsumerStatefulWidget {
  const FinancialEnforcementScreen({super.key});
  @override
  ConsumerState<FinancialEnforcementScreen> createState() => _FinancialEnforcementScreenState();
}

class _FinancialEnforcementScreenState extends ConsumerState<FinancialEnforcementScreen> {
  String _status = 'all';
  bool _showForm = false;
  final _orgIdCtrl = TextEditingController();
  final _amountCtrl = TextEditingController();
  final _reasonCtrl = TextEditingController();

  final _statusColors = {
    'pending': const Color(0xFFF59E0B),
    'processing': const Color(0xFF3B82F6),
    'completed': const Color(0xFF22C55E),
    'failed': const Color(0xFFEF4444),
    'overdue': const Color(0xFFDC2626),
  };

  @override
  Widget build(BuildContext context) {
    final penaltiesAsync = ref.watch(penaltiesProvider(_status));
    return Scaffold(
      appBar: AppBar(
        title: const Text('Financial Enforcement', style: TextStyle(fontWeight: FontWeight.w800)),
        leading: Builder(builder: (ctx) => IconButton(icon: const Icon(Icons.menu), onPressed: () => Scaffold.of(ctx).openDrawer())),
        actions: [
          IconButton(icon: const Icon(Icons.add_circle_outline), onPressed: () => setState(() => _showForm = !_showForm)),
        ],
      ),
      body: Column(children: [
        if (_showForm) _buildForm(context),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(children: ['all', 'pending', 'processing', 'completed', 'overdue', 'failed'].map((s) =>
            Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(
              label: Text(s), selected: _status == s,
              onSelected: (_) => setState(() => _status = s),
              selectedColor: const Color(0xFF3B82F6),
            ))
          ).toList()),
        ),
        Expanded(child: penaltiesAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Colors.red))),
          data: (penalties) {
            final filtered = _status == 'all' ? penalties : penalties.where((p) => p['paymentStatus'] == _status).toList();
            if (filtered.isEmpty) return const Center(child: Text('No penalties found', style: TextStyle(color: Colors.grey)));
            return ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: filtered.length,
              itemBuilder: (ctx, i) {
                final p = filtered[i];
                final status = p['paymentStatus'] ?? 'pending';
                return Card(
                  color: const Color(0xFF1F2937),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                      Text('#${p['id']}', style: const TextStyle(color: Colors.grey, fontSize: 12, fontFamily: 'monospace')),
                      Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3), decoration: BoxDecoration(color: _statusColors[status] ?? Colors.grey, borderRadius: BorderRadius.circular(12)),
                        child: Text(status, style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600))),
                    ]),
                    const SizedBox(height: 6),
                    Text('${p['currency'] ?? 'NGN'} ${double.tryParse(p['amount']?.toString() ?? '0')?.toStringAsFixed(2) ?? '0.00'}',
                      style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text(p['reason'] ?? 'Compliance violation', style: const TextStyle(color: Color(0xFFD1D5DB), fontSize: 13), maxLines: 2),
                    const SizedBox(height: 6),
                    Text('Org #${p['organizationId']}', style: const TextStyle(color: Colors.grey, fontSize: 11)),
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
    return Container(
      color: const Color(0xFF1F2937),
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Issue New Penalty', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 12),
        TextField(controller: _orgIdCtrl, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Organization ID', border: OutlineInputBorder()), style: const TextStyle(color: Colors.white)),
        const SizedBox(height: 8),
        TextField(controller: _amountCtrl, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Amount (NGN)', border: OutlineInputBorder()), style: const TextStyle(color: Colors.white)),
        const SizedBox(height: 8),
        TextField(controller: _reasonCtrl, maxLines: 2, decoration: const InputDecoration(labelText: 'Reason', border: OutlineInputBorder()), style: const TextStyle(color: Colors.white)),
        const SizedBox(height: 12),
        ElevatedButton(
          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF3B82F6), minimumSize: const Size.fromHeight(44)),
          onPressed: () async {
            try {
              await ApiService().createPenalty(organizationId: int.parse(_orgIdCtrl.text), amount: _amountCtrl.text, reason: _reasonCtrl.text);
              setState(() => _showForm = false);
              ref.invalidate(penaltiesProvider);
              if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Penalty issued')));
            } catch (e) {
              if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
            }
          },
          child: const Text('Issue Penalty'),
        ),
      ]),
    );
  }
}
