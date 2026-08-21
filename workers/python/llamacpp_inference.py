#!/usr/bin/env python3
"""
NDSEP llama.cpp Native Inference Engine
=========================================
Direct llama.cpp integration for local LLM inference when Ollama is unavailable.
Uses llama-cpp-python bindings to load GGUF models and run inference natively.

This service exposes local CPU inference only when a configured GGUF model has
loaded successfully. It never substitutes a rule-based or fabricated response.

Technology: Python · llama-cpp-python · Flask
Port: 8204
"""
import os
import sys
import json
import time
import logging
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Optional, Dict, Any, List

PORT = int(os.environ.get("LLAMACPP_PORT", "8204"))
MODEL_PATH = os.environ.get("LLAMACPP_MODEL_PATH", "")
OLLAMA_MODELS_DIR = os.path.expanduser("~/.ollama/models")
N_CTX = int(os.environ.get("LLAMACPP_N_CTX", "2048"))
N_THREADS = int(os.environ.get("LLAMACPP_N_THREADS", "4"))
MAX_TOKENS = int(os.environ.get("LLAMACPP_MAX_TOKENS", "512"))
TEMPERATURE = float(os.environ.get("LLAMACPP_TEMPERATURE", "0.3"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [NDSEP-LlamaCpp] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

_model = None
_model_name: str = "none"
_model_loaded: bool = False
_total_requests: int = 0
_total_tokens: int = 0
_start_time = time.time()


def find_gguf_model() -> Optional[str]:
    """Search for a GGUF model file in common locations."""
    search_paths = [
        MODEL_PATH,
        os.path.expanduser("~/models"),
        "/opt/models",
        os.path.join(OLLAMA_MODELS_DIR, "blobs"),
    ]
    for path in search_paths:
        if not path or not os.path.exists(path):
            continue
        if os.path.isfile(path) and path.endswith(".gguf"):
            return path
        if os.path.isdir(path):
            for f in sorted(os.listdir(path), reverse=True):
                if f.endswith(".gguf"):
                    return os.path.join(path, f)
    return None


def load_model():
    """Attempt to load a GGUF model using llama-cpp-python."""
    global _model, _model_name, _model_loaded
    try:
        from llama_cpp import Llama
    except ImportError:
        log.warning("llama-cpp-python not installed. Install with: pip install llama-cpp-python")
        _model_loaded = False
        return False

    model_path = find_gguf_model()
    if not model_path:
        log.warning("No GGUF model found. Set LLAMACPP_MODEL_PATH or place .gguf files in ~/models/")
        _model_loaded = False
        return False

    try:
        log.info(f"Loading model from {model_path}...")
        _model = Llama(
            model_path=model_path,
            n_ctx=N_CTX,
            n_threads=N_THREADS,
            verbose=False,
        )
        _model_name = os.path.basename(model_path)
        _model_loaded = True
        log.info(f"Model loaded: {_model_name}")
        return True
    except Exception as e:
        log.error(f"Failed to load model: {e}")
        _model_loaded = False
        return False


def generate(prompt: str, system: str = "", max_tokens: int = MAX_TOKENS, temperature: float = TEMPERATURE) -> Dict[str, Any]:
    """Run inference using the loaded llama.cpp model."""
    global _total_requests, _total_tokens

    if not _model_loaded or _model is None:
        return {
            "response": "",
            "error": "Model not loaded. llama.cpp fallback unavailable.",
            "model": "none",
            "fallback": True,
        }

    _total_requests += 1
    start = time.time()

    full_prompt = prompt
    if system:
        full_prompt = f"### System:\n{system}\n\n### User:\n{prompt}\n\n### Assistant:\n"

    try:
        result = _model(
            full_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            stop=["### User:", "### System:", "\n\n\n"],
            echo=False,
        )
        text = result["choices"][0]["text"].strip()
        tokens = result.get("usage", {}).get("total_tokens", 0)
        _total_tokens += tokens

        return {
            "response": text,
            "model": _model_name,
            "tokens": tokens,
            "duration_ms": int((time.time() - start) * 1000),
            "engine": "llama.cpp",
        }
    except Exception as e:
        log.error(f"Inference error: {e}")
        return {
            "response": "",
            "error": str(e),
            "model": _model_name,
            "engine": "llama.cpp",
        }


COMPLIANCE_SYSTEM_PROMPT = """You are an expert NDPA (Nigeria Data Protection Act 2023) compliance advisor.
Provide precise, actionable guidance. Reference specific NDPA sections when relevant.
Be concise but comprehensive."""


class LlamaCppHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        log.info(format % args)

    def _send_json(self, data: dict, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def _send_inference_result(self, result: dict):
        self._send_json(result, 503 if result.get("error") else 200)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._send_json({
                "status": "healthy" if _model_loaded else "unhealthy",
                "service": "llamacpp-inference",
                "version": "1.0.0",
                "model": _model_name,
                "model_loaded": _model_loaded,
                "engine": "llama.cpp",
                "n_ctx": N_CTX,
                "n_threads": N_THREADS,
                "total_requests": _total_requests,
                "total_tokens": _total_tokens,
                "uptime_seconds": int(time.time() - _start_time),
            }, 200 if _model_loaded else 503)
        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        body = self._read_body()

        if self.path == "/generate":
            prompt = body.get("prompt", "")
            system = body.get("system", "")
            max_tokens = body.get("max_tokens", MAX_TOKENS)
            temperature = body.get("temperature", TEMPERATURE)
            result = generate(prompt, system, max_tokens, temperature)
            self._send_inference_result(result)

        elif self.path == "/compliance-qa":
            question = body.get("question", "")
            context = body.get("context", "")
            prompt = f"Question: {question}"
            if context:
                prompt = f"Context:\n{context}\n\n{prompt}"
            result = generate(prompt, COMPLIANCE_SYSTEM_PROMPT)
            self._send_inference_result(result)

        elif self.path == "/classify":
            text = body.get("text", "")
            prompt = f"Classify this violation and respond with JSON only:\n{text}"
            system = """Classify violations into CRITICAL/HIGH/MEDIUM/LOW severity.
Categories: data_breach, consent_violation, cross_border_transfer, retention_violation.
Respond ONLY with JSON: {{"severity": "...", "category": "...", "ndpa_section": "...", "recommended_action": "..."}}"""
            result = generate(prompt, system)
            self._send_inference_result(result)

        elif self.path == "/summarize":
            document = body.get("document", body.get("text", ""))
            prompt = f"Summarize the following compliance document into key obligations, risks, and recommended actions:\n\n{document[:3000]}"
            result = generate(prompt, "You are a compliance document summarizer. Be concise, use bullet points.")
            self._send_inference_result(result)

        else:
            self._send_json({"error": "endpoint not found"}, 404)


def main():
    log.info("NDSEP llama.cpp Inference Engine starting...")
    load_model()

    server = HTTPServer(("0.0.0.0", PORT), LlamaCppHandler)
    log.info(f"llama.cpp inference listening on port {PORT}")
    log.info(f"Model loaded: {_model_loaded}, Model: {_model_name}")
    log.info("Endpoints: /health, /generate, /compliance-qa, /classify, /summarize")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
