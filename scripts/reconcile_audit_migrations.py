#!/usr/bin/env python3
"""Reconcile divergent Drizzle migrations in an audit-branch worktree.

The script is intentionally local-only. It replaces colliding migration files with
production versions, preserves the audit SQL under a new ordered identifier, and
rebuilds the journal as production history followed by the audit deltas. It never
contacts a remote or runs migrations.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

BASE = "origin/production"
ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "drizzle"
JOURNAL = MIGRATIONS / "meta" / "_journal.json"


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True)


def files_at(ref: str) -> list[str]:
    paths = git("ls-tree", "-r", "--name-only", ref, "--", "drizzle").splitlines()
    return sorted(path for path in paths if path.startswith("drizzle/") and path.endswith(".sql"))


def content_at(ref: str, path: str) -> str:
    return git("show", f"{ref}:{path}")


def tag(path: str) -> str:
    return Path(path).stem


def main() -> None:
    base_files = files_at(BASE)
    audit_files = sorted(path.relative_to(ROOT).as_posix() for path in MIGRATIONS.glob("[0-9][0-9][0-9][0-9]_*.sql"))
    base_journal = json.loads(content_at(BASE, "drizzle/meta/_journal.json"))
    audit_journal = json.loads(JOURNAL.read_text())
    base_by_tag = {entry["tag"]: entry for entry in base_journal["entries"]}
    audit_by_tag = {entry["tag"]: entry for entry in audit_journal["entries"]}

    deltas: list[tuple[str, str]] = []
    for path in audit_files:
        local = (ROOT / path).read_text()
        if path not in base_files:
            deltas.append((path, local))
        else:
            base = content_at(BASE, path)
            if local != base:
                deltas.append((path, local))
                (ROOT / path).write_text(base)

    numeric_base = max(int(Path(path).name[:4]) for path in base_files if Path(path).name[:4].isdigit())
    next_number = numeric_base + 1
    mapping: list[dict[str, str]] = []
    for original, body in deltas:
        suffix = Path(original).name[5:]
        target = f"drizzle/{next_number:04d}_audit_reconciled_{suffix}"
        next_number += 1
        original_path = ROOT / original
        if original_path.exists() and original not in base_files:
            original_path.unlink()
        (ROOT / target).write_text(body)
        mapping.append({"from": original, "to": target})

    old_to_new_tag = {tag(item["from"]): tag(item["to"]) for item in mapping}
    entries = list(base_journal["entries"])
    base_when = max((int(entry.get("when", 0)) for entry in entries), default=0)
    for ordinal, item in enumerate(mapping, 1):
        original_tag = tag(item["from"])
        source = audit_by_tag.get(original_tag, {"version": "7", "breakpoints": True})
        entries.append({
            "idx": len(entries),
            "version": source.get("version", "7"),
            "when": base_when + ordinal,
            "tag": old_to_new_tag[original_tag],
            "breakpoints": source.get("breakpoints", True),
        })
    JOURNAL.write_text(json.dumps({"version": base_journal.get("version", "7"), "dialect": base_journal.get("dialect", "postgresql"), "entries": entries}, indent=2) + "\n")
    (ROOT / "drizzle" / "AUDIT_MIGRATION_RECONCILIATION.json").write_text(json.dumps({"base": BASE, "mapping": mapping}, indent=2) + "\n")
    print(json.dumps({"reconciled": len(mapping), "mapping": mapping}, indent=2))


if __name__ == "__main__":
    main()
