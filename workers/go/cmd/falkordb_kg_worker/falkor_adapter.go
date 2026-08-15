package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	falkordb "github.com/FalkorDB/falkordb-go/v2"
)

// FalkorAdapter is the only supported graph dependency for this worker. It never
// retains graph data locally and returns an error whenever FalkorDB cannot prove
// a read or write completed.
type FalkorAdapter struct {
	db             *falkordb.FalkorDB
	graph          *falkordb.Graph
	queryTimeoutMS int
}

func newFalkorAdapter(ctx context.Context, rawURL, graphName string, queryTimeoutMS int) (*FalkorAdapter, error) {
	if strings.TrimSpace(rawURL) == "" {
		return nil, fmt.Errorf("FALKORDB_URL is required")
	}
	if strings.TrimSpace(graphName) == "" {
		return nil, fmt.Errorf("FALKORDB_GRAPH_NAME is required")
	}
	if queryTimeoutMS <= 0 {
		return nil, fmt.Errorf("FALKORDB_QUERY_TIMEOUT_MS must be positive")
	}

	db, err := falkordb.FromURL(rawURL)
	if err != nil {
		return nil, fmt.Errorf("configure FalkorDB client: %w", err)
	}

	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := db.Conn.Ping(probeCtx).Err(); err != nil {
		_ = db.Conn.Close()
		return nil, fmt.Errorf("connect FalkorDB: %w", err)
	}

	adapter := &FalkorAdapter{
		db:             db,
		graph:          db.SelectGraph(graphName),
		queryTimeoutMS: queryTimeoutMS,
	}
	if _, err := adapter.graph.Query("RETURN 1 AS ready", nil, falkordb.NewQueryOptions().SetTimeout(queryTimeoutMS)); err != nil {
		_ = db.Conn.Close()
		return nil, fmt.Errorf("probe FalkorDB graph %q: %w", graphName, err)
	}
	return adapter, nil
}

func (a *FalkorAdapter) close() error {
	if a == nil || a.db == nil || a.db.Conn == nil {
		return nil
	}
	return a.db.Conn.Close()
}

func (a *FalkorAdapter) health(ctx context.Context) error {
	if a == nil || a.db == nil || a.graph == nil {
		return fmt.Errorf("FalkorDB adapter is not initialized")
	}
	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := a.db.Conn.Ping(probeCtx).Err(); err != nil {
		return fmt.Errorf("FalkorDB ping failed: %w", err)
	}
	if _, err := a.graph.ROQuery("RETURN 1 AS ready", nil, falkordb.NewQueryOptions().SetTimeout(a.queryTimeoutMS)); err != nil {
		return fmt.Errorf("FalkorDB graph probe failed: %w", err)
	}
	return nil
}

func (a *FalkorAdapter) query(cypher string, params map[string]interface{}) (*falkordb.QueryResult, error) {
	if a == nil || a.graph == nil {
		return nil, fmt.Errorf("FalkorDB adapter is not initialized")
	}
	result, err := a.graph.Query(cypher, params, falkordb.NewQueryOptions().SetTimeout(a.queryTimeoutMS))
	if err != nil {
		return nil, fmt.Errorf("FalkorDB query failed: %w", err)
	}
	return result, nil
}

func (a *FalkorAdapter) readOnlyQuery(cypher string, params map[string]interface{}) (*falkordb.QueryResult, error) {
	if a == nil || a.graph == nil {
		return nil, fmt.Errorf("FalkorDB adapter is not initialized")
	}
	result, err := a.graph.ROQuery(cypher, params, falkordb.NewQueryOptions().SetTimeout(a.queryTimeoutMS))
	if err != nil {
		return nil, fmt.Errorf("FalkorDB read-only query failed: %w", err)
	}
	return result, nil
}

const maxGraphTraversalDepth = 8
const maxGraphNeighbors = 100

var allowedGraphRelations = map[string]struct{}{
	"BELONGS_TO":        {},
	"HAS_VIOLATION":     {},
	"APPLIES_TO_SECTOR": {},
	"FILED_AGAINST":     {},
	"SECTOR_PEER":       {},
}

type falkorNodeView struct {
	ID         string                 `json:"id"`
	Labels     []string               `json:"labels"`
	Properties map[string]interface{} `json:"properties"`
}

func graphNodeView(value interface{}) (falkorNodeView, error) {
	node, ok := value.(*falkordb.Node)
	if !ok || node == nil {
		return falkorNodeView{}, fmt.Errorf("FalkorDB returned an unexpected node value")
	}
	identifier, ok := node.Properties["id"].(string)
	if !ok || strings.TrimSpace(identifier) == "" {
		return falkorNodeView{}, fmt.Errorf("FalkorDB node is missing its stable id property")
	}
	return falkorNodeView{ID: identifier, Labels: node.Labels, Properties: node.Properties}, nil
}

func validateGraphRelation(relation string) error {
	if relation == "" {
		return nil
	}
	if _, ok := allowedGraphRelations[relation]; !ok {
		return fmt.Errorf("unsupported graph relationship %q", relation)
	}
	return nil
}

func neighborQuery(nodeID, relation string) (string, map[string]interface{}, error) {
	if strings.TrimSpace(nodeID) == "" {
		return "", nil, fmt.Errorf("node_id is required")
	}
	if err := validateGraphRelation(relation); err != nil {
		return "", nil, err
	}
	const cypher = `MATCH (source {id: $node_id})-[edge]-(neighbor)
WHERE $relation = '' OR type(edge) = $relation
RETURN DISTINCT neighbor
LIMIT $limit`
	return cypher, map[string]interface{}{"node_id": nodeID, "relation": relation, "limit": maxGraphNeighbors}, nil
}

func (a *FalkorAdapter) neighbors(nodeID, relation string) ([]falkorNodeView, error) {
	cypher, params, err := neighborQuery(nodeID, relation)
	if err != nil {
		return nil, err
	}
	result, err := a.readOnlyQuery(cypher, params)
	if err != nil {
		return nil, err
	}
	neighbors := make([]falkorNodeView, 0)
	for result.Next() {
		value, err := result.Record().GetByIndex(0)
		if err != nil {
			return nil, fmt.Errorf("read FalkorDB neighbor record: %w", err)
		}
		view, err := graphNodeView(value)
		if err != nil {
			return nil, err
		}
		neighbors = append(neighbors, view)
	}
	return neighbors, nil
}

func boundedPathQuery(fromID, toID string, maxDepth int) (string, map[string]interface{}, error) {
	if strings.TrimSpace(fromID) == "" || strings.TrimSpace(toID) == "" {
		return "", nil, fmt.Errorf("from_id and to_id are required")
	}
	if maxDepth <= 0 {
		maxDepth = 5
	}
	if maxDepth > maxGraphTraversalDepth {
		return "", nil, fmt.Errorf("max_depth must be between 1 and %d", maxGraphTraversalDepth)
	}
	// Cypher does not parameterize variable-length relationship bounds. maxDepth is
	// validated before interpolation; all externally supplied identifiers remain
	// parameters and cannot change the query structure.
	cypher := fmt.Sprintf(`MATCH path = shortestPath((source {id: $from_id})-[*1..%d]-(target {id: $to_id}))
RETURN [node IN nodes(path) | node.id] AS path`, maxDepth)
	return cypher, map[string]interface{}{"from_id": fromID, "to_id": toID}, nil
}

func (a *FalkorAdapter) boundedPath(fromID, toID string, maxDepth int) ([]string, error) {
	cypher, params, err := boundedPathQuery(fromID, toID, maxDepth)
	if err != nil {
		return nil, err
	}
	result, err := a.readOnlyQuery(cypher, params)
	if err != nil {
		return nil, err
	}
	if !result.Next() {
		return []string{}, nil
	}
	value, err := result.Record().GetByIndex(0)
	if err != nil {
		return nil, fmt.Errorf("read FalkorDB path record: %w", err)
	}
	rawPath, ok := value.([]interface{})
	if !ok {
		return nil, fmt.Errorf("FalkorDB returned an unexpected path value")
	}
	path := make([]string, 0, len(rawPath))
	for _, entry := range rawPath {
		id, ok := entry.(string)
		if !ok || strings.TrimSpace(id) == "" {
			return nil, fmt.Errorf("FalkorDB path contains an invalid node id")
		}
		path = append(path, id)
	}
	return path, nil
}
