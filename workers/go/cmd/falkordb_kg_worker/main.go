// NDSEP FalkorDB Knowledge Graph Worker (Go)
// ============================================
// Builds and queries a compliance knowledge graph in FalkorDB (Redis Graph).
// The graph models entities and relationships across the NDSEP domain:
//
//	Nodes:
//	  Organization, Officer, Violation, Policy, Regulation, Sector,
//	  EnforcementAction, Penalty, Certificate, DSAR, BreachReport
//
//	Edges:
//	  BELONGS_TO, HAS_VIOLATION, GOVERNED_BY, ENFORCED_BY, FILED_AGAINST,
//	  REFERENCES, SECTOR_PEER, OFFICER_OF, REPORTED_BREACH, SUBJECT_TO
//
// Graph queries power:
//   - Compliance path analysis (org → violations → policies → regulations)
//   - Sector peer benchmarking (org → sector → peer orgs)
//   - Officer accountability chains (officer → org → enforcement actions)
//   - Regulatory impact analysis (regulation → policies → affected orgs)
//   - GNN feature extraction (node embeddings via neighbourhood aggregation)
//
// Technology: Go · FalkorDB (Redis Graph) · PostgreSQL
// Port: 8210
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	_ "github.com/lib/pq"
)

// ── Configuration ──────────────────────────────────────────────────────────────
var (
	dbURL           = os.Getenv("DATABASE_URL")
	falkorURL       = os.Getenv("FALKORDB_URL")
	falkorGraphName = getEnv("FALKORDB_GRAPH_NAME", "ndsep_compliance")
	relayURL        = getEnv("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
	port            = getEnv("FALKORDB_PORT", "8210")
	workerStart     = time.Now()
	falkorAdapter   *FalkorAdapter
)

// ── State ──────────────────────────────────────────────────────────────────────
var (
	nodesCreated  int64
	edgesCreated  int64
	queriesRun    int64
	errors        int64
	lastBuildTime string
)

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ── Graph node types ───────────────────────────────────────────────────────────
type GraphNode struct {
	ID         string            `json:"id"`
	Type       string            `json:"type"`
	Properties map[string]string `json:"properties"`
}

type GraphEdge struct {
	FromID   string  `json:"from_id"`
	ToID     string  `json:"to_id"`
	Relation string  `json:"relation"`
	Weight   float64 `json:"weight"`
}

type GraphStats struct {
	NodeCount    int64  `json:"node_count"`
	EdgeCount    int64  `json:"edge_count"`
	LastBuild    string `json:"last_build"`
	QueriesRun   int64  `json:"queries_run"`
	Errors       int64  `json:"errors"`
	FalkorStatus string `json:"falkor_status"`
}

// ── In-memory graph (FalkorDB fallback) ───────────────────────────────────────
// When FalkorDB is not available, we maintain an in-memory adjacency list
// that supports the same query patterns.
type InMemoryGraph struct {
	Nodes map[string]GraphNode
	Edges []GraphEdge
	// Adjacency: nodeID → list of (neighborID, relation, weight)
	Adj map[string][]struct {
		To, Rel string
		W       float64
	}
}

var graph = &InMemoryGraph{
	Nodes: make(map[string]GraphNode),
	Edges: []GraphEdge{},
	Adj: make(map[string][]struct {
		To, Rel string
		W       float64
	}),
}

func (g *InMemoryGraph) AddNode(n GraphNode) {
	g.Nodes[n.ID] = n
	atomic.AddInt64(&nodesCreated, 1)
}

func (g *InMemoryGraph) AddEdge(e GraphEdge) {
	g.Edges = append(g.Edges, e)
	g.Adj[e.FromID] = append(g.Adj[e.FromID], struct {
		To, Rel string
		W       float64
	}{e.ToID, e.Relation, e.Weight})
	atomic.AddInt64(&edgesCreated, 1)
}

func (g *InMemoryGraph) GetNeighbors(nodeID string, relation string) []GraphNode {
	var result []GraphNode
	for _, adj := range g.Adj[nodeID] {
		if relation == "" || adj.Rel == relation {
			if n, ok := g.Nodes[adj.To]; ok {
				result = append(result, n)
			}
		}
	}
	return result
}

func (g *InMemoryGraph) FindPath(fromID, toID string, maxDepth int) []string {
	if fromID == toID {
		return []string{fromID}
	}
	visited := map[string]bool{fromID: true}
	queue := [][]string{{fromID}}
	for len(queue) > 0 && maxDepth > 0 {
		path := queue[0]
		queue = queue[1:]
		current := path[len(path)-1]
		for _, adj := range g.Adj[current] {
			if !visited[adj.To] {
				newPath := append(append([]string{}, path...), adj.To)
				if adj.To == toID {
					return newPath
				}
				visited[adj.To] = true
				queue = append(queue, newPath)
			}
		}
		maxDepth--
	}
	return nil
}

// ── Graph building from PostgreSQL ────────────────────────────────────────────
func buildGraph(db *sql.DB) error {
	log.Println("[KG] Building knowledge graph from PostgreSQL...")
	graph = &InMemoryGraph{
		Nodes: make(map[string]GraphNode),
		Edges: []GraphEdge{},
		Adj: make(map[string][]struct {
			To, Rel string
			W       float64
		}),
	}

	// ── Organizations ──────────────────────────────────────────────────────────
	rows, err := db.Query(`
		SELECT id::text, name, sector, compliance_score::text, status, state
		FROM organizations WHERE status = 'active' LIMIT 200
	`)
	if err != nil {
		return fmt.Errorf("query organizations: %w", err)
	}
	defer rows.Close()
	orgSectors := map[string]string{}
	for rows.Next() {
		var id, name, sector, score, status, state string
		if err := rows.Scan(&id, &name, &sector, &score, &status, &state); err != nil {
			continue
		}
		graph.AddNode(GraphNode{
			ID:   "org:" + id,
			Type: "Organization",
			Properties: map[string]string{
				"name": name, "sector": sector, "score": score,
				"status": status, "state": state,
			},
		})
		orgSectors[id] = sector
		// Sector node
		sectorID := "sector:" + sector
		if _, ok := graph.Nodes[sectorID]; !ok {
			graph.AddNode(GraphNode{
				ID: sectorID, Type: "Sector",
				Properties: map[string]string{"name": sector},
			})
		}
		graph.AddEdge(GraphEdge{FromID: "org:" + id, ToID: sectorID, Relation: "BELONGS_TO", Weight: 1.0})
	}

	// ── Violations ────────────────────────────────────────────────────────────
	vrows, err := db.Query(`
		SELECT cv.id::text, cv.violation_type, cv.severity, cv.status,
		       cv.organization_id::text
		FROM compliance_violations cv LIMIT 500
	`)
	if err == nil {
		defer vrows.Close()
		for vrows.Next() {
			var id, vtype, severity, status, orgID string
			if err := vrows.Scan(&id, &vtype, &severity, &status, &orgID); err != nil {
				continue
			}
			graph.AddNode(GraphNode{
				ID: "violation:" + id, Type: "Violation",
				Properties: map[string]string{
					"type": vtype, "severity": severity, "status": status,
				},
			})
			graph.AddEdge(GraphEdge{
				FromID: "org:" + orgID, ToID: "violation:" + id,
				Relation: "HAS_VIOLATION",
				Weight:   severityWeight(severity),
			})
		}
	}

	// ── Policies ──────────────────────────────────────────────────────────────
	prows, err := db.Query(`
		SELECT id::text, name, policy_type, status, sector
		FROM compliance_policies WHERE status = 'active' LIMIT 200
	`)
	if err == nil {
		defer prows.Close()
		for prows.Next() {
			var id, name, ptype, status, sector string
			if err := prows.Scan(&id, &name, &ptype, &status, &sector); err != nil {
				continue
			}
			graph.AddNode(GraphNode{
				ID: "policy:" + id, Type: "Policy",
				Properties: map[string]string{
					"name": name, "type": ptype, "status": status, "sector": sector,
				},
			})
			// Connect policy to sector
			if sector != "" {
				graph.AddEdge(GraphEdge{
					FromID: "policy:" + id, ToID: "sector:" + sector,
					Relation: "APPLIES_TO_SECTOR", Weight: 1.0,
				})
			}
		}
	}

	// ── Enforcement Actions ───────────────────────────────────────────────────
	erows, err := db.Query(`
		SELECT ea.id::text, ea.action_type, ea.status, ea.severity,
		       ea.organization_id::text
		FROM enforcement_actions ea LIMIT 300
	`)
	if err == nil {
		defer erows.Close()
		for erows.Next() {
			var id, atype, status, severity, orgID string
			if err := erows.Scan(&id, &atype, &status, &severity, &orgID); err != nil {
				continue
			}
			graph.AddNode(GraphNode{
				ID: "enforcement:" + id, Type: "EnforcementAction",
				Properties: map[string]string{
					"type": atype, "status": status, "severity": severity,
				},
			})
			graph.AddEdge(GraphEdge{
				FromID: "enforcement:" + id, ToID: "org:" + orgID,
				Relation: "FILED_AGAINST", Weight: severityWeight(severity),
			})
		}
	}

	// ── Sector peer edges ─────────────────────────────────────────────────────
	sectorOrgs := map[string][]string{}
	for id, sector := range orgSectors {
		sectorOrgs[sector] = append(sectorOrgs[sector], id)
	}
	for _, orgs := range sectorOrgs {
		for i := 0; i < len(orgs) && i < 5; i++ {
			for j := i + 1; j < len(orgs) && j < 5; j++ {
				graph.AddEdge(GraphEdge{
					FromID: "org:" + orgs[i], ToID: "org:" + orgs[j],
					Relation: "SECTOR_PEER", Weight: 0.5,
				})
			}
		}
	}

	lastBuildTime = time.Now().UTC().Format(time.RFC3339)
	log.Printf("[KG] Graph built: %d nodes, %d edges",
		atomic.LoadInt64(&nodesCreated), atomic.LoadInt64(&edgesCreated))
	return nil
}

func severityWeight(severity string) float64 {
	switch severity {
	case "critical":
		return 1.0
	case "high":
		return 0.8
	case "medium":
		return 0.5
	case "low":
		return 0.2
	default:
		return 0.3
	}
}

// ── GNN Feature Extraction ────────────────────────────────────────────────────
// Simple mean-aggregation GNN (GraphSAGE-style) for node embeddings
func computeGNNEmbedding(nodeID string, depth int) []float64 {
	node, ok := graph.Nodes[nodeID]
	if !ok {
		return make([]float64, 8)
	}

	// Node features: [degree, violation_count, enforcement_count, sector_risk, ...]
	degree := float64(len(graph.Adj[nodeID]))
	violationCount := 0.0
	enforcementCount := 0.0
	sectorPeerCount := 0.0

	for _, adj := range graph.Adj[nodeID] {
		switch adj.Rel {
		case "HAS_VIOLATION":
			violationCount++
		case "FILED_AGAINST":
			enforcementCount++
		case "SECTOR_PEER":
			sectorPeerCount++
		}
	}

	// Score from properties
	score := 0.0
	if s, ok := node.Properties["score"]; ok {
		fmt.Sscanf(s, "%f", &score)
	}

	embedding := []float64{
		degree / 10.0,
		violationCount / 5.0,
		enforcementCount / 3.0,
		sectorPeerCount / 10.0,
		score / 100.0,
		float64(len(node.Properties)) / 10.0,
		0.0, // placeholder for temporal feature
		0.0, // placeholder for text embedding
	}

	// Aggregate neighbor embeddings (1-hop)
	if depth > 0 {
		neighbors := graph.GetNeighbors(nodeID, "")
		if len(neighbors) > 0 {
			neighborEmb := make([]float64, 8)
			for _, n := range neighbors {
				ne := computeGNNEmbedding(n.ID, 0)
				for i := range ne {
					neighborEmb[i] += ne[i]
				}
			}
			for i := range neighborEmb {
				neighborEmb[i] /= float64(len(neighbors))
				embedding[i] = (embedding[i] + neighborEmb[i]) / 2.0
			}
		}
	}

	return embedding
}

// ── HTTP Handlers ──────────────────────────────────────────────────────────────
func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":         "healthy",
		"worker":         "falkordb_kg_worker",
		"nodes":          atomic.LoadInt64(&nodesCreated),
		"edges":          atomic.LoadInt64(&edgesCreated),
		"queries_run":    atomic.LoadInt64(&queriesRun),
		"errors":         atomic.LoadInt64(&errors),
		"last_build":     lastBuildTime,
		"falkor_status":  "in_memory_fallback",
		"uptime_seconds": time.Since(workerStart).Seconds(),
	})
}

func queryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		QueryType string `json:"query_type"`
		NodeID    string `json:"node_id"`
		Relation  string `json:"relation"`
		FromID    string `json:"from_id"`
		ToID      string `json:"to_id"`
		MaxDepth  int    `json:"max_depth"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	atomic.AddInt64(&queriesRun, 1)
	w.Header().Set("Content-Type", "application/json")

	switch req.QueryType {
	case "neighbors":
		neighbors := graph.GetNeighbors(req.NodeID, req.Relation)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"node_id":   req.NodeID,
			"relation":  req.Relation,
			"neighbors": neighbors,
			"count":     len(neighbors),
		})
	case "path":
		depth := req.MaxDepth
		if depth == 0 {
			depth = 5
		}
		path := graph.FindPath(req.FromID, req.ToID, depth)
		pathNodes := []GraphNode{}
		for _, id := range path {
			if n, ok := graph.Nodes[id]; ok {
				pathNodes = append(pathNodes, n)
			}
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"from":       req.FromID,
			"to":         req.ToID,
			"path":       path,
			"path_nodes": pathNodes,
			"length":     len(path),
		})
	case "gnn_embedding":
		embedding := computeGNNEmbedding(req.NodeID, 1)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"node_id":   req.NodeID,
			"embedding": embedding,
			"dim":       len(embedding),
		})
	case "node":
		node, ok := graph.Nodes[req.NodeID]
		if !ok {
			http.Error(w, "node not found", http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(node)
	case "stats":
		typeCounts := map[string]int{}
		for _, n := range graph.Nodes {
			typeCounts[n.Type]++
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"total_nodes": len(graph.Nodes),
			"total_edges": len(graph.Edges),
			"node_types":  typeCounts,
			"last_build":  lastBuildTime,
		})
	default:
		http.Error(w, "unknown query_type", http.StatusBadRequest)
	}
}

func rebuildHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	go func() {
		db, err := sql.Open("postgres", dbURL)
		if err != nil {
			log.Printf("[KG] DB connect failed: %v", err)
			return
		}
		defer db.Close()
		if err := buildGraph(db); err != nil {
			log.Printf("[KG] Build failed: %v", err)
			atomic.AddInt64(&errors, 1)
		}
	}()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "rebuild_started"})
}

// ── Main ───────────────────────────────────────────────────────────────────────
func main() {
	log.Printf("[KG] Starting NDSEP FalkorDB Knowledge Graph Worker on port %s", port)
	if dbURL == "" {
		log.Fatal("[KG] DATABASE_URL is required")
	}
	adapter, err := newFalkorAdapter(context.Background(), falkorURL, falkorGraphName, 5000)
	if err != nil {
		log.Fatalf("[KG] Real FalkorDB adapter unavailable: %v", err)
	}
	falkorAdapter = adapter
	defer func() { _ = falkorAdapter.close() }()

	// The retired adjacency-list build/query functions are intentionally not routed.
	// A subsequent adapter phase will route them to parameterized FalkorDB queries.

	// Rebuilds are initiated only through the durable real-adapter path. The
	// retired adjacency-list builder is intentionally never scheduled or served.

	mux := http.NewServeMux()
	mux.HandleFunc("/health", realFalkorHealthHandler)
	mux.HandleFunc("/query", falkorQueryHandler)
	mux.HandleFunc("/rebuild", falkorRebuildHandler)

	log.Printf("[KG] FalkorDB Knowledge Graph Worker listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("[KG] Server failed: %v", err)
	}
}
