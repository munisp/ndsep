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
