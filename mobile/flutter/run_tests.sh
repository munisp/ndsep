#!/usr/bin/env bash
# NDSEP Flutter Test Runner — Phase 40
# =====================================
# Runs all Flutter unit, widget, and integration tests.
# Prerequisites:
#   - Flutter SDK installed (flutter --version)
#   - NDSEP dev server running at localhost:3000 (for integration tests)
#   - NDSEP_BASE_URL env var set (defaults to http://localhost:3000)
#   - NDSEP_TEST_TOKEN env var set (JWT token for a test user, optional)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export NDSEP_BASE_URL="${NDSEP_BASE_URL:-http://localhost:3000}"
export NDSEP_TEST_TOKEN="${NDSEP_TEST_TOKEN:-}"

echo "=============================================="
echo "  NDSEP Flutter Test Suite"
echo "  Base URL: $NDSEP_BASE_URL"
echo "=============================================="

# 1. Unit tests (no device required)
echo ""
echo "--- Unit Tests ---"
flutter test test/unit/ --reporter=compact || {
  echo "Unit tests FAILED"
  exit 1
}

# 2. Widget tests (no device required)
echo ""
echo "--- Widget Tests ---"
flutter test test/unit/screen_widget_test.dart --reporter=compact || {
  echo "Widget tests FAILED"
  exit 1
}

# 3. Integration tests (requires running server)
if curl -sf "${NDSEP_BASE_URL}/api/trpc/auth.me" > /dev/null 2>&1; then
  echo ""
  echo "--- Integration Tests (server at $NDSEP_BASE_URL) ---"
  flutter test test/integration/ --reporter=compact || {
    echo "Integration tests FAILED"
    exit 1
  }
else
  echo ""
  echo "--- Integration Tests SKIPPED (server not reachable at $NDSEP_BASE_URL) ---"
fi

echo ""
echo "=============================================="
echo "  All Flutter tests PASSED"
echo "=============================================="
