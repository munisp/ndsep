import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Send, User, Loader2, Zap, Shield, AlertTriangle, TrendingUp } from "lucide-react";
import { Streamdown } from "streamdown";

import { Breadcrumbs } from "@/components/Breadcrumbs";
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
};

const suggestedQueries = [
  "Which organizations have the highest risk scores this week?",
  "What are the most critical compliance violations requiring immediate action?",
  "Summarize cross-border data transfer violations in the last 30 days",
  "Which organizations are at risk of financial penalties?",
  "What enforcement actions should be prioritized today?",
  "Analyze the national compliance trend and predict next month's risk score",
];

export default function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "**Welcome to the NDSEP AI Compliance Advisor.**\n\nI have real-time access to the National Data Sovereignty Enforcement Platform, including:\n\n- **Organization risk profiles** and compliance scores\n- **Active violations** and enforcement actions\n- **Security alerts** and threat intelligence\n- **Financial penalties** and collection status\n- **Network events** and cross-border data flows\n\nAsk me anything about national data sovereignty compliance, risk assessment, or enforcement recommendations.",
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const askAdvisor = trpc.ai.query.useMutation({
    onSuccess: (data: any) => {
      setMessages(prev => [...prev, {
        id: `ai-${Date.now()}`,
        role: "assistant" as const,
        content: typeof data.answer === "string" ? data.answer : "Response received.",
        timestamp: new Date(),
      }]);
      setIsLoading(false);
    },
    onError: (err: any) => {
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: "assistant" as const,
        content: `**Error:** ${err.message}. Please try again.`,
        timestamp: new Date(),
      }]);
      setIsLoading(false);
    }
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (query?: string) => {
    const q = query ?? input.trim();
    if (!q || isLoading) return;
    setInput("");
    setIsLoading(true);
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      role: "user",
      content: q,
      timestamp: new Date(),
    }]);
    askAdvisor.mutate({ question: q });
  };

  return (
    <div className="space-y-4 h-[calc(100vh-8rem)] flex flex-col">
      <Breadcrumbs items={[{ label: "AI Hub", href: "/ai-hub" }, { label: "AI Assistant" }]} className="mb-4" />
      <div className="flex items-start justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="layer-badge">AI</span>
            <span className="data-label">LLM · RAG · Platform Context · Go · Python</span>
          </div>
          <h1 className="text-2xl font-bold">AI Compliance Advisor</h1>
          <p className="text-muted-foreground mono text-sm mt-0.5">Natural language queries · Risk analysis · Enforcement recommendations · Real-time platform context</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
          <span className="data-label text-blue-600">AI ONLINE</span>
        </div>
      </div>

      {/* Suggested Queries */}
      <div className="shrink-0">
        <p className="data-label mb-2">Suggested queries:</p>
        <div className="flex flex-wrap gap-2">
          {suggestedQueries.map((q) => (
            <button
              key={q}
              onClick={() => handleSend(q)}
              disabled={isLoading}
              className="text-[10px] mono px-2.5 py-1 rounded-full border border-border/60 bg-muted/40 hover:bg-primary/10 hover:border-primary/40 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {q.length > 50 ? q.substring(0, 50) + "…" : q}
            </button>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <Card className="flex-1 border border-border/60 flex flex-col min-h-0">
        <CardHeader className="pb-2 shrink-0 border-b border-border/40">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-semibold">NDSEP Compliance Advisor</CardTitle>
            <Badge variant="outline" className="mono text-[9px] ml-auto">GPT-4o · Platform Context</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${msg.role === "assistant" ? "bg-primary/10 border border-primary/20" : "bg-muted border border-border"}`}>
                {msg.role === "assistant" ? <Bot className="h-3.5 w-3.5 text-primary" /> : <User className="h-3.5 w-3.5 text-muted-foreground" />}
              </div>
              <div className={`max-w-[80%] rounded-xl px-4 py-3 ${msg.role === "user" ? "bg-primary text-primary-foreground ml-auto" : "bg-muted/50 border border-border/40"}`}>
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none text-foreground">
                    <Streamdown>{msg.content}</Streamdown>
                  </div>
                ) : (
                  <p className="text-sm">{msg.content}</p>
                )}
                <p className={`text-[9px] mono mt-1.5 ${msg.role === "user" ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                  {msg.timestamp.toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <div className="h-7 w-7 rounded-full flex items-center justify-center bg-primary/10 border border-primary/20 shrink-0">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="bg-muted/50 border border-border/40 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span className="mono text-xs text-muted-foreground">Analyzing platform data…</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </CardContent>
        <div className="p-4 border-t border-border/40 shrink-0">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Ask about compliance, risk, violations, enforcement…"
              disabled={isLoading}
              className="flex-1 bg-muted/40 border border-border/60 rounded-lg px-3 py-2 text-sm mono placeholder:text-muted-foreground focus-visible:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-50"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
              className="h-9 w-9 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <p className="data-label mt-2">Powered by real-time NDSEP platform data · All queries are logged to the audit trail</p>
        </div>
      </Card>
    </div>
  );
}
