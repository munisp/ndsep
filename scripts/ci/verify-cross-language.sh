#!/usr/bin/env bash
set -u -o pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
log_dir="${1:-$root/.verification}"
mkdir -p "$log_dir"

export PATH="$HOME/.local/toolchains/go/bin:$HOME/.cargo/bin:$PATH"

declare -a labels=(
  "root_typecheck"
  "root_test"
  "root_build"
  "root_audit"
  "mobile_typecheck"
  "mobile_lint"
  "mobile_test"
  "mobile_audit"
  "go_build"
  "go_vet"
  "go_test"
  "python_compile"
  "rust_fmt"
  "rust_clippy"
  "rust_build"
  "rust_test"
  "rust_audit"
)

declare -a commands=(
  "cd '$root' && pnpm check"
  "cd '$root' && pnpm test"
  "cd '$root' && pnpm build"
  "cd '$root' && pnpm audit --audit-level high"
  "cd '$root/mobile' && pnpm check"
  "cd '$root/mobile' && pnpm lint"
  "cd '$root/mobile' && pnpm test"
  "cd '$root/mobile' && pnpm audit --audit-level high"
  "cd '$root/orchestration/go' && go build ./..."
  "cd '$root/orchestration/go' && go vet ./..."
  "cd '$root/orchestration/go' && go test ./..."
  "python3 -m compileall -q '$root/services/python'"
  "cd '$root/workers/rust' && cargo fmt --check"
  "cd '$root/workers/rust' && cargo clippy --workspace --all-targets -- -D warnings"
  "cd '$root/workers/rust' && cargo build --workspace --release"
  "cd '$root/workers/rust' && cargo test --workspace --release"
  "cd '$root/workers/rust' && cargo audit"
)

failures=0
: > "$log_dir/summary.txt"
for index in "${!labels[@]}"; do
  label="${labels[$index]}"
  command="${commands[$index]}"
  if bash -lc "$command" > "$log_dir/$label.log" 2>&1; then
    printf 'PASS %s\n' "$label" | tee -a "$log_dir/summary.txt"
  else
    printf 'FAIL %s\n' "$label" | tee -a "$log_dir/summary.txt"
    failures=$((failures + 1))
  fi
done

printf 'TOTAL_FAILURES=%s\n' "$failures" | tee -a "$log_dir/summary.txt"
exit "$failures"
