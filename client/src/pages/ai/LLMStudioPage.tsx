import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Brain, MessageSquare, ArrowLeft, Send, Cpu } from "lucide-react";
import { Link } from "wouter";
import { Breadcrumbs } from "@/components/Breadcrumbs";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  source?: string;
  model?: string;
}

export default function LLMStudioPage() {
  const [prompt, setPrompt] = useState("");
  const [question, setQuestion] = useState("");
  const [qaSubmitted, setQaSubmitted] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const { data: health } = trpc.ollama.health.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: models } = trpc.ollama.models.useQuery();
  const { data: qaResult, isLoading: qaLoading } = trpc.ollama.complianceQA.useQuery(
    { question: qaSubmitted, useRAG: true },
    { enabled: !!qaSubmitted },
  );
  const generateM = trpc.ollama.generate.useMutation({
    onSuccess: (data) => {
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", content: data.response, source: data.source, model: data.model },
      ]);
    },
  });

  const handleSend = () => {
    if (!prompt.trim()) return;
    setChatHistory((prev) => [...prev, { role: "user", content: prompt }]);
    generateM.mutate({
      prompt,
      system: "You are the NDSEP compliance assistant. Help users understand Nigerian data protection regulations (NDPA 2023).",
    });
    setPrompt("");
  };

  return (
    <div className="p-6 space-y-6">
        <Breadcrumbs items={[{ label: "AI Hub", href: "/ai/hub" }, { label: "LLM Studio" }]} />
      <div className="flex items-center gap-3">
        <Link href="/ai/hub"><Button variant="ghost" size="icon" aria-label="Go back"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <Brain className="h-7 w-7 text-green-500" />
        <div>
          <h1 className="text-2xl font-bold">LLM Studio (Ollama)</h1>
          <p className="text-muted-foreground text-sm">On-premise LLaMA 3.2 inference with RAG context injection</p>
        </div>
        <div className="ml-auto">
          <Badge variant={health?.available ? "default" : "destructive"}>
            {health?.available ? "Connected" : "Fallback Mode"}
          </Badge>
        </div>
      </div>

      {/* Model Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Cpu className="h-4 w-4" />Available Models</CardTitle></CardHeader>
          <CardContent>
            {(models?.models ?? []).length > 0 ? (
              <div className="space-y-1">
                {(models?.models ?? []).map((m: { name?: string; size?: number }) => (
                  <div key={m.name} className="flex items-center justify-between">
                    <Badge variant="outline">{m.name}</Badge>
                    {m.size && <span className="text-xs text-muted-foreground">{(m.size / 1e9).toFixed(1)}GB</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No local models · Using built-in LLM fallback</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Connection</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">URL: <code className="bg-muted px-1 rounded text-xs">{health?.url ?? "—"}</code></p>
            <p className="text-sm mt-1">{health?.available ? "Ollama is running locally" : "Using built-in Manus LLM as fallback"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Compliance Q&A</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-1">
              <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about NDPA 2023..."
                onKeyDown={(e) => e.key === "Enter" && question.trim() && setQaSubmitted(question.trim())} className="text-xs" />
              <Button size="sm" onClick={() => question.trim() && setQaSubmitted(question.trim())} disabled={qaLoading}>Go</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Q&A Result */}
      {qaSubmitted && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compliance Q&A</CardTitle>
            <CardDescription>Question: {qaSubmitted} · RAG: {qaResult?.rag_context_used ? `Yes (${qaResult.context_snippets} snippets)` : "No"}</CardDescription>
          </CardHeader>
          <CardContent>
            {qaLoading ? <p className="text-muted-foreground">Thinking...</p> : <p className="text-sm whitespace-pre-wrap">{String(qaResult?.answer ?? "—")}</p>}
          </CardContent>
        </Card>
      )}

      {/* Chat Interface */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><MessageSquare className="h-4 w-4" />Chat</CardTitle></CardHeader>
        <CardContent>
          <div className="border rounded-lg p-4 min-h-[200px] max-h-[400px] overflow-y-auto space-y-3 mb-3 bg-muted/20">
            {chatHistory.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">Start a conversation about data protection compliance...</p>}
            {chatHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-lg p-3 text-sm ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {msg.content}
                  {msg.source && <div className="text-[10px] opacity-60 mt-1">via {msg.source} · {msg.model}</div>}
                </div>
              </div>
            ))}
            {generateM.isPending && <div className="flex justify-start"><div className="bg-muted rounded-lg p-3 text-sm text-muted-foreground">Generating...</div></div>}
          </div>
          <div className="flex gap-2">
            <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Type a message..."
              onKeyDown={(e) => e.key === "Enter" && handleSend()} />
            <Button onClick={handleSend} disabled={!prompt.trim() || generateM.isPending} aria-label="Send"><Send className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
