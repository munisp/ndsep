import 'package:flutter/material.dart';

class AiAdvisorScreen extends StatefulWidget {
  const AiAdvisorScreen({super.key});

  @override
  State<AiAdvisorScreen> createState() => _AiAdvisorScreenState();
}

class _AiAdvisorScreenState extends State<AiAdvisorScreen> {
  final _controller = TextEditingController();
  final _messages = <_ChatMsg>[
    _ChatMsg(
      role: 'assistant',
      content:
          'Welcome to the NDSEP AI Compliance Advisor. I can help with NDPA compliance questions, data protection guidance, breach notification requirements, and regulatory interpretations.',
    ),
  ];

  final _suggestions = [
    'What are the NDPA breach notification requirements?',
    'How should we conduct a DPIA for AI systems?',
    'What are data residency rules for financial data?',
    'Explain CBN data protection guidelines for banks',
    'What penalties apply for non-compliance with NDPA?',
  ];

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    setState(() {
      _messages.add(_ChatMsg(role: 'user', content: text));
      _controller.clear();
    });
    Future.delayed(const Duration(seconds: 1), () {
      if (!mounted) return;
      setState(() {
        _messages.add(_ChatMsg(
          role: 'assistant',
          content:
              'Based on the Nigeria Data Protection Act (NDPA) 2023, data controllers must notify the NDPC within 72 hours of becoming aware of a personal data breach that is likely to result in a risk to the rights and freedoms of data subjects.',
        ));
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Compliance Advisor'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
        elevation: 0,
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _messages.length + (_messages.length <= 1 ? _suggestions.length + 1 : 0),
              itemBuilder: (context, index) {
                if (index < _messages.length) {
                  final msg = _messages[index];
                  return Align(
                    alignment: msg.role == 'user'
                        ? Alignment.centerRight
                        : Alignment.centerLeft,
                    child: Container(
                      constraints: BoxConstraints(
                          maxWidth: MediaQuery.of(context).size.width * 0.85),
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: msg.role == 'user'
                            ? Colors.blue
                            : Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: msg.role == 'assistant'
                            ? Border.all(color: Colors.grey[200]!)
                            : null,
                      ),
                      child: Text(
                        msg.content,
                        style: TextStyle(
                          color: msg.role == 'user'
                              ? Colors.white
                              : Colors.black87,
                          fontSize: 14,
                          height: 1.4,
                        ),
                      ),
                    ),
                  );
                }
                final sugIndex = index - _messages.length;
                if (sugIndex == 0) {
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 8, top: 8),
                    child: Text('Suggested queries:',
                        style: TextStyle(color: Colors.grey[500], fontSize: 12)),
                  );
                }
                final sug = _suggestions[sugIndex - 1];
                return Card(
                  margin: const EdgeInsets.only(bottom: 6),
                  child: ListTile(
                    title: Text(sug, style: const TextStyle(color: Colors.blue, fontSize: 13)),
                    dense: true,
                    onTap: () {
                      _controller.text = sug;
                    },
                  ),
                );
              },
            ),
          ),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border(top: BorderSide(color: Colors.grey[200]!)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    decoration: InputDecoration(
                      hintText: 'Ask about data protection compliance...',
                      hintStyle: TextStyle(color: Colors.grey[400]),
                      filled: true,
                      fillColor: Colors.grey[100],
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide.none,
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 10),
                    ),
                    onSubmitted: (_) => _send(),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: _send,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.blue,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10)),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 18, vertical: 12),
                  ),
                  child:
                      const Text('Send', style: TextStyle(color: Colors.white)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ChatMsg {
  final String role;
  final String content;

  _ChatMsg({required this.role, required this.content});
}
