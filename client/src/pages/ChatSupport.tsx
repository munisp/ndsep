import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  MessageCircle, Send, Bot, User, AlertTriangle, CheckCircle,
  Clock, FileText, Shield, ExternalLink, ChevronRight, X,
  Ticket, Phone, History, Plus, Loader2
} from "lucide-react";
import { useLocation } from "wouter";

interface Message {
  id: number;
  role: "user" | "assistant" | "system" | "agent";
  content: string;
  suggestedActions?: string[];
  createdAt: number;
}

// ── Route suggestion map ──────────────────────────────────────────────────────
const ACTION_ROUTES: Record<string, string> = {
  "Go to Breach Incident Center": "/breach-incidents",
  "Open Article 40 Tracker": "/article-40-tracker",
  "Open DSAR Portal": "/dsar-portal",
  "View DPCO Certification": "/dpco",
  "Open Penalty Calculator": "/penalty-calculator",
};

// ── Message Bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg, onAction }: { msg: Message; onAction: (action: string) => void }) {
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">{msg.content}</span>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isUser ? "bg-primary" : "bg-blue-600"}`}>
        {isUser ? <User className="h-4 w-4 text-primary-foreground" /> : <Bot className="h-4 w-4 text-white" />}
      </div>
      <div className={`max-w-[75%] space-y-2 ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div className={`rounded-2xl px-4 py-3 text-sm ${isUser ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted rounded-tl-sm"}`}>
          <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
        </div>
        {msg.suggestedActions && msg.suggestedActions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {msg.suggestedActions.map(action => (
              <Button
                key={action}
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={() => onAction(action)}
              >
                <ChevronRight className="h-3 w-3 mr-1" />
                {action}
              </Button>
            ))}
          </div>
        )}
        <span className="text-xs text-muted-foreground">
          {new Date(msg.createdAt).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ChatSupport() {
  const [, navigate] = useLocation();
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [category, setCategory] = useState<"general" | "technical" | "compliance" | "billing" | "urgent">("general");
  const [subject, setSubject] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: sessions, refetch: refetchSessions } = trpc.chatSupport.getSessions.useQuery();
  const { data: sessionData, refetch: refetchMessages } = trpc.chatSupport.getMessages.useQuery(
    { sessionId: sessionId! },
    { enabled: !!sessionId }
  );

  const createSession = trpc.chatSupport.getOrCreateSession.useMutation();
  const sendMessage = trpc.chatSupport.sendMessage.useMutation();
  const escalate = trpc.chatSupport.escalate.useMutation({
    onSuccess: () => { toast.success("Session escalated to human agent"); refetchMessages(); }
  });
  const closeSession = trpc.chatSupport.closeSession.useMutation({
    onSuccess: () => { toast.success("Session closed"); setSessionId(null); setMessages([]); refetchSessions(); }
  });

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load messages when session data arrives
  useEffect(() => {
    if (sessionData?.messages) {
      setMessages(sessionData.messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        suggestedActions: m.metadata?.suggestedActions ?? [],
        createdAt: m.createdAt
      })));
    }
  }, [sessionData]);

  const handleStartSession = async () => {
    setIsStarting(true);
    try {
      const result = await createSession.mutateAsync({ subject: subject || "Support Request", category });
      setSessionId(result.sessionId);
      toast.success(`Session started — Ticket: ${result.ticketNumber}`);
      refetchSessions();
    } catch {
      toast.error("Failed to start session");
    } finally {
      setIsStarting(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !sessionId || isSending) return;
    const text = input.trim();
    setInput("");
    setIsSending(true);

    // Optimistic update
    const tempMsg: Message = { id: Date.now(), role: "user", content: text, createdAt: Date.now() };
    setMessages(prev => [...prev, tempMsg]);

    try {
      const result = await sendMessage.mutateAsync({ sessionId, content: text });
      const aiMsg: Message = {
        id: result.messageId,
        role: "assistant",
        content: result.content,
        suggestedActions: result.suggestedActions,
        createdAt: Date.now()
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch {
      toast.error("Failed to send message");
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
    } finally {
      setIsSending(false);
    }
  };

  const handleAction = (action: string) => {
    const route = ACTION_ROUTES[action];
    if (route) navigate(route);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const currentSession = sessionData?.session as any;

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MessageCircle className="h-6 w-6 text-blue-500" />
              Support Chat
            </h1>
            <p className="text-muted-foreground text-sm">AI-powered compliance assistance — escalate to human agent anytime</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowHistory(!showHistory)}>
            <History className="h-4 w-4 mr-1" /> Session History
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Chat Area */}
          <div className="lg:col-span-3">
            {!sessionId ? (
              /* Start Session */
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Start a Support Session</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Category</label>
                      <Select value={category} onValueChange={(v: any) => setCategory(v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="general">General Enquiry</SelectItem>
                          <SelectItem value="compliance">Compliance Question</SelectItem>
                          <SelectItem value="technical">Technical Issue</SelectItem>
                          <SelectItem value="billing">Billing</SelectItem>
                          <SelectItem value="urgent">Urgent / Breach</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Subject (optional)</label>
                      <Input
                        placeholder="e.g. NDPA Article 40 notification"
                        value={subject}
                        onChange={e => setSubject(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Quick topics */}
                  <div>
                    <p className="text-sm font-medium mb-2">Common topics:</p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        "Breach notification procedure",
                        "DSAR response deadline",
                        "DPCO certification requirements",
                        "Penalty calculation",
                        "DPO appointment rules",
                        "Cross-border data transfer"
                      ].map(topic => (
                        <Button
                          key={topic}
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() => { setSubject(topic); setCategory("compliance"); }}
                        >
                          {topic}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <Button onClick={handleStartSession} disabled={isStarting} className="w-full">
                    {isStarting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MessageCircle className="h-4 w-4 mr-2" />}
                    Start Chat Session
                  </Button>
                </CardContent>
              </Card>
            ) : (
              /* Active Chat */
              <Card className="flex flex-col" style={{ height: "70vh" }}>
                {/* Chat header */}
                <CardHeader className="pb-3 border-b shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">NDSEP Support AI</p>
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                          <span className="text-xs text-muted-foreground">Online</span>
                          {currentSession?.ticket_number && (
                            <Badge variant="outline" className="text-xs">
                              <Ticket className="h-3 w-3 mr-1" />
                              {currentSession.ticket_number}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => escalate.mutate({ sessionId, reason: "User requested human agent" })}
                        disabled={escalate.isPending}
                      >
                        <Phone className="h-4 w-4 mr-1" /> Escalate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => closeSession.mutate({ sessionId })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {/* Messages */}
                <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.map(msg => (
                    <MessageBubble key={msg.id} msg={msg} onAction={handleAction} />
                  ))}
                  {isSending && (
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-white" />
                      </div>
                      <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3">
                        <div className="flex gap-1">
                          <span className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </CardContent>

                {/* Input */}
                <div className="p-4 border-t shrink-0">
                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Type your question... (Enter to send, Shift+Enter for new line)"
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      rows={2}
                      className="resize-none"
                    />
                    <Button onClick={handleSend} disabled={!input.trim() || isSending} className="shrink-0" aria-label="Send">
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    AI responses are for guidance only. For legal advice, consult a qualified data protection officer.
                  </p>
                </div>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Quick links */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Quick Links</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { label: "Breach Incidents", icon: AlertTriangle, route: "/breach-incidents", color: "text-red-500" },
                  { label: "Article 40 Tracker", icon: Clock, route: "/article-40-tracker", color: "text-yellow-500" },
                  { label: "DSAR Portal", icon: FileText, route: "/dsar-portal", color: "text-blue-500" },
                  { label: "DPCO Certification", icon: Shield, route: "/dpco", color: "text-green-500" },
                  { label: "Penalty Calculator", icon: CheckCircle, route: "/penalty-calculator", color: "text-orange-500" },
                ].map(link => {
                  const Icon = link.icon;
                  return (
                    <button
                      key={link.route}
                      onClick={() => navigate(link.route)}
                      className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-muted transition-colors text-left"
                    >
                      <Icon className={`h-4 w-4 ${link.color} shrink-0`} />
                      <span className="text-sm">{link.label}</span>
                      <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            {/* Session history */}
            {showHistory && sessions && sessions.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Recent Sessions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 max-h-64 overflow-y-auto">
                  {sessions.map((s: any) => (
                    <button
                      key={s.id}
                      onClick={() => setSessionId(s.id)}
                      className={`w-full text-left p-2 rounded-lg border transition-colors ${sessionId === s.id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Badge variant={s.status === "active" ? "default" : s.status === "escalated" ? "destructive" : "secondary"} className="text-xs">
                          {s.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{s.ticketNumber}</span>
                      </div>
                      <p className="text-xs truncate">{s.subject}</p>
                      <p className="text-xs text-muted-foreground">{new Date(s.createdAt).toLocaleDateString()}</p>
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* New session button */}
            {sessionId && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => { setSessionId(null); setMessages([]); setSubject(""); }}
              >
                <Plus className="h-4 w-4 mr-2" /> New Session
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
