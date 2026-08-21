#!/usr/bin/env bash
# Bootstrap script for NDSEP Python workers
# Run this once before starting the workers in production
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[NDSEP] Installing Python worker dependencies..."
pip install --upgrade pip --quiet
pip install -r "${SCRIPT_DIR}/requirements.txt" --quiet
echo "[NDSEP] Python worker dependencies installed successfully."
