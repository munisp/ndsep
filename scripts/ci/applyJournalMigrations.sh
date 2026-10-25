#!/usr/bin/env bash
# Apply the drizzle-kit journal migrations (drizzle/00*.sql) in journal order.
#
# The hand-written runner scripts/runRawMigrations.mjs covers only
# drizzle/migrations/*.sql; the journal track is normally applied by
# scripts/migrate.sh via drizzle-kit. For the CI migration dry-run (and for
# the round-10 real-Postgres validation) we apply the journal files directly
# with psql, in drizzle/meta/_journal.json order, which is exactly what
# drizzle-kit migrate does.
#
# Required env: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE (psql conventions)
# Usage: scripts/ci/applyJournalMigrations.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

mapfile -t FILES < <(python3 - "$ROOT" <<'EOF'
import json, sys, os
root = sys.argv[1]
journal = json.load(open(os.path.join(root, "drizzle/meta/_journal.json")))
for e in sorted(journal["entries"], key=lambda x: x["idx"]):
    p = os.path.join(root, "drizzle", e["tag"] + ".sql")
    if not os.path.exists(p):
        sys.exit(f"journal entry missing on disk: {p}")
    print(p)
EOF
)

echo "[applyJournalMigrations] applying ${#FILES[@]} journal migrations in journal order"
for f in "${FILES[@]}"; do
  echo "[applyJournalMigrations] $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "[applyJournalMigrations] OK"
