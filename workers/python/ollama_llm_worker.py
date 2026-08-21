#!/usr/bin/env python3
"""
NDSEP Ollama LLM Worker (Python)
==================================
Provides local LLM inference via Ollama for the NDSEP platform.
Supports streaming, prompt templates, and compliance-specific system prompts.

Models supported (auto-detected):
  - qwen2.5 (recommended — strong reasoning, multilingual, data residency compliant)
  - mistral:7b (compliance Q&A fallback)
  - llama3:8b (general purpose)
  - phi3:mini (fast, lightweight)
  - gemma:7b (alternative)

Endpoints:
  GET  /health          — worker status + available models
  POST /generate        — non-streaming completion
  POST /stream          — streaming completion (SSE)
  POST /chat            — multi-turn chat with history
  POST /compliance-qa   — compliance-specific Q&A with system prompt
  POST /summarize       — summarize compliance documents
  POST /classify        — classify violation severity/type

Technology: Python · ollama · requests
Port: 8203
"""
import os, time, json, logging, threading, http.server, socketserver
from datetime import datetime, timezone
from typing import List, Dict, Optional, Any, Generator
import requests

# ── Configuration ──────────────────────────────────────────────────────────────
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
RELAY_URL = os.environ.get("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
PORT = int(os.environ.get("OLLAMA_WORKER_PORT", "8203"))
DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "mistral")
MAX_TOKENS = int(os.environ.get("OLLAMA_MAX_TOKENS", "2048"))
TEMPERATURE = float(os.environ.get("OLLAMA_TEMPERATURE", "0.3"))

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [NDSEP-Ollama] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

# ── State ──────────────────────────────────────────────────────────────────────
_worker_start = time.time()
_ollama_available = False
_available_models: List[str] = []
_total_requests = 0
_errors = 0

# ── System prompts ─────────────────────────────────────────────────────────────
SYSTEM_PROMPTS = {
    "compliance_advisor": """You are an expert NDPA (Nigeria Data Protection Act 2023) compliance advisor for the National Data Sovereignty Enforcement Platform (NDSEP). 

Your role:
- Provide precise, actionable compliance guidance based on NDPA 2023
- Reference specific sections and articles when relevant
- Identify compliance risks and suggest remediation steps
- Use professional regulatory language appropriate for Nigerian data protection context
- Be concise but comprehensive

Always cite: NDPA 2023 sections, CBN guidelines, NITDA frameworks, or NDPC guidance notes where applicable.""",

    "violation_classifier": """You are a compliance violation classifier for the NDSEP platform.
Classify violations into: CRITICAL, HIGH, MEDIUM, LOW severity.
Categories: data_breach, consent_violation, cross_border_transfer, retention_violation, unauthorized_access, dpia_failure, dpo_absence, audit_failure.
Respond ONLY with valid JSON: {"severity": "...", "category": "...", "ndpa_section": "...", "recommended_action": "..."}""",

    "document_summarizer": """You are a compliance document summarizer for NDSEP.
Summarize compliance documents into: key obligations, risks identified, recommended actions, and relevant NDPA sections.
Be concise and use bullet points. Focus on actionable insights for data protection officers.""",

    "breach_assessor": """You are a data breach impact assessor for NDSEP.
Assess breach severity based on: data categories affected, number of data subjects, likelihood of harm, and NDPA 2023 notification requirements.
Determine: notification required (yes/no), 72-hour NDPC notification deadline, recommended immediate actions.
Respond with structured assessment.""",

    "general": "You are a helpful AI assistant for the National Data Sovereignty Enforcement Platform (NDSEP). Provide accurate, professional responses about Nigerian data protection law and compliance."
}

# ── Ollama client ──────────────────────────────────────────────────────────────
def check_ollama() -> bool:
    global _ollama_available, _available_models
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        if resp.status_code == 200:
            models = resp.json().get("models", [])
            _available_models = [m["name"] for m in models]
            _ollama_available = True
            log.info(f"Ollama available. Models: {_available_models}")
            return True
    except Exception as e:
        log.warning(f"Ollama not available: {e}")
    _ollama_available = False
    return False

def get_best_model() -> str:
    """Select the best available model."""
    preferred = ["qwen2.5", "qwen", "mistral", "llama3", "phi3", "gemma", "llama2"]
    for model in preferred:
        for available in _available_models:
            if model in available.lower():
                return available
    return _available_models[0] if _available_models else DEFAULT_MODEL

LLAMACPP_URL = os.environ.get("LLAMACPP_URL", "http://localhost:8204")

def _try_llamacpp_fallback(prompt: str, system: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Attempt to use llama.cpp native inference as fallback when Ollama is unavailable."""
    try:
        payload = {"prompt": prompt, "system": system or ""}
        resp = requests.post(f"{LLAMACPP_URL}/generate", json=payload, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("response"):
                log.info("llama.cpp fallback succeeded")
                data["fallback_engine"] = "llama.cpp"
                return data
    except Exception:
        pass
    return None

def generate(
    prompt: str,
    model: Optional[str] = None,
    system: Optional[str] = None,
    temperature: float = TEMPERATURE,
    max_tokens: int = MAX_TOKENS,
    stream: bool = False
) -> Dict[str, Any]:
    """Call Ollama generate API."""
    global _total_requests, _errors
    _total_requests += 1
    model = model or get_best_model()
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": stream,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        }
    }
    if system:
        payload["system"] = system

    try:
        resp = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json=payload,
            timeout=60,
            stream=stream
        )
        if resp.status_code == 200:
            if stream:
                return {"stream": resp}
            data = resp.json()
            return {
                "response": data.get("response", ""),
                "model": model,
                "done": data.get("done", True),
                "total_duration_ms": data.get("total_duration", 0) // 1_000_000,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        else:
            _errors += 1
            return {"error": f"Ollama returned {resp.status_code}", "response": ""}
    except Exception as e:
        _errors += 1
        log.error(f"Ollama generate failed: {e}")
        # Fallback to llama.cpp native inference
        llamacpp_result = _try_llamacpp_fallback(prompt, system)
        if llamacpp_result:
            return llamacpp_result
        return {"error": str(e), "response": f"LLM unavailable. Error: {e}"}

def chat(
    messages: List[Dict[str, str]],
    model: Optional[str] = None,
    system: Optional[str] = None,
    temperature: float = TEMPERATURE
) -> Dict[str, Any]:
    """Call Ollama chat API with message history."""
    global _total_requests, _errors
    _total_requests += 1
    model = model or get_best_model()
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {"temperature": temperature}
    }
    if system:
        payload["messages"] = [{"role": "system", "content": system}] + messages

    try:
        resp = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=60)
        if resp.status_code == 200:
            data = resp.json()
            return {
                "response": data.get("message", {}).get("content", ""),
                "model": model,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        else:
            _errors += 1
            return {"error": f"Ollama chat returned {resp.status_code}", "response": ""}
    except Exception as e:
        _errors += 1
        return {"error": str(e), "response": f"LLM unavailable: {e}"}

# ── Specialized endpoints ──────────────────────────────────────────────────────
def compliance_qa(question: str, context: str = "") -> Dict:
    """Answer compliance questions with NDPA context."""
    prompt = f"Context:\n{context}\n\nQuestion: {question}" if context else question
    return generate(prompt, system=SYSTEM_PROMPTS["compliance_advisor"])

def classify_violation(description: str, violation_type: str = "") -> Dict:
    """Classify a violation's severity and category."""
    prompt = f"Violation description: {description}\nViolation type: {violation_type}\n\nClassify this violation:"
    result = generate(prompt, system=SYSTEM_PROMPTS["violation_classifier"], temperature=0.1)
    # Try to parse JSON from response
    try:
        response_text = result.get("response", "")
        json_match = response_text[response_text.find("{"):response_text.rfind("}")+1]
        if json_match:
            result["classification"] = json.loads(json_match)
    except Exception:
        pass
    return result

def summarize_document(text: str, doc_type: str = "compliance_report") -> Dict:
    """Summarize a compliance document."""
    prompt = f"Document type: {doc_type}\n\nDocument text:\n{text[:3000]}\n\nSummary:"
    return generate(prompt, system=SYSTEM_PROMPTS["document_summarizer"])

def assess_breach(description: str, data_categories: List[str], subject_count: int) -> Dict:
    """Assess a data breach."""
    prompt = f"""Breach description: {description}
Data categories affected: {', '.join(data_categories)}
Number of data subjects: {subject_count}

Provide breach impact assessment:"""
    return generate(prompt, system=SYSTEM_PROMPTS["breach_assessor"])

# ── HTTP Server ────────────────────────────────────────────────────────────────
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass

    def read_body(self) -> Dict:
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def send_json(self, data: Any, status: int = 200):
        body = json.dumps(data, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json({
                "status": "healthy",
                "worker": "ollama_llm_worker",
                "ollama_available": _ollama_available,
                "available_models": _available_models,
                "default_model": DEFAULT_MODEL,
                "total_requests": _total_requests,
                "errors": _errors,
                "uptime_seconds": round(time.time() - _worker_start, 1),
                "capabilities": ["generate", "chat", "compliance_qa", "classify_violation", "summarize", "assess_breach"]
            })
        elif self.path == "/models":
            check_ollama()
            self.send_json({"models": _available_models})
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        body = self.read_body()
        if self.path == "/generate":
            result = generate(
                prompt=body.get("prompt", ""),
                model=body.get("model"),
                system=body.get("system"),
                temperature=body.get("temperature", TEMPERATURE)
            )
            self.send_json(result)
        elif self.path == "/chat":
            result = chat(
                messages=body.get("messages", []),
                model=body.get("model"),
                system=body.get("system"),
                temperature=body.get("temperature", TEMPERATURE)
            )
            self.send_json(result)
        elif self.path == "/compliance-qa":
            result = compliance_qa(
                question=body.get("question", ""),
                context=body.get("context", "")
            )
            self.send_json(result)
        elif self.path == "/classify":
            result = classify_violation(
                description=body.get("description", ""),
                violation_type=body.get("violation_type", "")
            )
            self.send_json(result)
        elif self.path == "/summarize":
            result = summarize_document(
                text=body.get("text", ""),
                doc_type=body.get("doc_type", "compliance_report")
            )
            self.send_json(result)
        elif self.path == "/assess-breach":
            result = assess_breach(
                description=body.get("description", ""),
                data_categories=body.get("data_categories", []),
                subject_count=body.get("subject_count", 0)
            )
            self.send_json(result)
        else:
            self.send_response(404)
            self.end_headers()

def health_check_loop():
    time.sleep(5)
    check_ollama()
    while True:
        time.sleep(60)
        check_ollama()

if __name__ == "__main__":
    log.info("Starting NDSEP Ollama LLM Worker...")
    threading.Thread(target=health_check_loop, daemon=True).start()
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        httpd.allow_reuse_address = True
        log.info(f"Ollama LLM Worker HTTP server on port {PORT}")
        httpd.serve_forever()
