package main

import (
	"strings"
	"testing"
)

func TestNeighborQueryUsesParametersAndAllowList(t *testing.T) {
	cypher, params, err := neighborQuery("org:42", "HAS_VIOLATION")
	if err != nil {
		t.Fatalf("expected valid neighbor query: %v", err)
	}
	if !strings.Contains(cypher, "$node_id") || !strings.Contains(cypher, "$relation") || !strings.Contains(cypher, "LIMIT $limit") {
		t.Fatalf("neighbor query is not parameterized: %s", cypher)
	}
	if params["node_id"] != "org:42" || params["relation"] != "HAS_VIOLATION" || params["limit"] != maxGraphNeighbors {
		t.Fatalf("unexpected neighbor parameters: %#v", params)
	}
	if _, _, err := neighborQuery("org:42", "HAS_VIOLATION; MATCH (n)"); err == nil {
		t.Fatal("expected an unsupported relationship to be rejected")
	}
	if _, _, err := neighborQuery("", ""); err == nil {
		t.Fatal("expected an empty node ID to be rejected")
	}
}

func TestBoundedPathQueryCapsDepthAndParameters(t *testing.T) {
	cypher, params, err := boundedPathQuery("org:1", "violation:2", 3)
	if err != nil {
		t.Fatalf("expected valid bounded path query: %v", err)
	}
	if !strings.Contains(cypher, "[*1..3]") {
		t.Fatalf("expected validated path depth in query: %s", cypher)
	}
	if strings.Contains(cypher, "org:1") || strings.Contains(cypher, "violation:2") {
		t.Fatalf("node identifiers must remain parameters: %s", cypher)
	}
	if params["from_id"] != "org:1" || params["to_id"] != "violation:2" {
		t.Fatalf("unexpected path parameters: %#v", params)
	}
	defaultQuery, _, err := boundedPathQuery("org:1", "violation:2", 0)
	if err != nil || !strings.Contains(defaultQuery, "[*1..5]") {
		t.Fatalf("expected default bounded depth: query=%s err=%v", defaultQuery, err)
	}
	if _, _, err := boundedPathQuery("org:1", "violation:2", maxGraphTraversalDepth+1); err == nil {
		t.Fatal("expected excessive path depth to be rejected")
	}
	if _, _, err := boundedPathQuery("", "violation:2", 1); err == nil {
		t.Fatal("expected missing path endpoint to be rejected")
	}
}

func TestNilAdapterCannotServeGraphData(t *testing.T) {
	var adapter *FalkorAdapter
	if _, err := adapter.neighbors("org:1", ""); err == nil {
		t.Fatal("expected nil adapter neighbor query to fail")
	}
	if _, err := adapter.boundedPath("org:1", "violation:2", 2); err == nil {
		t.Fatal("expected nil adapter path query to fail")
	}
}
