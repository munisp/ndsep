#!/usr/bin/env python3
"""
NDSEP OpenSearch Query Service — Python
Port 8166 | Full-text search, compliance event queries, analytics aggregations
Implements: multi-index search, faceted search, date-range queries, sector filtering
"""

import os
import json
import time
import logging
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import urlopen, Request
from urllib.error import URLError
from collections import defaultdict

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] [opensearch-query] %(message)s')
logger = logging.getLogger(__name__)

PORT = int(os.getenv("OPENSEARCH_QUERY_PORT", "8166"))
OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://localhost:9200")
OPENSEARCH_USER = os.getenv("OPENSEARCH_USER", "admin")
OPENSEARCH_PASS = os.getenv("OPENSEARCH_PASS", "")

# NDSEP OpenSearch indices
NDSEP_INDICES = {
    "compliance_events": "ndsep_compliance_events",
    "aml_cases": "ndsep_aml_cases",
    "kyc_records": "ndsep_kyc_records",
    "fines": "ndsep_fines_and_penalties",
    "accreditation": "ndsep_accreditation_history",
    "watchlist": "ndsep_watchlist_hits",
    "audit": "ndsep_audit_trail",
    "breach": "ndsep_breach_notifications",
    "alerts": "ndsep_cross_agency_alerts",
    "transactions": "ndsep_financial_transactions",
    "sector_metrics": "ndsep_sector_metrics",
    "reports": "ndsep_regulatory_reports",
}

metrics = {
    "searches": 0,
    "aggregations": 0,
    "errors": 0,
    "start_time": time.time(),
    "by_index": defaultdict(int),
}


def opensearch_request(method: str, path: str, body: dict = None) -> dict:
    import base64
    url = f"{OPENSEARCH_URL}{path}"
    data = json.dumps(body).encode() if body else None
    req = Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    creds = base64.b64encode(f"{OPENSEARCH_USER}:{OPENSEARCH_PASS}".encode()).decode()
    req.add_header("Authorization", f"Basic {creds}")
    try:
        with urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except URLError as e:
        logger.warning(f"OpenSearch not available: {e}")
        return {"degraded": True, "error": str(e), "hits": {"hits": [], "total": {"value": 0}}}
    except Exception as e:
        metrics["errors"] += 1
        return {"error": str(e), "hits": {"hits": [], "total": {"value": 0}}}


def build_query(params: dict) -> dict:
    """Build OpenSearch query from search parameters"""
    must = []
    filter_clauses = []

    if q := params.get("q"):
        must.append({"multi_match": {"query": q, "fields": ["*"], "type": "best_fields"}})

    if sector := params.get("sector"):
        filter_clauses.append({"term": {"sector.keyword": sector}})

    if status := params.get("status"):
        filter_clauses.append({"term": {"status.keyword": status}})

    if from_date := params.get("from_date"):
        date_range = {"gte": from_date}
        if to_date := params.get("to_date"):
            date_range["lte"] = to_date
        filter_clauses.append({"range": {"created_at": date_range}})

    query = {"bool": {}}
    if must:
        query["bool"]["must"] = must
    if filter_clauses:
        query["bool"]["filter"] = filter_clauses
    if not must and not filter_clauses:
        query = {"match_all": {}}

    return {
        "query": query,
        "size": params.get("size", 20),
        "from": params.get("from", 0),
        "sort": [{"created_at": {"order": "desc"}}] if not params.get("q") else [],
        "highlight": {"fields": {"*": {}}} if params.get("q") else {},
    }


def search(index_key: str, params: dict) -> dict:
    index = NDSEP_INDICES.get(index_key, index_key)
    query = build_query(params)
    result = opensearch_request("POST", f"/{index}/_search", query)
    metrics["searches"] += 1
    metrics["by_index"][index_key] += 1
    return result


def aggregate(index_key: str, params: dict) -> dict:
    index = NDSEP_INDICES.get(index_key, index_key)
    agg_field = params.get("field", "sector")
    result = opensearch_request("POST", f"/{index}/_search", {
        "size": 0,
        "aggs": {
            "by_field": {
                "terms": {"field": f"{agg_field}.keyword", "size": 50}
            },
            "over_time": {
                "date_histogram": {
                    "field": "created_at",
                    "calendar_interval": params.get("interval", "month"),
                }
            }
        }
    })
    metrics["aggregations"] += 1
    return result


def global_search(q: str, sectors: list = None, limit: int = 20) -> dict:
    """Search across all NDSEP indices"""
    indices = ",".join(NDSEP_INDICES.values())
    query = {
        "query": {
            "bool": {
                "must": [{"multi_match": {"query": q, "fields": ["*"], "fuzziness": "AUTO"}}],
                "filter": [{"terms": {"sector.keyword": sectors}}] if sectors else [],
            }
        },
        "size": limit,
        "highlight": {"fields": {"*": {}}},
    }
    result = opensearch_request("POST", f"/{indices}/_search", query)
    metrics["searches"] += 1
    return result


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_json(self, data: dict, status: int = 200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def do_GET(self):
        if self.path == "/health":
            self.send_json({
                "status": "healthy",
                "service": "ndsep-opensearch-query",
                "version": "1.0.0",
                "uptime": time.time() - metrics["start_time"],
                "opensearch_url": OPENSEARCH_URL,
                "indices": list(NDSEP_INDICES.keys()),
            })
        elif self.path == "/indices":
            self.send_json({"indices": NDSEP_INDICES})
        elif self.path == "/metrics":
            lines = [
                f"ndsep_opensearch_searches_total {metrics['searches']}",
                f"ndsep_opensearch_aggregations_total {metrics['aggregations']}",
                f"ndsep_opensearch_errors_total {metrics['errors']}",
            ]
            for idx, count in metrics["by_index"].items():
                lines.append(f"ndsep_opensearch_index_{idx}_searches_total {count}")
            body = "\n".join(lines).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        body = self.read_body()
        if self.path == "/search":
            index = body.pop("index", "compliance_events")
            result = search(index, body)
            self.send_json({"success": True, "index": index, "result": result})
        elif self.path == "/search/global":
            q = body.get("q", "")
            sectors = body.get("sectors")
            limit = body.get("limit", 20)
            result = global_search(q, sectors, limit)
            self.send_json({"success": True, "query": q, "result": result})
        elif self.path == "/aggregate":
            index = body.pop("index", "compliance_events")
            result = aggregate(index, body)
            self.send_json({"success": True, "index": index, "result": result})
        else:
            self.send_json({"error": "not found"}, 404)


if __name__ == "__main__":
    logger.info(f"NDSEP OpenSearch Query Service starting on port {PORT}")
    logger.info(f"OpenSearch URL: {OPENSEARCH_URL} | Indices: {len(NDSEP_INDICES)}")
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
