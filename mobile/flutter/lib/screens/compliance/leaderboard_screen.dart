/// NDSEP Flutter — Compliance Leaderboard Screen
/// Mirrors React Native ComplianceLeaderboardScreen
library;

import 'package:flutter/material.dart';
import '../../services/api_service.dart';

class ComplianceLeaderboardScreen extends StatefulWidget {
  const ComplianceLeaderboardScreen({super.key});

  @override
  State<ComplianceLeaderboardScreen> createState() => _ComplianceLeaderboardScreenState();
}

class _ComplianceLeaderboardScreenState extends State<ComplianceLeaderboardScreen> {
  final _api = ApiService();
  String? _sector;
  List<dynamic> _entries = [];
  bool _loading = true;
  String? _error;

  static const _sectors = [
    'Fintech', 'Telecom', 'Healthcare', 'E-Commerce',
    'Government', 'Media', 'Energy',
  ];

  static const _medals = ['🥇', '🥈', '🥉'];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final data = await _api.getLeaderboard(limit: 50, sector: _sector);
      setState(() { _entries = data; _loading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Color _scoreColor(int score) {
    if (score >= 80) return const Color(0xFF22c55e);
    if (score >= 60) return const Color(0xFFf59e0b);
    return const Color(0xFFef4444);
  }

  Color _cardBorder(int index) {
    if (index == 0) return const Color(0xFFf59e0b);
    if (index == 1) return const Color(0xFF9ca3af);
    if (index == 2) return const Color(0xFFb45309);
    return const Color(0xFF374151);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF111827),
      appBar: AppBar(
        title: const Text('🏆 Compliance Leaderboard'),
        backgroundColor: const Color(0xFF111827),
        foregroundColor: const Color(0xFFF9FAFB),
        elevation: 0,
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: Text(
              'Organisation rankings by compliance score',
              style: TextStyle(color: Colors.grey[500], fontSize: 13),
            ),
          ),
          // Sector filter chips
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [null, ..._sectors].map((s) {
                final active = _sector == s;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    label: Text(s ?? 'All Sectors'),
                    selected: active,
                    onSelected: (_) {
                      setState(() => _sector = s);
                      _load();
                    },
                    backgroundColor: const Color(0xFF1f2937),
                    selectedColor: const Color(0xFFd97706),
                    labelStyle: TextStyle(
                      color: active ? Colors.white : Colors.grey[400],
                      fontSize: 12,
                    ),
                    side: BorderSide(
                      color: active ? const Color(0xFFf59e0b) : const Color(0xFF374151),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: 8),
          // List
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFFf59e0b)))
                : _error != null
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('Error: $_error', style: const TextStyle(color: Color(0xFFef4444))),
                            const SizedBox(height: 12),
                            ElevatedButton(onPressed: _load, child: const Text('Retry')),
                          ],
                        ),
                      )
                    : _entries.isEmpty
                        ? const Center(
                            child: Text(
                              'No leaderboard data available',
                              style: TextStyle(color: Color(0xFF6b7280), fontSize: 14),
                            ),
                          )
                        : RefreshIndicator(
                            onRefresh: _load,
                            child: ListView.builder(
                              padding: const EdgeInsets.fromLTRB(16, 0, 16, 20),
                              itemCount: _entries.length,
                              itemBuilder: (context, index) {
                                final item = _entries[index] as Map<String, dynamic>;
                                final score = (item['score'] as num?)?.toInt() ?? 0;
                                return Container(
                                  margin: const EdgeInsets.only(bottom: 10),
                                  padding: const EdgeInsets.all(14),
                                  decoration: BoxDecoration(
                                    color: index == 0
                                        ? const Color(0xFF1c1a0f)
                                        : index == 1
                                            ? const Color(0xFF1a1c1e)
                                            : index == 2
                                                ? const Color(0xFF1c1510)
                                                : const Color(0xFF1f2937),
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(color: _cardBorder(index)),
                                  ),
                                  child: Row(
                                    children: [
                                      SizedBox(
                                        width: 40,
                                        child: Center(
                                          child: Text(
                                            index < 3 ? _medals[index] : '#${index + 1}',
                                            style: const TextStyle(fontSize: 20),
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              item['organizationName'] as String? ?? 'Org #${item['organizationId']}',
                                              style: const TextStyle(
                                                color: Color(0xFFF9FAFB),
                                                fontSize: 15,
                                                fontWeight: FontWeight.w600,
                                              ),
                                            ),
                                            const SizedBox(height: 2),
                                            Text(
                                              item['sector'] as String? ?? 'General',
                                              style: TextStyle(color: Colors.grey[500], fontSize: 11),
                                            ),
                                            const SizedBox(height: 6),
                                            ClipRRect(
                                              borderRadius: BorderRadius.circular(2),
                                              child: LinearProgressIndicator(
                                                value: score / 100,
                                                backgroundColor: const Color(0xFF374151),
                                                valueColor: AlwaysStoppedAnimation(_scoreColor(score)),
                                                minHeight: 4,
                                              ),
                                            ),
                                            const SizedBox(height: 4),
                                            Text(
                                              '$score% compliance',
                                              style: TextStyle(color: Colors.grey[400], fontSize: 12),
                                            ),
                                          ],
                                        ),
                                      ),
                                      const SizedBox(width: 12),
                                      Column(
                                        children: [
                                          Text(
                                            '${item['violations'] ?? 0}',
                                            style: const TextStyle(
                                              color: Color(0xFFef4444),
                                              fontSize: 18,
                                              fontWeight: FontWeight.bold,
                                            ),
                                          ),
                                          Text(
                                            'violations',
                                            style: TextStyle(color: Colors.grey[500], fontSize: 10),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}
