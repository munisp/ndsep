import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { trpc } from '../api/trpc';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function AiAdvisorScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Welcome to the NDSEP AI Compliance Advisor. Ask a compliance question and I will query the authorised NDSEP compliance Q&A service.' },
  ]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const utils = trpc.useUtils();

  const suggestedQueries = [
    'What are the NDPA breach notification requirements?',
    'How should we conduct a DPIA for AI systems?',
    'What are the data residency rules for financial data?',
    'Explain CBN data protection guidelines for banks',
    'What penalties apply for non-compliance with NDPA?',
  ];

  const handleSend = async () => {
    const question = input.trim();
    if (!question || isSending) return;

    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setInput('');
    setIsSending(true);
    try {
      const result = await utils.ollama.complianceQA.fetch({ question, useRAG: true });
      setMessages(prev => [...prev, { role: 'assistant', content: result.answer }]);
    } catch {
      // This is intentionally an explicit operational failure, never a generated
      // legal/compliance answer or fabricated fallback.
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'The authorised NDSEP compliance Q&A service is currently unavailable. No advisory response was generated. Please retry later or contact the responsible compliance officer.',
      }]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>AI Compliance Advisor</Text>
        <Text style={styles.subtitle}>Authoritative NDSEP compliance Q&A service</Text>
      </View>

      <ScrollView style={styles.chatArea}>
        {messages.map((msg, i) => (
          <View key={`${msg.role}-${i}`} style={[styles.msgBubble, msg.role === 'user' ? styles.userMsg : styles.assistantMsg]}>
            <Text style={[styles.msgText, msg.role === 'user' && { color: '#fff' }]}>{msg.content}</Text>
          </View>
        ))}
      </ScrollView>

      {messages.length <= 1 && (
        <View style={styles.suggestions}>
          <Text style={styles.suggestLabel}>Suggested queries:</Text>
          {suggestedQueries.map(q => (
            <TouchableOpacity key={q} style={styles.suggestBtn} onPress={() => setInput(q)} disabled={isSending}>
              <Text style={styles.suggestText}>{q}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about data protection compliance..."
          placeholderTextColor="#94a3b8"
          onSubmitEditing={handleSend}
          editable={!isSending}
        />
        <TouchableOpacity style={[styles.sendBtn, isSending && styles.sendBtnDisabled]} onPress={handleSend} disabled={isSending}>
          <Text style={styles.sendText}>{isSending ? 'Asking…' : 'Send'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  chatArea: { flex: 1, padding: 16 },
  msgBubble: { maxWidth: '85%', borderRadius: 12, padding: 12, marginBottom: 10 },
  userMsg: { alignSelf: 'flex-end', backgroundColor: '#3b82f6' },
  assistantMsg: { alignSelf: 'flex-start', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0' },
  msgText: { fontSize: 14, color: '#1e293b', lineHeight: 20 },
  suggestions: { paddingHorizontal: 16, paddingBottom: 8 },
  suggestLabel: { fontSize: 12, color: '#94a3b8', marginBottom: 8 },
  suggestBtn: { backgroundColor: '#fff', borderRadius: 8, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: '#e2e8f0' },
  suggestText: { fontSize: 13, color: '#3b82f6' },
  inputRow: { flexDirection: 'row', padding: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0', backgroundColor: '#fff' },
  input: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#1e293b' },
  sendBtn: { marginLeft: 8, backgroundColor: '#3b82f6', borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: '#94a3b8' },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
