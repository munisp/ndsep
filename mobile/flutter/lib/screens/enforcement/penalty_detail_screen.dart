import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';

final _receiptProvider =
    FutureProvider.family<Map<String, dynamic>, int>((ref, penaltyId) async =>
        ApiService().getPenaltyReceipt(penaltyId));

class PenaltyDetailScreen extends ConsumerWidget {
  final int penaltyId;

  /// Optional context passed by the caller (enforcement penalties list) so the
  /// dispute action can be bound to orchestration.disputePenalty, which
  /// requires {penaltyId, orgId, amountUsd, disputeRef}. When absent, the
  /// dispute control is disabled — the receipt payload does not carry org id.
  final int? organizationId;
  final double? amount;

  const PenaltyDetailScreen({super.key, required this.penaltyId, this.organizationId, this.amount});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final receipt = ref.watch(_receiptProvider(penaltyId));
    return Scaffold(
      appBar: AppBar(title: const Text('Penalty Detail', style: TextStyle(fontWeight: FontWeight.w800))),
      body: receipt.when(
        loading: () => const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF))),
        error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Color(0xFFEF4444)))),
        data: (r) {
          final statusColors = {'paid': const Color(0xFF22C55E), 'unpaid': const Color(0xFFEF4444), 'disputed': const Color(0xFFA78BFA)};
          final status = r['paymentStatus']?.toString() ?? '';
          final sc = statusColors[status] ?? const Color(0xFF64748B);
          final currency = r['currency']?.toString() ?? 'NGN';
          final amt = double.tryParse(r['amount']?.toString() ?? '') ?? amount ?? 0;
          final canDispute = status == 'unpaid' && organizationId != null;
          return ListView(padding: const EdgeInsets.all(16), children: [
            Container(padding: const EdgeInsets.all(20), decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF1E293B))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                  Text('Penalty #${r['id']}', style: const TextStyle(color: Color(0xFF64748B), fontSize: 13)),
                  Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4), decoration: BoxDecoration(color: sc.withOpacity(0.15), borderRadius: BorderRadius.circular(6)),
                    child: Text(status.toUpperCase(), style: TextStyle(color: sc, fontSize: 11, fontWeight: FontWeight.w700))),
                ]),
                const SizedBox(height: 12),
                Text('$currency ${amt.toStringAsFixed(0)}', style: const TextStyle(color: Color(0xFFFBBF24), fontSize: 48, fontWeight: FontWeight.w900)),
                Text(r['orgName']?.toString() ?? '', style: const TextStyle(color: Color(0xFF00D4FF), fontSize: 15, fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                Text(r['description']?.toString() ?? '', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
                const SizedBox(height: 16),
                const Divider(color: Color(0xFF1E293B)),
                _row('Issued', r['createdAt'] != null ? DateTime.parse(r['createdAt'].toString()).toLocal().toString().substring(0, 10) : '—'),
                _row('Due Date', r['dueDate'] != null ? DateTime.parse(r['dueDate'].toString()).toLocal().toString().substring(0, 10) : '—'),
                if (r['paidAt'] != null)
                  _row('Paid', DateTime.parse(r['paidAt'].toString()).toLocal().toString().substring(0, 10)),
                if (status == 'unpaid') ...[
                  const SizedBox(height: 16),
                  SizedBox(width: double.infinity, child: OutlinedButton(
                    style: OutlinedButton.styleFrom(foregroundColor: const Color(0xFFA78BFA), side: const BorderSide(color: Color(0xFFA78BFA50))),
                    onPressed: canDispute
                        ? () async {
                            try {
                              await ApiService().disputePenalty(
                                penaltyId: '$penaltyId',
                                orgId: '$organizationId',
                                amountUsd: amt,
                                disputeRef: 'MOBILE-DSP-$penaltyId-${DateTime.now().millisecondsSinceEpoch}',
                              );
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Dispute filed successfully.')));
                              }
                            } catch (e) {
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
                              }
                            }
                          }
                        : null,
                    child: Text(canDispute ? 'File Dispute' : 'Dispute not available (open from Enforcement list)'),
                  )),
                ],
              ])),
          ]);
        },
      ),
    );
  }
  Widget _row(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
      Text(label, style: const TextStyle(color: Color(0xFF64748B), fontSize: 13)),
      Text(value, style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 13, fontWeight: FontWeight.w600)),
    ]),
  );
}
