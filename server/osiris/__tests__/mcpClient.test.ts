/**
 * mcpClient unit tests (round 13, W5 / P1.6).
 *
 * Network is stubbed via an injected fetchFn. Covers the fail-closed MCP
 * protocol contract: initialize handshake, tools/list discovery (absence
 * tolerated), tools/call, id-mismatch / JSON-RPC-error / HTTP-error /
 * SSE-framed / unparseable-response handling. NOTHING here may throw.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  openMcpSession,
  callMcpTool,
  mcpRpc,
  parseMcpPayload,
  oiKeyPresent,
} from "../mcpClient";

function jsonResponse(status: number, body: unknown, contentType = "application/json") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
}

function rpcResult(id: number, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

beforeEach(() => {
  process.env.OSIRIS_URL = "https://osiris.test";
  delete process.env.OSIRIS_OI_KEY;
});

describe("parseMcpPayload", () => {
  it("parses plain JSON bodies", () => {
    expect(parseMcpPayload("application/json", '{"jsonrpc":"2.0","id":1,"result":{}}')).toMatchObject({ id: 1 });
  });

  it("parses SSE-framed responses (last data frame wins)", () => {
    const body =
      'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"a":1}}\n\n' +
      'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"a":2}}\n\n';
    expect(parseMcpPayload("text/event-stream", body)).toMatchObject({ result: { a: 2 } });
  });

  it("returns null on garbage", () => {
    expect(parseMcpPayload("application/json", "not json")).toBeNull();
    expect(parseMcpPayload("text/event-stream", "event: x\n\n")).toBeNull();
  });
});

describe("mcpRpc — protocol deviations fail closed", () => {
  it("returns the result object on a well-formed response", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: any) => {
      const req = JSON.parse(init.body);
      return jsonResponse(200, rpcResult(req.id, { ok: true })) as any;
    });
    const res = await mcpRpc("tools/list", {}, 1000, fetchFn as any);
    expect(res).toEqual({ ok: true, value: { ok: true } });
  });

  it("rejects id mismatch (possible response confusion)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, rpcResult(999, {})) as any);
    const res = await mcpRpc("tools/list", {}, 1000, fetchFn as any);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/id mismatch/);
  });

  it("surfaces JSON-RPC error objects", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: any) => {
      const req = JSON.parse(init.body);
      return jsonResponse(200, { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "Method not found" } }) as any;
    });
    const res = await mcpRpc("bogus", {}, 1000, fetchFn as any);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/-32601/);
  });

  it("fails closed on non-2xx", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(503, { error: "down" }) as any);
    const res = await mcpRpc("tools/list", {}, 1000, fetchFn as any);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/HTTP 503/);
  });

  it("fails closed on network error and timeout (never throws)", async () => {
    const netFail = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const r1 = await mcpRpc("initialize", {}, 1000, netFail as any);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toMatch(/network error/);

    const timeout = vi.fn(async () => { throw new Error("AbortError: The operation was aborted due to timeout"); });
    const r2 = await mcpRpc("initialize", {}, 1000, timeout as any);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toMatch(/timeout/);
  });

  it("fails closed on unparseable bodies", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, "<html>oops</html>") as any);
    const res = await mcpRpc("tools/list", {}, 1000, fetchFn as any);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/unparseable/);
  });

  it("sends Authorization Bearer ONLY from server-side env", async () => {
    process.env.OSIRIS_OI_KEY = "secret-oi-key";
    const fetchFn = vi.fn(async (_url: string, init?: any) => {
      const req = JSON.parse(init.body);
      return jsonResponse(200, rpcResult(req.id, {})) as any;
    });
    await mcpRpc("tools/list", {}, 1000, fetchFn as any);
    const init = (fetchFn.mock.calls[0] as any[])[1];
    expect(init.headers.Authorization).toBe("Bearer secret-oi-key");
  });
});

describe("openMcpSession — handshake + discovery", () => {
  it("initializes, notifies, and discovers tools", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: any) => {
      const req = JSON.parse(init.body);
      if (req.method === "initialize") {
        return jsonResponse(200, rpcResult(req.id, {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "osiris", version: "1.0" },
        }));
      }
      if (req.method === "notifications/initialized") return jsonResponse(200, "");
      if (req.method === "tools/list") {
        return jsonResponse(200, rpcResult(req.id, {
          tools: [
            { name: "run_forecast", description: "Run an OI forecast", inputSchema: { type: "object" } },
            { name: "get_forecast" },
          ],
        }));
      }
      throw new Error(`unexpected method ${req.method}`);
    }) as any;

    const session = await openMcpSession(1000, fetchFn);
    expect(session.ok).toBe(true);
    if (session.ok) {
      expect(session.value.protocolVersion).toBe("2024-11-05");
      expect(session.value.serverInfo?.name).toBe("osiris");
      expect(session.value.tools.map((t) => t.name)).toEqual(["run_forecast", "get_forecast"]);
    }
    // initialize + notification + tools/list
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("tolerates a server with zero tools", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: any) => {
      const req = JSON.parse(init.body);
      if (req.method === "initialize") return jsonResponse(200, rpcResult(req.id, { protocolVersion: "2024-11-05" }));
      if (req.method === "tools/list") return jsonResponse(200, rpcResult(req.id, { tools: [] }));
      return jsonResponse(200, "");
    }) as any;
    const session = await openMcpSession(1000, fetchFn);
    expect(session.ok).toBe(true);
    if (session.ok) expect(session.value.tools).toEqual([]);
  });

  it("fails closed when initialize deviates", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { jsonrpc: "2.0", id: 42, result: {} }) as any);
    const session = await openMcpSession(1000, fetchFn as any);
    expect(session.ok).toBe(false);
    if (!session.ok) expect(session.reason).toMatch(/initialize failed/);
  });
});

describe("callMcpTool", () => {
  it("returns content blocks and structured content", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: any) => {
      const req = JSON.parse(init.body);
      return jsonResponse(200, rpcResult(req.id, {
        content: [{ type: "text", text: '{"probability":0.42}' }],
        structuredContent: { probability: 0.42 },
      }));
    }) as any;
    const res = await callMcpTool("run_forecast", { question: "q" }, 1000, fetchFn);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.isError).toBe(false);
      expect(res.value.structured).toEqual({ probability: 0.42 });
      expect(res.value.content[0]).toMatchObject({ type: "text" });
    }
    // arguments passed through
    const sent = JSON.parse(((fetchFn.mock.calls[0] as any[])[1]).body);
    expect(sent.method).toBe("tools/call");
    expect(sent.params).toEqual({ name: "run_forecast", arguments: { question: "q" } });
  });

  it("flags tool-level errors via isError (protocol still ok)", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: any) => {
      const req = JSON.parse(init.body);
      return jsonResponse(200, rpcResult(req.id, { isError: true, content: [{ type: "text", text: "boom" }] }));
    }) as any;
    const res = await callMcpTool("run_forecast", {}, 1000, fetchFn);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.isError).toBe(true);
  });
});

describe("oiKeyPresent", () => {
  it("reflects env at call time", () => {
    expect(oiKeyPresent()).toBe(false);
    process.env.OSIRIS_OI_KEY = "k";
    expect(oiKeyPresent()).toBe(true);
    process.env.OSIRIS_OI_KEY = "   ";
    expect(oiKeyPresent()).toBe(false);
  });
});
