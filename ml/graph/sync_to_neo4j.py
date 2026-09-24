#!/usr/bin/env python3
"""Push the current compliance graph into Neo4j.

    python -m ml.graph.sync_to_neo4j [--source lakehouse|synthetic]
        [--n-orgs 800] [--seed 42] [--batch-size 1000] [--dry-run]

Loads the training graph via ml.graph.graph_source (lakehouse snapshot or
fresh synthetic generation — Neo4j itself is skipped, since it is the
push target) and MERGEs it into the Neo4j store configured by
NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD. Idempotent: re-running MERGEs the
same node_id keys and (src, dst, type) relationships.

--dry-run loads the graph and prints what would be pushed without
connecting to Neo4j (useful for CI / sandboxes without docker).
"""

from __future__ import annotations

import argparse
import json
import sys

from ml.graph.graph_source import load_training_graph
from ml.graph.neo4j_store import (DEFAULT_BATCH_SIZE, HAS_NEO4J,
                                  Neo4jGraphStore)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", choices=["lakehouse", "synthetic"],
                    default="lakehouse",
                    help="where to load the graph from (default: lakehouse)")
    ap.add_argument("--n-orgs", type=int, default=800)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    ap.add_argument("--dry-run", action="store_true",
                    help="load and summarise only; do not connect to Neo4j")
    args = ap.parse_args(argv)

    nodes, edges, labels, src = load_training_graph(
        source=args.source, n_orgs=args.n_orgs, seed=args.seed)
    print(f"[sync] loaded graph from {src}: {len(nodes)} nodes, "
          f"{len(edges)} edges, {len(labels)} labels")

    if args.dry_run:
        print(json.dumps({"dry_run": True, "source": src,
                          "nodes": int(len(nodes)),
                          "edges": int(len(edges)),
                          "labels": int(len(labels))}, indent=2))
        return 0

    if not HAS_NEO4J:
        print("[sync] ERROR: neo4j driver not installed "
              "(pip install neo4j)", file=sys.stderr)
        return 2

    with Neo4jGraphStore(batch_size=args.batch_size) as store:
        summary = store.push_graph(nodes, edges, labels=labels)
    print(json.dumps({"pushed": True, "source": src, **summary}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
