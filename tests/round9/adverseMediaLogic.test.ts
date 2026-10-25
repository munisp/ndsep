import { describe, it, expect } from "vitest";
import {
  normalizeUrl,
  urlHash,
  keywordClassify,
  nameSimilarity,
  matchOrganizations,
  retentionExpiry,
} from "../../server/services/adverseMediaLogic";

describe("normalizeUrl", () => {
  it("strips tracking params, lowercases host, trims trailing slash", () => {
    expect(normalizeUrl("HTTPS://Example.COM/news/1/?utm_source=x&a=1#frag"))
      .toBe("https://example.com/news/1?a=1");
  });
  it("returns empty string for invalid URLs", () => {
    expect(normalizeUrl("not a url")).toBe("");
    expect(normalizeUrl("")).toBe("");
  });
});

describe("urlHash", () => {
  it("is stable across tracking-param noise", () => {
    expect(urlHash("https://a.com/x?utm_source=a")).toBe(urlHash("https://a.com/x?gclid=b"));
  });
  it("falls back to title+date anchor when URL absent", () => {
    expect(urlHash(null, "Some Title", "2026-01-01")).toBe(urlHash(undefined, "some title", "2026-01-01"));
  });
  it("differs for different URLs", () => {
    expect(urlHash("https://a.com/1")).not.toBe(urlHash("https://a.com/2"));
  });
});

describe("keywordClassify", () => {
  it("classifies breach news as critical/data_breach with method=keyword", () => {
    const r = keywordClassify("Major data breach hits bank: personal data exposed");
    expect(r.label).toBe("data_breach");
    expect(r.severity).toBe("critical");
    expect(r.method).toBe("keyword");
  });
  it("classifies sanctions as high", () => {
    expect(keywordClassify("Regulator issues fine after enforcement action").severity).toBe("high");
  });
  it("defaults to info/other", () => {
    const r = keywordClassify("Company announces new product launch");
    expect(r.label).toBe("other");
    expect(r.severity).toBe("info");
  });
});

describe("nameSimilarity", () => {
  it("is 1 for normalised-equal names (ignores Ltd/PLC noise)", () => {
    expect(nameSimilarity("Acme Ltd", "ACME Limited")).toBe(1);
  });
  it("is high for near matches, low for unrelated", () => {
    expect(nameSimilarity("Zenith Bank", "Zenith Ban")).toBeGreaterThan(0.8);
    expect(nameSimilarity("Zenith Bank", "Globus Telecom")).toBeLessThan(0.3);
  });
});

describe("matchOrganizations", () => {
  const registry = [
    { id: 1, name: "Zenith Bank Plc" },
    { id: 2, name: "Globacom Limited", aliases: ["Glo"] },
    { id: 3, name: "Dangote Cement" },
  ];
  it("exact match => confidence 1", () => {
    const m = matchOrganizations("Zenith Bank fined over breach", registry);
    expect(m[0]).toMatchObject({ organization_id: 1, match_method: "exact", confidence: 1 });
  });
  it("alias match => confidence 0.9", () => {
    const m = matchOrganizations("Glo subscribers affected by outage lawsuit", registry);
    expect(m.find((x) => x.organization_id === 2)).toMatchObject({ match_method: "alias", confidence: 0.9 });
  });
  it("fuzzy match >= threshold with lower confidence", () => {
    const m = matchOrganizations("Dangote Cemnt faces sanction", registry);
    const hit = m.find((x) => x.organization_id === 3);
    expect(hit).toBeDefined();
    expect(hit!.match_method).toBe("fuzzy");
    expect(hit!.confidence).toBeGreaterThanOrEqual(0.6);
    expect(hit!.confidence).toBeLessThan(1);
  });
  it("returns [] for unrelated text", () => {
    expect(matchOrganizations("Weather is nice today", registry)).toEqual([]);
  });
});

describe("retentionExpiry", () => {
  it("adds retention days", () => {
    const d = retentionExpiry(new Date("2026-01-01T00:00:00Z"), 30);
    expect(d.toISOString().slice(0, 10)).toBe("2026-01-31");
  });
});
