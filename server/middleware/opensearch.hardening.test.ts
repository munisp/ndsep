import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const originalEnabled = process.env.OPENSEARCH_ENABLED;

vi.mock("../logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.stubGlobal("fetch", fetchMock);

describe("middleware OpenSearch hardening", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    process.env.OPENSEARCH_ENABLED = "false";
  });

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env.OPENSEARCH_ENABLED;
    } else {
      process.env.OPENSEARCH_ENABLED = originalEnabled;
    }
    vi.clearAllMocks();
  });

  it("does not issue network requests when explicitly disabled", async () => {
    const { bulkIndex, checkOpenSearchHealth, indexDocument, search } = await import("./opensearch");

    await expect(search("ndsep-organizations", "sensitive search term")).resolves.toEqual({
      hits: [],
      total: 0,
      took: 0,
    });
    await expect(indexDocument("ndsep-organizations", "org-1", { name: "Organisation" })).resolves.toBe(false);
    await expect(
      bulkIndex("ndsep-organizations", [{ id: "org-1", doc: { name: "Organisation" } }]),
    ).resolves.toBe(0);
    await expect(checkOpenSearchHealth()).resolves.toEqual({
      healthy: false,
      url: "http://localhost:9200",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unallow-listed index before issuing a request", async () => {
    const { search } = await import("./opensearch");

    await expect(search("arbitrary-index", "query")).rejects.toThrow("not allow-listed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
