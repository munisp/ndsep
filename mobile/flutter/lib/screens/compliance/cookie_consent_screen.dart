import 'package:flutter/material.dart';

class CookieConsentScreen extends StatelessWidget {
  const CookieConsentScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Cookie Consent'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Track and manage cookie consent across domains',
                style: TextStyle(color: Colors.grey[600], fontSize: 14)),
            const SizedBox(height: 16),
            Row(
              children: [
                _StatCard('Domains', '12', Colors.blue),
                const SizedBox(width: 8),
                _StatCard('Compliant', '8', Colors.green),
                const SizedBox(width: 8),
                _StatCard('Pending', '3', Colors.orange),
              ],
            ),
            const SizedBox(height: 24),
            const Text('Cookie Categories',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            _CategoryTile('Essential', 'Required for functionality', true, true),
            _CategoryTile('Analytics', 'Usage statistics', false, false),
            _CategoryTile('Marketing', 'Advertising tracking', false, false),
            _CategoryTile('Preferences', 'User settings', false, false),
            _CategoryTile('Social Media', 'Social integrations', false, false),
            const SizedBox(height: 24),
            const Text('Recent Records',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            ...[
              ('portal.ndsep.gov.ng', 'Accepted', '2025-12-15', Colors.green),
              ('dpco.ndsep.gov.ng', 'Accepted', '2025-12-14', Colors.green),
              ('api.ndsep.gov.ng', 'Pending', '2025-12-13', Colors.orange),
              ('banking.ndsep.gov.ng', 'Accepted', '2025-12-12', Colors.green),
            ].map((r) => Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                title: Text(r.$1, style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text(r.$3, style: TextStyle(color: Colors.grey[500], fontSize: 12)),
                trailing: Chip(
                  label: Text(r.$2, style: TextStyle(color: r.$4, fontSize: 11)),
                  backgroundColor: r.$4.withOpacity(0.1),
                ),
              ),
            )),
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

class _CategoryTile extends StatelessWidget {
  final String name;
  final String desc;
  final bool enabled;
  final bool locked;

  const _CategoryTile(this.name, this.desc, this.enabled, this.locked);

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: SwitchListTile(
        title: Text(name, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(desc, style: TextStyle(color: Colors.grey[500], fontSize: 12)),
        value: enabled,
        onChanged: locked ? null : (v) {},
      ),
    );
  }
}
