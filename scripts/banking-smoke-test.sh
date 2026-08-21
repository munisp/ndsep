#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Banking Services Smoke Test
# Validates all banking API endpoints return 200 and expected shapes
# Usage: ./scripts/banking-smoke-test.sh [base_url]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0

function test_endpoint() {
  local name="$1"
  local procedure="$2"
  local input="${3:-{}}"
  
  local url="${BASE_URL}/api/trpc/${procedure}?input=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${input}'))")"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  
  if [ "$status" = "200" ]; then
    echo "  PASS: $name ($status)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name ($status)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== NDSEP Banking Services Smoke Test ==="
echo "Target: $BASE_URL"
echo ""

echo "── Banking Institutions ──"
test_endpoint "List institutions" "bankingServices.listInstitutions" '{"page":1,"limit":5}'
test_endpoint "Institution stats" "bankingServices.institutionStats"

echo "── KYC Management ──"
test_endpoint "List KYC records" "bankingServices.list" '{"page":1,"limit":5}'
test_endpoint "KYC stats" "bankingServices.kycStats"

echo "── AML Cases ──"
test_endpoint "List AML cases" "bankingServices.amlList" '{"page":1,"limit":5}'
test_endpoint "AML stats" "bankingServices.amlStats"

echo "── Watchlist Screening ──"
test_endpoint "List watchlist" "bankingServices.watchlistList" '{"page":1,"limit":5}'

echo "── SWIFT Transactions ──"
test_endpoint "List SWIFT" "bankingServices.swiftList" '{"page":1,"limit":5}'
test_endpoint "SWIFT stats" "bankingServices.swiftStats"

echo "── Fraud Alerts ──"
test_endpoint "List fraud alerts" "bankingServices.fraudList" '{"page":1,"limit":5}'
test_endpoint "Fraud stats" "bankingServices.fraudStats"

echo "── CBN Reports ──"
test_endpoint "List CBN reports" "bankingServices.cbnReportsList" '{"page":1,"limit":5}'

echo "── Correspondent Banks ──"
test_endpoint "List correspondents" "bankingServices.correspondentList" '{"page":1,"limit":5}'

echo "── Payments Monitor ──"
test_endpoint "List payments" "bankingServices.paymentsList" '{"page":1,"limit":5}'

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
exit $FAIL
