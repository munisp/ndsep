#!/bin/bash
# NDSEP Ollama + Qwen Installation Script
# Installs Ollama (which uses llama.cpp backend internally) and pulls the Qwen 2.5 model.
#
# Usage: ./scripts/install-ollama.sh
# Requirements: curl, zstd, systemd
set -euo pipefail

echo "=== NDSEP Ollama + Qwen Installation ==="

# Install zstd if missing (required by Ollama installer)
if ! command -v zstd &>/dev/null; then
    echo "Installing zstd..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get install -y zstd
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y zstd
    elif command -v pacman &>/dev/null; then
        sudo pacman -S --noconfirm zstd
    else
        echo "ERROR: Cannot install zstd. Please install manually."
        exit 1
    fi
fi

# Install Ollama
if ! command -v ollama &>/dev/null; then
    echo "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
else
    echo "Ollama already installed: $(ollama --version)"
fi

# Wait for Ollama service to start
echo "Waiting for Ollama service..."
for i in $(seq 1 15); do
    if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
        echo "Ollama is running."
        break
    fi
    sleep 2
done

# Pull Qwen 2.5 model (1.5B for resource-constrained environments)
echo "Pulling Qwen 2.5 model..."
ollama pull qwen2.5:1.5b

# Verify
echo ""
echo "=== Verification ==="
ollama list
echo ""
echo "Testing Qwen inference..."
RESPONSE=$(curl -sf http://localhost:11434/api/generate -d '{
  "model": "qwen2.5:1.5b",
  "prompt": "What is NDPA 2023?",
  "stream": false
}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('response','')[:100])" 2>/dev/null || echo "Inference test skipped")
echo "Response: ${RESPONSE}"

echo ""
echo "=== Installation Complete ==="
echo "Ollama:  http://localhost:11434"
echo "Model:   qwen2.5:1.5b"
echo "Backend: llama.cpp (built into Ollama)"
echo ""
echo "Workers that use this:"
echo "  - ollama_llm_worker.py     (port 8203) — compliance Q&A, doc summarization"
echo "  - noc_agent_reasoning.py   (port 8195) — root cause analysis"
echo "  - ai_compliance_engine.py  (port N/A)  — NDPA compliance queries"
echo "  - rag_orchestrator (Go)    (port N/A)  — RAG pipeline LLM generation"
echo "  - llamacpp_inference.py    (port 8204) — native llama.cpp fallback"
