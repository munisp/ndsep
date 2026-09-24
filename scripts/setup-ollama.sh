#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# NDSEP Ollama Model Bootstrap
# ─────────────────────────────────────────────────────────────────────────────
# Pulls the default LLM into the `ollama` compose service
# (docker-compose-workers-addition.yml, container ndsep-ollama).
#
# The API server, ollama_llm_worker and epr_kgqa_worker all talk to
# OLLAMA_URL (http://ollama:11434 inside the ndsep-internal network), but the
# server ships with no models — this script performs the one-time pull.
#
# Usage:
#   ./scripts/setup-ollama.sh                 # pull default model (qwen2.5:3b)
#   OLLAMA_MODEL=mistral ./scripts/setup-ollama.sh
#   OLLAMA_CONTAINER=my-ollama ./scripts/setup-ollama.sh
#
# Environment variables:
#   OLLAMA_CONTAINER   (default: ndsep-ollama)
#   OLLAMA_MODEL       (default: qwen2.5:3b — small, strong reasoning,
#                       multilingual, data-residency compliant)
#
# NOTE: qwen2.5:3b is ~2GB; the first pull can take several minutes. Models
# persist on the `ollama_data` volume, so this only needs to run once per
# environment. Set OLLAMA_MODEL in the workers' environment to match the
# model pulled here.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

OLLAMA_CONTAINER="${OLLAMA_CONTAINER:-ndsep-ollama}"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:3b}"

if ! docker ps --format '{{.Names}}' | grep -qx "${OLLAMA_CONTAINER}"; then
  echo "ERROR: container '${OLLAMA_CONTAINER}' is not running." >&2
  echo "Start it first, e.g.:" >&2
  echo "  docker compose -f docker-compose.yml -f docker-compose-workers-addition.yml up -d ollama" >&2
  exit 1
fi

echo "Pulling ${OLLAMA_MODEL} into ${OLLAMA_CONTAINER} (this can take a while)…"
docker exec "${OLLAMA_CONTAINER}" ollama pull "${OLLAMA_MODEL}"

echo
echo "Installed models:"
docker exec "${OLLAMA_CONTAINER}" ollama list

echo
echo "Done. Ensure OLLAMA_MODEL=${OLLAMA_MODEL} (or the default) in"
echo "ollama_llm_worker / epr_kgqa_worker / ndsep-api environments."
