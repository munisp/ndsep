/**
 * Round-13 P2.8/P2.9 — OSIRIS disaster + maritime client tests.
 * fetch is fully mocked. Central invariants:
 *   - graceful null on network/HTTP failure (never throws, never fabricates)
 *   - tolerant narrowing: schema drift (renamed keys, numeric MMSI, string
 *     numbers, extra fields) is absorbed; malformed records are dropped
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchEarthquakes,
  fetchFires,
  fetchSevereWeather,
  _clearDisasterCache,
} from "../disasterClient";
import { fetchVesselsInArea, _clearMaritimeCache } from "../maritimeClient";

const fetchMock = vi.fn();

beforeEach(() => {
  _clearDisasterCache();
  _clearMaritimeCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("fetchEarthquakes", () => {
  it("narrows the assumed {events:[...]} shape", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      events: [{ id: "us7000", mag: 5.1, lat: 6.5, lng: 3.4, place: "Lagos offshore", ts: "2026-10-20" }],
    }));
    const out = await fetchEarthquakes();
    expect(out).toHaveLength(1);
    expect(out![0]).toMatchObject({ id: "us7000", mag: 5.1, lat: 6.5, lng: 3.4 });
  });

  it("tolerates drift: renamed keys, string numbers, extra fields; drops malformed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      results: [
        { event_id: "q1", magnitude: "4.8", latitude: "6.5", longitude: 3.4, title: "somewhere", time: "t", extra: { nested: true } },
        { id: "q2", mag: 5.0, lat: 999, lng: 3.4 },          // invalid lat -> dropped
        { id: "q3", lat: 6.5, lng: 3.4 },                     // missing mag -> dropped
        "garbage",                                            // non-object -> dropped
      ],
    }));
    const out = await fetchEarthquakes();
    expect(out).toHaveLength(1);
    expect(out![0]).toMatchObject({ id: "q1", mag: 4.8, place: "somewhere" });
  });

  it("returns null on HTTP error and on network failure (never throws)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
    expect(await fetchEarthquakes()).toBeNull();
    _clearDisasterCache();
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await fetchEarthquakes()).toBeNull();
  });
});

describe("fetchFires / fetchSevereWeather", () => {
  it("fires: synthesises an id when absent, keeps frp", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      hotspots: [{ latitude: 6.4, longitude: 3.4, frp: 130.5, acq_date: "2026-10-20" }],
    }));
    const out = await fetchFires();
    expect(out).toHaveLength(1);
    expect(out![0].frp).toBe(130.5);
    expect(out![0].id).toContain("firms:");
  });

  it("weather: keeps category as severity hint; null on failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      events: [{ id: "EONET_1", title: "Cyclone", category: "Severe Storms", lat: 5.0, lng: 4.0, ts: "t" }],
    }));
    const out = await fetchSevereWeather();
    expect(out![0]).toMatchObject({ id: "EONET_1", category: "Severe Storms" });
    _clearDisasterCache();
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect(await fetchSevereWeather()).toBeNull();
  });
});

describe("fetchVesselsInArea", () => {
  it("narrows vessels; numeric MMSI coerced to string; status lower-cased", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      vessels: [{ mmsi: 636091234, name: "MV LAGOS STAR", lat: 6.44, lng: 3.47, speed: "0.4", status: "Anchored", ts: "t" }],
    }));
    const out = await fetchVesselsInArea(6.44, 3.47, 2);
    expect(out).toHaveLength(1);
    expect(out![0]).toMatchObject({ mmsi: "636091234", speed: 0.4, status: "anchored" });
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("/api/maritime");
    expect(calledUrl).toContain("radius_km=2");
  });

  it("tolerates bare arrays + drifted keys; drops records without mmsi or coords", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([
      { id: "v1", latitude: 6.44, longitude: 3.47, sog: 12.1, nav_status: "Under Way" },
      { latitude: 6.44, longitude: 3.47 },                    // no identity -> dropped
      { mmsi: "v2", lat: null, lng: 3.47 },                   // bad coords -> dropped
    ]));
    const out = await fetchVesselsInArea(6.44, 3.47, 5);
    expect(out).toHaveLength(1);
    expect(out![0]).toMatchObject({ mmsi: "v1", speed: 12.1, status: "under way" });
  });

  it("returns null on failure and rejects invalid query params", async () => {
    fetchMock.mockRejectedValueOnce(new Error("DNS"));
    expect(await fetchVesselsInArea(6.44, 3.47, 2)).toBeNull();
    expect(await fetchVesselsInArea(6.44, 3.47, 0)).toBeNull(); // invalid radius
    expect(await fetchVesselsInArea(NaN, 3.47, 2)).toBeNull();
  });

  it("serves repeated area queries from the 15-min cache", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ vessels: [] }));
    await fetchVesselsInArea(6.441, 3.471, 2);
    await fetchVesselsInArea(6.442, 3.472, 2); // rounds to the same cache key
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
