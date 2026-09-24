"""Neo4j graph integration for the NDSEP ML stack.

Modules:
    neo4j_store      — real Neo4j client (official `neo4j` driver, optional)
    graph_source     — canonical training-graph source with fallback chain
    sync_to_neo4j    — CLI to push the current graph into Neo4j

See ml/README.md, section "Neo4j graph store".
"""

from ml.graph.neo4j_store import HAS_NEO4J, Neo4jGraphStore, Neo4jStoreError

__all__ = ["HAS_NEO4J", "Neo4jGraphStore", "Neo4jStoreError"]
