import { describe, expect, it } from "vitest";
import { normalizeWafFilterPreset } from "../lib/waf-filter-preset-utils";
describe("WAF filter preset validation", () => { it("requires a name and a query", () => { expect(normalizeWafFilterPreset({ name: "", query: "sqli" })).toBeNull(); expect(normalizeWafFilterPreset({ name: "SQL injection", query: "sqli" })).toMatchObject({ name: "SQL injection", query: "sqli" }); }); });
