#!/usr/bin/env python3
"""Remove host-published Compose ports except for explicitly approved edge services.

This is intentionally line-oriented because the production Compose file preserves
comments and anchors that generic YAML serializers would discard. It accepts only
standard four-space service keys and `ports:` sequence blocks.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys

SERVICE_RE = re.compile(r"^  ([A-Za-z0-9_-]+):\s*$")
PORTS_RE = re.compile(r"^    ports:\s*$")


def transform(text: str, allow: set[str]) -> tuple[str, list[str]]:
    active_service: str | None = None
    skipping_ports = False
    removed: list[str] = []
    out: list[str] = []

    for line in text.splitlines(keepends=True):
        service_match = SERVICE_RE.match(line.rstrip("\n"))
        if service_match:
            active_service = service_match.group(1)
            skipping_ports = False

        if skipping_ports:
            # Port mappings are more deeply indented than a service property.
            if line.startswith("      ") or line.strip() == "":
                continue
            skipping_ports = False

        if PORTS_RE.match(line.rstrip("\n")) and active_service not in allow:
            removed.append(active_service or "<unknown>")
            skipping_ports = True
            continue

        out.append(line)

    return "".join(out), removed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("compose_file", type=Path)
    parser.add_argument("--allow", action="append", default=["caddy"], help="Service permitted to publish host ports")
    parser.add_argument("--apply", action="store_true", help="Write the hardened result")
    args = parser.parse_args()

    original = args.compose_file.read_text(encoding="utf-8")
    updated, removed = transform(original, set(args.allow))
    print(f"services with host ports removed: {', '.join(removed) if removed else 'none'}")
    if args.apply and updated != original:
        args.compose_file.write_text(updated, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
