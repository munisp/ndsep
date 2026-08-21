package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

var falkorRebuildMu sync.Mutex

// rebuildFromPostgres materializes the existing PostgreSQL snapshot builder into
// FalkorDB. The legacy graph object is used only as a short-lived serialization
// buffer; it is never exposed as a query source and is cleared before return.
func (a *FalkorAdapter) rebuildFromPostgres(db *sql.DB) (falkorGraphStats, error) {
	if a == nil {
		return falkorGraphStats{}, fmt.Errorf("FalkorDB adapter is not initialized")
	}
	if db == nil {
		return falkorGraphStats{}, fmt.Errorf("PostgreSQL source is not initialized")
	}
	falkorRebuildMu.Lock()
	defer falkorRebuildMu.Unlock()

	if err := buildGraph(db); err != nil {
		return falkorGraphStats{}, err
	}
	defer func() {
		// Do not retain a process-local fallback graph after materialization.
		graph = &InMemoryGraph{Nodes: make(map[string]GraphNode), Edges: []GraphEdge{}, Adj: make(map[string][]struct {
			To, Rel string
			W       float64
		})}
	}()

	// The rebuild endpoint is explicitly gated because it replaces the complete
	// NDSEP-labelled snapshot. Other FalkorDB graphs are never touched.
	if _, err := a.query(`MATCH (node:NDSEP) DETACH DELETE node`, nil); err != nil {
		return falkorGraphStats{}, fmt.Errorf("clear prior NDSEP graph snapshot: %w", err)
	}

	for _, node := range graph.Nodes {
		properties, err := json.Marshal(node.Properties)
		if err != nil {
			return falkorGraphStats{}, fmt.Errorf("encode graph node %s: %w", node.ID, err)
		}
		if _, err := a.query(`MERGE (node:NDSEP {id: $id})
SET node.node_type = $node_type, node.properties_json = $properties_json`, map[string]interface{}{
			"id": node.ID, "node_type": node.Type, "properties_json": string(properties),
		}); err != nil {
			return falkorGraphStats{}, fmt.Errorf("materialize graph node %s: %w", node.ID, err)
		}
	}

	for _, edge := range graph.Edges {
		relation := strings.ToUpper(strings.TrimSpace(edge.Relation))
		if err := validateGraphRelation(relation); err != nil {
			return falkorGraphStats{}, fmt.Errorf("materialize graph edge %s -> %s: %w", edge.FromID, edge.ToID, err)
		}
		// Relationship labels cannot be query parameters. relation is validated
		// against the closed compile-time allow-list before interpolation.
		cypher := fmt.Sprintf(`MATCH (source:NDSEP {id: $from_id}), (target:NDSEP {id: $to_id})
MERGE (source)-[edge:%s]->(target)
SET edge.weight = $weight`, relation)
		if _, err := a.query(cypher, map[string]interface{}{
			"from_id": edge.FromID, "to_id": edge.ToID, "weight": edge.Weight,
		}); err != nil {
			return falkorGraphStats{}, fmt.Errorf("materialize graph edge %s -> %s: %w", edge.FromID, edge.ToID, err)
		}
	}

	lastBuildTime = time.Now().UTC().Format(time.RFC3339)
	return a.stats()
}
