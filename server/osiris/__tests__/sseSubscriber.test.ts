/**
 * sseSubscriber + snapshotStore unit tests (round 13, W5 / P1.7).
 *
 * Covers: incremental SSE frame parsing (multi-line data, CRLF, comments,
 * ids), event routing into the snapshot store (unknown events tolerated,
 * bad JSON never overwrites), staleness flagging, reconnect backoff, and a
 * live loop test with a mocked fetch streaming real events then closing —
 * verifying Last-Event-ID is sent on reconnect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  createSseParser,
  handleStreamEvent,
  nextBackoffMs,
  getIntelStreamHealth,
  startOsirisStream,
  stopOsirisStream,
  __resetStreamHealth,
  type SseEvent,
} from "../sseSubscriber";
import {
  getSanctionsSnapshot,
  getThreatSnapshot,
  __clearSnapshots,
} from "../snapshotStore";

beforeEach(() => {
  __clearSnapshots();
  __resetStreamHealth();
  process.env.OSIRIS_URL = "https://osiris.test";
  delete process.env.OSIRIS_SSE_PATH;
});

afterEach(async () => {
  await stopOsirisStream();
  __resetStreamHealth();
  __clearSnapshots();
});

describe("createSseParser", () => {
  it("parses events with event/data/id fields across chunk boundaries", () => {
    const events: SseEvent[] = [];
    const p = createSseParser((e) => events.push(e));
    p.push('event: sanctions-update\nid: 41\ndata: {"a"');
    expect(events).toHaveLength(0); // not dispatched until blank line
    p.push(': 1}\n\n');
    expect(events).toEqual([{ event: "sanctions-update", data: '{"a": 1}', id: "41" }]);
  });

  it("joins multi-line data and tolerates comments + CRLF", () => {
    const events: SseEvent[] = [];
    const p = createSseParser((e) => events.push(e));
    p.push(": keep-alive\r\nevent: threat-update\r\ndata: line1\r\ndata: line2\r\n\r\n");
    expect(events).toEqual([{ event: "threat-update", data: "line1\nline2", id: null }]);
  });

  it("defaults to event type 'message'", () => {
    const events: SseEvent[] = [];
    const p = createSseParser((e) => events.push(e));
    p.push("data: hello\n\n");
    expect(events[0].event).toBe("message");
  });
});

describe("handleStreamEvent → snapshotStore", () => {
  it("stores sanctions and threat snapshots with event ids", () => {
    handleStreamEvent({ event: "sanctions-update", data: '{"results":[1,2]}', id: "7" });
    handleStreamEvent({ event: "threat-update", data: '{"threats":["x"]}', id: "8" });
    const s = getSanctionsSnapshot()!;
    expect(s.data).toEqual({ results: [1, 2] });
    expect(s.eventId).toBe("7");
    expect(s.stale).toBe(false);
    expect(getThreatSnapshot()!.data).toEqual({ threats: ["x"] });
    expect(getIntelStreamHealth().lastEventId).toBe("8");
  });

  it("tolerates unknown event types (counted, not fatal)", () => {
    handleStreamEvent({ event: "dns-update", data: "{}", id: null });
    handleStreamEvent({ event: "sanctions-update", data: '{"ok":true}', id: null });
    expect(getIntelStreamHealth().unknownEventCount).toBe(1);
    expect(getSanctionsSnapshot()!.data).toEqual({ ok: true });
  });

  it("never overwrites a good snapshot with unparseable JSON", () => {
    handleStreamEvent({ event: "sanctions-update", data: '{"good":1}', id: "1" });
    handleStreamEvent({ event: "sanctions-update", data: "{broken", id: "2" });
    expect(getSanctionsSnapshot()!.data).toEqual({ good: 1 });
    expect(getSanctionsSnapshot()!.eventId).toBe("1");
  });

  it("flags snapshots older than the stale threshold", () => {
    handleStreamEvent({ event: "threat-update", data: "{}", id: null });
    const fresh = getThreatSnapshot()!;
    expect(fresh.stale).toBe(false);
    const later = getThreatSnapshot(Date.now() + 31 * 60 * 1000)!;
    expect(later.stale).toBe(true);
  });

  it("returns null when nothing has arrived", () => {
    expect(getSanctionsSnapshot()).toBeNull();
    expect(getThreatSnapshot()).toBeNull();
  });
});

describe("nextBackoffMs", () => {
  it("doubles from 1s and caps at 30s", () => {
    expect(nextBackoffMs(0)).toBe(1_000);
    expect(nextBackoffMs(1_000)).toBe(2_000);
    expect(nextBackoffMs(8_000)).toBe(16_000);
    expect(nextBackoffMs(16_000)).toBe(30_000);
    expect(nextBackoffMs(30_000)).toBe(30_000);
  });
});

// ─── Live loop with mocked fetch ─────────────────────────────────────────────

function streamResponse(chunks: string[], status = 200) {
  const encoded = chunks.map((c) => new TextEncoder().encode(c));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of encoded) controller.enqueue(c);
      controller.close();
    },
  });
  return { status, ok: status >= 200 && status < 300, body } as unknown as Response;
}

async function waitFor(cond: () => boolean, ms = 4_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("startOsirisStream loop", () => {
  it("consumes events, updates snapshots, reconnects with Last-Event-ID", async () => {
    const seenHeaders: Record<string, string>[] = [];
    let calls = 0;
    const fetchFn = vi.fn(async (_url: string, init?: any) => {
      calls++;
      seenHeaders.push({ ...(init?.headers ?? {}) });
      if (calls === 1) {
        return streamResponse([
          'id: 100\nevent: sanctions-update\ndata: {"results":["sdn-1"]}\n\n',
          'id: 101\nevent: threat-update\ndata: {"threats":["CVE-1"]}\n\n',
        ]);
      }
      // second connection: hang until stopped (simulates a live stream)
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("AbortError: stopped")));
      });
    }) as any;

    startOsirisStream({ fetchFn });
    await waitFor(() => getSanctionsSnapshot() !== null && getThreatSnapshot() !== null);

    expect(getSanctionsSnapshot()!.data).toEqual({ results: ["sdn-1"] });
    expect(getThreatSnapshot()!.data).toEqual({ threats: ["CVE-1"] });

    // after clean EOF the loop reconnects and resumes from lastEventId
    await waitFor(() => calls >= 2);
    expect(seenHeaders[0]["Last-Event-ID"]).toBeUndefined();
    expect(seenHeaders[1]["Last-Event-ID"]).toBe("101");

    const health = getIntelStreamHealth();
    expect(health.running).toBe(true);
    expect(health.lastEventId).toBe("101");
    expect(health.endpoint).toBe("https://osiris.test/api/osint/stream");

    await stopOsirisStream();
    expect(getIntelStreamHealth().running).toBe(false);
  });

  it("records errors and reconnects after failures", async () => {
    let calls = 0;
    const fetchFn = vi.fn(async (_url: string, init?: any) => {
      calls++;
      if (calls === 1) throw new Error("ECONNREFUSED");
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("AbortError: stopped")));
      });
    }) as any;

    startOsirisStream({ fetchFn });
    await waitFor(() => getIntelStreamHealth().lastError !== null);
    expect(getIntelStreamHealth().lastError).toMatch(/ECONNREFUSED/);
    await waitFor(() => calls >= 2, 8_000); // backoff ~1s then retry
    expect(getIntelStreamHealth().reconnectCount).toBeGreaterThanOrEqual(1);
    await stopOsirisStream();
  });

  it("honours OSIRIS_SSE_PATH override", async () => {
    process.env.OSIRIS_SSE_PATH = "/api/sse";
    const fetchFn = vi.fn(async (url: string, init?: any) => {
      expect(url).toBe("https://osiris.test/api/sse");
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("AbortError: stopped")));
      });
    }) as any;
    startOsirisStream({ fetchFn });
    await waitFor(() => fetchFn.mock.calls.length >= 1);
    await stopOsirisStream();
  });
});
