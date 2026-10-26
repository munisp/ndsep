/**
 * Round-13 P0.2 — hosting verification verdict logic tests.
 * reconClient + db are fully mocked through the VerificationDeps seam.
 * Central invariant under test: FAIL-CLOSED — recon down / no evidence can
 * NEVER produce a compliant verdict.
 */
import { describe, it, expect, vi } from "vitest";
import {
  ipv4InCidr,
  classifyIp,
  aggregateHostVerdict,
  aggregateDeclarationVerdict,
  extractDeclaredHosts,
  verifyDeclaration,
  runDueVerifications,
  type VerificationDeps,
} from "./hostingVerification";

// ─── Pure helper: ipv4InCidr ─────────────────────────────────────────────────

describe("ipv4InCidr", () => {
  it("matches IPs inside verified NG prefixes", () => {
    expect(ipv4InCidr("41.184.10.20", "41.184.0.0/16")).toBe(true);
    expect(ipv4InCidr("197.210.55.1", "197.210.0.0/16")).toBe(true);
    expect(ipv4InCidr("41.203.64.9", "41.203.64.0/19")).toBe(true);
  });
  it("rejects IPs outside the prefix", () => {
    expect(ipv4InCidr("8.8.8.8", "41.184.0.0/16")).toBe(false);
    expect(ipv4InCidr("41.203.95.255", "41.203.64.0/19")).toBe(true); // boundary inside
    expect(ipv4InCidr("41.203.96.1", "41.203.64.0/19")).toBe(false); // next block
  });
  it("handles /32 and /0 edges", () => {
    expect(ipv4InCidr("10.0.0.1", "10.0.0.1/32")).toBe(true);
    expect(ipv4InCidr("10.0.0.2", "10.0.0.1/32")).toBe(false);
    expect(ipv4InCidr("1.2.3.4", "0.0.0.0/0")).toBe(true);
  });
  it("returns null on malformed input (never throws)", () => {
    expect(ipv4InCidr("999.1.1.1", "41.184.0.0/16")).toBeNull();
    expect(ipv4InCidr("41.184.1.1", "41.184.0.0/33")).toBeNull();
    expect(ipv4InCidr("not-an-ip", "41.184.0.0/16")).toBeNull();
    expect(ipv4InCidr("41.184.1.1", "garbage")).toBeNull();
  });
});

// ─── Pure helper: classifyIp (fail-closed) ───────────────────────────────────

describe("classifyIp", () => {
  it("in_nigeria on any positive domestic evidence", () => {
    expect(classifyIp({ prefixMatch: true, asnMatch: false, intelCountry: null, intelAsn: null })).toBe("in_nigeria");
    expect(classifyIp({ prefixMatch: false, asnMatch: true, intelCountry: null, intelAsn: 29465 })).toBe("in_nigeria");
    expect(classifyIp({ prefixMatch: false, asnMatch: false, intelCountry: "NG", intelAsn: null })).toBe("in_nigeria");
  });
  it("outside_nigeria on positive foreign geo evidence without domestic match", () => {
    expect(classifyIp({ prefixMatch: false, asnMatch: false, intelCountry: "US", intelAsn: 13335 })).toBe("outside_nigeria");
  });
  it("domestic prefix beats foreign-looking intel (prefix is authoritative)", () => {
    expect(classifyIp({ prefixMatch: true, asnMatch: false, intelCountry: "GB", intelAsn: 1 })).toBe("in_nigeria");
  });
  it("unverified when there is no evidence at all", () => {
    expect(classifyIp({ prefixMatch: false, asnMatch: false, intelCountry: null, intelAsn: null })).toBe("unverified");
    expect(classifyIp({ prefixMatch: false, asnMatch: false, intelCountry: null, intelAsn: 12345 })).toBe("unverified");
  });
});

describe("aggregateHostVerdict / aggregateDeclarationVerdict", () => {
  it("host: any outside wins; all-in => in; mixed in+unverified => unverified", () => {
    expect(aggregateHostVerdict(["in_nigeria", "outside_nigeria"])).toBe("outside_nigeria");
    expect(aggregateHostVerdict(["in_nigeria", "in_nigeria"])).toBe("in_nigeria");
    expect(aggregateHostVerdict(["in_nigeria", "unverified"])).toBe("unverified");
    expect(aggregateHostVerdict([])).toBe("unverified");
  });
  it("declaration: violation > compliant; never compliant with unverified hosts", () => {
    expect(aggregateDeclarationVerdict(["in_nigeria", "outside_nigeria"])).toBe("violation");
    expect(aggregateDeclarationVerdict(["in_nigeria", "in_nigeria"])).toBe("compliant");
    expect(aggregateDeclarationVerdict(["in_nigeria", "unverified"])).toBe("unverified");
    expect(aggregateDeclarationVerdict([])).toBe("unverified");
  });
});

// ─── extractDeclaredHosts ────────────────────────────────────────────────────

describe("extractDeclaredHosts", () => {
  it("pulls domains and IP literals from host-shaped fields only", () => {
    const hosts = extractDeclaredHosts({
      primary_dc_name: "dc1.rack-centre.ng",
      cloud_provider: "aws",
      cloud_regions: ["lagos-1", "eu-west-1", "backup.example.ng"],
      backup_locations: [{ name: "41.58.10.5", city: "Lagos", country: "NG" }],
      dr_locations: [{ name: "Mediation DC", city: "London", country: "GB" }],
      admin_access_locations: [{ name: "noc.example.ng", country: "NG", team: "noc" }],
      encryption_key_custody: { country: "NG", hsm_provider: "hsm.example.ng" },
      subprocessors: [{ name: "Acme Corp", country: "US" }],
    });
    const names = hosts.map((h) => h.host);
    expect(names).toContain("dc1.rack-centre.ng");
    expect(names).toContain("backup.example.ng");
    expect(names).toContain("41.58.10.5");
    expect(names).toContain("noc.example.ng");
    expect(names).toContain("hsm.example.ng");
    expect(names).not.toContain("lagos-1");
    expect(names).not.toContain("eu-west-1");
    expect(names).not.toContain("Acme Corp");
    expect(hosts.find((h) => h.host === "41.58.10.5")?.kind).toBe("ip");
    expect(hosts.find((h) => h.host === "dc1.rack-centre.ng")?.kind).toBe("domain");
  });
  it("dedupes and tolerates empty declarations", () => {
    const hosts = extractDeclaredHosts({
      primary_dc_name: "dup.example.ng",
      cloud_regions: ["dup.example.ng"],
    });
    expect(hosts).toHaveLength(1);
    expect(extractDeclaredHosts({})).toHaveLength(0);
  });
});

// ─── verifyDeclaration with mocked recon + db ────────────────────────────────

const DECLARATION = {
  id: 42,
  entity_ref: "CBN-LIC-0042",
  entity_name: "TestPay Ltd",
  declaration_status: "approved",
  in_scope: true,
  primary_dc_name: "dc.testpay.ng",
  cloud_regions: [],
  backup_locations: [],
  dr_locations: [],
  admin_access_locations: [],
  encryption_key_custody: {},
  subprocessors: [],
};

const NG_PREFIXES = ["41.184.0.0/16", "197.210.0.0/16"];
const NG_ASNS = new Set([29465, 37567]);

function makeDeps(overrides: Partial<VerificationDeps> = {}): VerificationDeps {
  const exec = vi.fn(async (query: string, params: unknown[] = []) => {
    if (query.includes("FROM hosting_declarations WHERE id")) return [DECLARATION];
    if (query.includes("asn_geo_reference") && query.includes("nigerian_cidr")) {
      const ip = String(params[0]);
      const hit = NG_PREFIXES.find((c) => ipv4InCidr(ip, c) === true);
      return hit ? [{ cidr: hit }] : [];
    }
    if (query.includes("asn_geo_reference") && query.includes("nigerian_asn")) {
      const asn = Number(params[0]);
      return NG_ASNS.has(asn) ? [{ provider: "MTN Nigeria" }] : [];
    }
    if (query.includes("INSERT INTO hosting_verification_runs")) return [{ id: 9001 }];
    return []; // hosts insert, prediction update, etc.
  });
  return {
    exec,
    resolveDns: vi.fn(async () => null),
    ipIntel: vi.fn(async () => null),
    sslInspect: vi.fn(async () => null),
    publish: vi.fn(async () => true),
    ledger: vi.fn(async () => ({})),
    mintFeedback: vi.fn(async () => "11111111-2222-4333-8444-555555555555"),
    now: () => new Date("2026-11-01T00:00:00Z"),
    ...overrides,
  };
}

describe("verifyDeclaration", () => {
  it("NG prefix match => host in_nigeria => declaration compliant", async () => {
    const deps = makeDeps({
      resolveDns: vi.fn(async () => ({
        domain: "dc.testpay.ng",
        source: "osiris" as const,
        records: [{ type: "A", value: "41.184.22.10" }],
      })),
      ipIntel: vi.fn(async () => ({
        ip: "41.184.22.10", country: "NG", asn: 29465, org: "MTN Nigeria", source: "osiris" as const,
      })),
      sslInspect: vi.fn(async () => ({
        domain: "dc.testpay.ng", valid_to: "2027-06-01T00:00:00Z", days_to_expiry: 210,
        expired: false, hostname_match: true, source: "local_tls" as const,
      })),
    });
    const r = await verifyDeclaration(42, { deps });
    expect(r.verdict).toBe("compliant");
    expect(r.hosts[0].verdict).toBe("in_nigeria");
    expect((r.hosts[0].evidence.ips as any[])[0].matched_prefix).toBe("41.184.0.0/16");
    expect(r.runId).toBe(9001);
    expect(deps.publish).toHaveBeenCalledWith(
      "ndsep.sovereignty.verification", "42",
      expect.objectContaining({ verdict: "compliant" })
    );
    expect(deps.ledger).toHaveBeenCalled();
    expect(deps.mintFeedback).not.toHaveBeenCalled(); // no flag on compliant
  });

  it("foreign IP intel + no prefix match => violation + feedback baseline minted", async () => {
    const deps = makeDeps({
      resolveDns: vi.fn(async () => ({
        domain: "dc.testpay.ng",
        source: "osiris" as const,
        records: [{ type: "A", value: "8.8.8.8" }],
      })),
      ipIntel: vi.fn(async () => ({
        ip: "8.8.8.8", country: "US", asn: 15169, org: "Google LLC", source: "osiris" as const,
      })),
    });
    const r = await verifyDeclaration(42, { deps });
    expect(r.verdict).toBe("violation");
    expect(r.hosts[0].verdict).toBe("outside_nigeria");
    expect(deps.mintFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "hosting_verification" })
    );
    expect(r.predictionId).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("ASN-only evidence: NG ASN in seed table => in_nigeria even without prefix", async () => {
    const deps = makeDeps({
      resolveDns: vi.fn(async () => ({
        domain: "dc.testpay.ng",
        source: "osiris" as const,
        records: [{ type: "A", value: "102.89.0.10" }], // not in the two test prefixes
      })),
      ipIntel: vi.fn(async () => ({
        ip: "102.89.0.10", asn: 37567, org: "NIBSS", source: "osiris" as const, // no country
      })),
    });
    const r = await verifyDeclaration(42, { deps });
    expect(r.verdict).toBe("compliant");
  });

  it("FAIL-CLOSED: recon fully down => unverified, NEVER compliant", async () => {
    const deps = makeDeps({
      resolveDns: vi.fn(async () => null), // OSIRIS DNS down AND local fallback empty
      ipIntel: vi.fn(async () => null),
      sslInspect: vi.fn(async () => null),
    });
    const r = await verifyDeclaration(42, { deps });
    expect(r.verdict).toBe("unverified");
    expect(r.hosts[0].verdict).toBe("unverified");
    expect(deps.mintFeedback).not.toHaveBeenCalled();
  });

  it("FAIL-CLOSED: local DNS fallback resolves but intel down => still unverified", async () => {
    const deps = makeDeps({
      resolveDns: vi.fn(async () => ({
        domain: "dc.testpay.ng",
        source: "local_dns_fallback" as const,
        records: [{ type: "A", value: "8.8.8.8" }],
      })),
      ipIntel: vi.fn(async () => null), // OSIRIS intel down
    });
    const r = await verifyDeclaration(42, { deps });
    expect(r.verdict).toBe("unverified");
    expect((r.hosts[0].evidence.notes as string[]).join(" ")).toContain("local_dns_fallback");
  });

  it("FAIL-CLOSED: reference table missing (42P01) => unverified", async () => {
    const deps = makeDeps({
      exec: vi.fn(async (query: string) => {
        if (query.includes("asn_geo_reference")) {
          const err = new Error("relation does not exist") as Error & { code?: string };
          err.code = "42P01";
          throw err;
        }
        if (query.includes("FROM hosting_declarations WHERE id")) return [DECLARATION];
        if (query.includes("INSERT INTO hosting_verification_runs")) return [{ id: 9002 }];
        return [];
      }),
      resolveDns: vi.fn(async () => ({
        domain: "dc.testpay.ng", source: "osiris" as const,
        records: [{ type: "A", value: "41.184.22.10" }],
      })),
      ipIntel: vi.fn(async () => null),
    });
    const r = await verifyDeclaration(42, { deps });
    expect(r.verdict).toBe("unverified");
  });

  it("no extractable hosts => unverified with note", async () => {
    const deps = makeDeps({
      exec: vi.fn(async (query: string) => {
        if (query.includes("FROM hosting_declarations WHERE id")) {
          return [{ ...DECLARATION, primary_dc_name: "Lagos DC Main" }];
        }
        if (query.includes("INSERT INTO hosting_verification_runs")) return [{ id: 9003 }];
        return [];
      }),
    });
    const r = await verifyDeclaration(42, { deps });
    expect(r.verdict).toBe("unverified");
    expect(r.hostCount).toBe(0);
  });

  it("mixed hosts: one foreign => violation even if others verify", async () => {
    const decl = {
      ...DECLARATION,
      primary_dc_name: "dc.testpay.ng",
      backup_locations: [{ name: "dr.example.com", country: "NG" }],
    };
    const deps = makeDeps({
      exec: vi.fn(async (query: string, params: unknown[] = []) => {
        if (query.includes("FROM hosting_declarations WHERE id")) return [decl];
        if (query.includes("asn_geo_reference") && query.includes("nigerian_cidr")) {
          const ip = String(params[0]);
          const hit = NG_PREFIXES.find((c) => ipv4InCidr(ip, c) === true);
          return hit ? [{ cidr: hit }] : [];
        }
        if (query.includes("asn_geo_reference") && query.includes("nigerian_asn")) return [];
        if (query.includes("INSERT INTO hosting_verification_runs")) return [{ id: 9004 }];
        return [];
      }),
      resolveDns: vi.fn(async (domain: string) => ({
        domain,
        source: "osiris" as const,
        records: domain === "dc.testpay.ng"
          ? [{ type: "A", value: "41.184.22.10" }]
          : [{ type: "A", value: "34.102.5.5" }],
      })),
      ipIntel: vi.fn(async (ip: string) =>
        ip === "41.184.22.10"
          ? { ip, country: "NG", asn: null, source: "osiris" as const }
          : { ip, country: "BE", asn: 396982, org: "Google Cloud", source: "osiris" as const }
      ),
    });
    const r = await verifyDeclaration(42, { deps });
    expect(r.verdict).toBe("violation");
    expect(r.inNigeriaCount).toBe(1);
    expect(r.outsideNigeriaCount).toBe(1);
  });
});

// ─── runDueVerifications ─────────────────────────────────────────────────────

describe("runDueVerifications", () => {
  it("verifies due declarations and counts verdicts; errors isolated", async () => {
    const base = makeDeps({
      exec: vi.fn(async (query: string, params: unknown[] = []) => {
        if (query.includes("LEFT JOIN LATERAL")) return [{ id: 42 }, { id: 43 }];
        if (query.includes("FROM hosting_declarations WHERE id")) {
          if (Number(params[0]) === 43) throw new Error("boom");
          return [DECLARATION];
        }
        if (query.includes("asn_geo_reference") && query.includes("nigerian_cidr")) {
          return [{ cidr: "41.184.0.0/16" }];
        }
        if (query.includes("INSERT INTO hosting_verification_runs")) return [{ id: 9010 }];
        return [];
      }),
      resolveDns: vi.fn(async () => ({
        domain: "dc.testpay.ng", source: "osiris" as const,
        records: [{ type: "A", value: "41.184.22.10" }],
      })),
      ipIntel: vi.fn(async () => ({ ip: "41.184.22.10", country: "NG", asn: 29465, source: "osiris" as const })),
    });
    const r = await runDueVerifications({ deps: base });
    expect(r.checked).toBe(1);
    expect(r.verdicts.compliant).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].declarationId).toBe(43);
  });
});
