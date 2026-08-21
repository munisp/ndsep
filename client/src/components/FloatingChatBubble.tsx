import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Minimize2, Maximize2, Bot, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}


const QUICK_PROMPTS = [
  "How do I submit a breach notification?",
  "What is Article 40 of the NDPA?",
  "How do I generate a compliance certificate?",
  "What sectors does NDSEP regulate?",
];

export function FloatingChatBubble() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hello! I'm the NDSEP AI Support Assistant. I can help you with data sovereignty compliance, breach notifications, regulatory requirements, and platform navigation. How can I assist you today?",
      timestamp: new Date(),
    },
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const getOrCreateSession = trpc.chatSupport.getOrCreateSession.useMutation({
    onSuccess: (data: { sessionId: number }) => setSessionId(data.sessionId),
  });

  const sendMessage = trpc.chatSupport.sendMessage.useMutation({
    onSuccess: (data) => {
      const aiMessage: Message = {
        id: `ai-${Date.now()}`,
        role: "assistant",
        content: data.content,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiMessage]);
      setIsTyping(false);
      if (!open) setUnreadCount((c) => c + 1);
    },
    onError: () => {
      setIsTyping(false);
      toast.error("Failed to get a response. Please try again.");
    },
  });

  useEffect(() => {
    if (open) {
      setUnreadCount(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSend = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content) return;
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);
    // Ensure we have a session
    let sid = sessionId;
    if (!sid) {
      try {
        const s = await getOrCreateSession.mutateAsync({});
        sid = s.sessionId;
        setSessionId(sid);
      } catch {
        setIsTyping(false);
        toast.error("Could not start chat session.");
        return;
      }
    }
    if (sid !== null) sendMessage.mutate({ sessionId: sid, content });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {/* Chat window */}
      {open && (
        <div
          className={`bg-card border border-cyan-500/30 rounded-xl shadow-2xl flex flex-col transition-all duration-200 ${
            minimized ? "h-12 w-80 overflow-hidden" : "w-96 h-[520px]"
          }`}
          style={{ boxShadow: "0 0 40px rgba(0,255,255,0.08)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-500/20 bg-muted rounded-t-xl">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-cyan-300 font-semibold text-sm">NDSEP AI Support</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-cyan-300"
                onClick={() => setMinimized((m) => !m)}
                aria-label={minimized ? "Expand chat" : "Minimize chat"}
              >
                {minimized ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-red-400"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {!minimized && (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                  >
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                        msg.role === "assistant"
                          ? "bg-cyan-500/20 text-cyan-400"
                          : "bg-indigo-500/20 text-indigo-400"
                      }`}
                    >
                      {msg.role === "assistant" ? (
                        <Bot className="h-4 w-4" />
                      ) : (
                        <User className="h-4 w-4" />
                      )}
                    </div>
                    <div
                      className={`max-w-[75%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                        msg.role === "assistant"
                          ? "bg-muted text-foreground border border-cyan-500/10"
                          : "bg-indigo-600/30 text-foreground border border-indigo-500/20"
                      }`}
                    >
                      {msg.content}
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex gap-2">
                    <div className="w-7 h-7 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="bg-muted border border-cyan-500/10 rounded-xl px-3 py-2">
                      <div className="flex gap-1 items-center h-4">
                        <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick prompts */}
              {messages.length <= 1 && (
                <div className="px-3 pb-2 flex flex-wrap gap-1">
                  {QUICK_PROMPTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => handleSend(p)}
                      className="text-[10px] px-2 py-1 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}

              {/* Input */}
              <div className="p-3 border-t border-cyan-500/20 flex gap-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about NDPA, compliance, or the platform…"
                  className="flex-1 bg-muted border border-cyan-500/20 rounded-lg px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus-visible:outline-none focus-visible:border-cyan-400"
                />
                <Button
                  size="icon"
                  className="h-8 w-8 bg-cyan-500 hover:bg-cyan-400 text-black"
                  onClick={() => handleSend()}
                  disabled={!input.trim() || isTyping}
                  aria-label="Send message"
                >
                  <Send className="h-3 w-3" />
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Bubble button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative w-14 h-14 rounded-full bg-gradient-to-br from-cyan-500 to-indigo-600 shadow-lg hover:scale-105 transition-transform flex items-center justify-center"
        style={{ boxShadow: "0 0 20px rgba(0,255,255,0.3)" }}
        aria-label="Open support chat"
      >
        {open ? (
          <X className="h-6 w-6 text-white" />
        ) : (
          <MessageCircle className="h-6 w-6 text-white" />
        )}
        {!open && unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold">
            {unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
