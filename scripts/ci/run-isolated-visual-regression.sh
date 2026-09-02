#!/usr/bin/env bash
# Run the NDSEP Chromium visual suite from a detached source-commit worktree
# against a disposable localhost PostgreSQL database and isolated app port.
# This diagnostic script never passes --update-snapshots, creates no review or
# approval, and removes any Playwright candidate files with its worktree.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

if [[ -n "$(git status --porcelain)" ]]; then
  printf 'refusing to run from a dirty checkout; commit or discard local changes first\n' >&2
  exit 65
fi

source_commit="$(git rev-parse HEAD)"
git cat-file -e "${source_commit}^{commit}"

port="${NDSEP_VISUAL_PORT:-3101}"
if ! [[ "$port" =~ ^[0-9]{2,5}$ ]] || ((port < 1024 || port > 65535)); then
  printf 'NDSEP_VISUAL_PORT must be an unprivileged TCP port (1024-65535)\n' >&2
  exit 64
fi
if netstat -ltn 2>/dev/null | awk -v port=":${port}" '$4 ~ (port "$") { found=1 } END { exit(found ? 0 : 1) }'; then
  printf 'NDSEP_VISUAL_PORT=%s is already listening; choose an unused isolated port\n' "$port" >&2
  exit 69
fi

run_nonce="$(date +%s)_$$"
role="ndsep_visual_${run_nonce}"
database="ndsep_visual_${run_nonce}"
password="ndsep_visual_local_only_${run_nonce}"
base_url="http://127.0.0.1:${port}"
output_dir="${NDSEP_VISUAL_OUTPUT_DIR:-$(mktemp -d /tmp/ndsep-visual-regression.XXXXXX)}"
worktree_parent="$(mktemp -d /tmp/ndsep-visual-worktree.XXXXXX)"
worktree="$worktree_parent/checkout"
server_pid=""
worktree_created=false

if [[ "$output_dir" != /tmp/* && "$output_dir" != /home/ubuntu/* ]]; then
  printf 'NDSEP_VISUAL_OUTPUT_DIR must be under /tmp or /home/ubuntu\n' >&2
  exit 64
fi
mkdir -p "$output_dir"
printf '%s\n' "$source_commit" >"$output_dir/source-commit.txt"
printf '%s\n' "$base_url" >"$output_dir/base-url.txt"

cleanup() {
  local exit_status=$?
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL >/dev/null 2>&1 || true
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS ${database};
DROP ROLE IF EXISTS ${role};
SQL
  if [[ "$worktree_created" == true ]]; then
    git -C "$repo_root" worktree remove --force "$worktree" >/dev/null 2>&1 || true
  fi
  rm -rf "$worktree_parent"
  printf 'diagnostic_output=%s\n' "$output_dir" >&2
  exit "$exit_status"
}
trap cleanup EXIT INT TERM

if ! sudo -u postgres psql -Atqc 'SELECT 1' >/dev/null; then
  printf 'local PostgreSQL superuser access is required for isolated visual diagnostics\n' >&2
  exit 69
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE ${role} LOGIN PASSWORD '${password}';
CREATE DATABASE ${database} OWNER ${role};
SQL

git -C "$repo_root" worktree add --detach "$worktree" "$source_commit" >"$output_dir/worktree.log" 2>&1
worktree_created=true

export DATABASE_URL="postgresql://${role}:${password}@127.0.0.1:5432/${database}"
export NODE_ENV=test
export SKIP_DATABASE_MIGRATIONS=true
export JWT_SECRET=test-jwt-secret-for-isolated-visual-diagnostics-only
export FIELD_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef
export PORT="$port"
export BASE_URL="$base_url"
export E2E_BASE_URL="$base_url"
export CI=1
export PLAYWRIGHT_JSON_OUTPUT_NAME="$output_dir/test-results.json"

cd "$worktree"
pnpm install --frozen-lockfile --ignore-scripts >"$output_dir/pnpm-install.log" 2>&1
pnpm exec drizzle-kit push --force >"$output_dir/migration.log" 2>&1
pnpm exec playwright install --with-deps chromium >"$output_dir/playwright-browser-install.log" 2>&1
pnpm run build >"$output_dir/build.log" 2>&1
node dist/index.js >"$output_dir/server.log" 2>&1 &
server_pid=$!
printf '%s\n' "$server_pid" >"$output_dir/server.pid"

healthy=false
for attempt in {1..30}; do
  if curl --fail --silent --show-error "$base_url/api/health" >"$output_dir/health.json"; then
    healthy=true
    break
  fi
  sleep 2
done
if [[ "$healthy" != true ]]; then
  printf 'isolated application did not become healthy; see %s/server.log\n' "$output_dir" >&2
  exit 1
fi

set +e
pnpm exec playwright test e2e/visual-regression.spec.ts \
  --project=chromium \
  --workers=1 \
  --retries=0 \
  --timeout=60000 \
  --reporter=line,json \
  --output="$output_dir/playwright-output" \
  >"$output_dir/playwright.log" 2>&1
test_status=$?
set -e
printf '%s\n' "$test_status" >"$output_dir/playwright-exit-status.txt"

if [[ ! -f "$output_dir/test-results.json" ]]; then
  printf 'Playwright did not write the expected JSON result: %s/test-results.json\n' "$output_dir" >&2
  exit 1
fi

if [[ "$test_status" -eq 0 ]]; then
  printf 'isolated_visual_status=passed\n'
else
  printf 'isolated_visual_status=failed\n' >&2
fi
exit "$test_status"
