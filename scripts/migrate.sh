#!/usr/bin/env bash
# NDSEP canonical database migration wrapper.
#
# The platform uses the checked-in Drizzle journal in ../drizzle. The former
# golang-migrate chain diverged from the application schema and must not be used
# to provision production databases.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMMAND="${1:-up}"
case "$COMMAND" in
  up)
    echo "Applying canonical Drizzle migrations..."
    pnpm exec drizzle-kit migrate --config drizzle.config.ts
    echo "Migrations complete."
    ;;
  version)
    echo "Recorded Drizzle migrations:"
    node -e 'const fs=require("fs"); const journal=JSON.parse(fs.readFileSync("drizzle/meta/_journal.json","utf8")); console.log(journal.entries.map(e => `${e.idx}: ${e.tag}`).join("\n"));'
    ;;
  down|force|drop)
    echo "Refusing destructive migration command '$COMMAND'. Restore from a verified backup or use an explicitly reviewed forward migration." >&2
    exit 2
    ;;
  *)
    echo "Usage: $0 [up|version]" >&2
    exit 2
    ;;
esac
