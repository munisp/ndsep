import { describe, expect, it } from "vitest";
import { prometheusMetrics, recordHttpRequest } from "../server/observability";
describe("operational metrics", () => { it("exports configuration readiness and bounded request metrics", () => { recordHttpRequest("GET", "/healthz", 200); const metrics = prometheusMetrics({ ok: false }); expect(metrics).toContain("idlr_pts_runtime_ready 0"); expect(metrics).toContain('route="/healthz"'); }); });
