import 'package:flutter/material.dart';

class VendorRiskScreen extends StatelessWidget {
  const VendorRiskScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final vendors = [
      _Vendor('CloudNG Storage', 'high', 35, true),
      _Vendor('PayStack Payments', 'medium', 62, true),
      _Vendor('Flutterwave Pay', 'medium', 58, true),
      _Vendor('AWS Nigeria', 'low', 85, true),
      _Vendor('Interswitch', 'low', 78, true),
      _Vendor('Kobo Analytics', 'critical', 22, false),
      _Vendor('NCC Data Services', 'medium', 55, true),
      _Vendor('Remita Pay', 'high', 38, false),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Vendor Risk Assessment'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Third-party data processor risk monitoring',
                style: TextStyle(color: Colors.grey[600], fontSize: 14)),
            const SizedBox(height: 16),
            Row(
              children: [
                _StatCard('Vendors', '8', Colors.blue),
                const SizedBox(width: 8),
                _StatCard('High/Critical', '2', Colors.red),
                const SizedBox(width: 8),
                _StatCard('DPA Signed', '6', Colors.green),
                const SizedBox(width: 8),
                _StatCard('Avg Score', '52', Colors.blue),
              ],
            ),
            const SizedBox(height: 24),
            const Text('Risk Profiles',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            ...vendors.map((v) => _VendorCard(v)),
          ],
        ),
      ),
    );
  }
}

class _Vendor {
  final String name;
  final String risk;
  final int score;
  final bool dpaSigned;

  _Vendor(this.name, this.risk, this.score, this.dpaSigned);

  Color get color {
    switch (risk) {
      case 'critical': return Colors.red;
      case 'high': return Colors.orange;
      case 'medium': return Colors.blue;
      case 'low': return Colors.green;
      default: return Colors.grey;
    }
  }
}

class _VendorCard extends StatelessWidget {
  final _Vendor vendor;

  const _VendorCard(this.vendor);

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(vendor.name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                Chip(
                  label: Text(vendor.risk.toUpperCase(),
                      style: TextStyle(color: vendor.color, fontSize: 11, fontWeight: FontWeight.w700)),
                  backgroundColor: vendor.color.withOpacity(0.1),
                  padding: EdgeInsets.zero,
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Score: ${vendor.score}/100', style: TextStyle(color: Colors.grey[600], fontSize: 12)),
                Text('DPA: ${vendor.dpaSigned ? "Signed" : "Missing"}',
                    style: TextStyle(
                        color: vendor.dpaSigned ? Colors.green : Colors.red,
                        fontSize: 12,
                        fontWeight: FontWeight.w600)),
              ],
            ),
            const SizedBox(height: 8),
            LinearProgressIndicator(
              value: vendor.score / 100,
              color: vendor.color,
              backgroundColor: Colors.grey[200],
            ),
          ],
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _StatCard(this.label, this.value, this.color);

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              Text(value,
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: color)),
              const SizedBox(height: 4),
              Text(label,
                  style: TextStyle(fontSize: 11, color: Colors.grey[500]),
                  textAlign: TextAlign.center),
            ],
          ),
        ),
      ),
    );
  }
}
