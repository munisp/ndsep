import { describe, expect, it } from "vitest";
import { assertOpenSearchIndex, getOpenSearchConfig } from "./opensearchConfig";

describe("OpenSearch configuration hardening", () => {
  it("keeps local development defaults available without injecting credentials", () => {
    expect(getOpenSearchConfig({ NODE_ENV: "test" })).toEqual({
      enabled: true,
      url: "http://localhost:9200",
      username: undefined,
      password: undefined,
    });
  });

  it("requires an explicit enabled state before production imports an OpenSearch client", () => {
    expect(() => getOpenSearchConfig({ NODE_ENV: "production" })).toThrow(
      "OPENSEARCH_ENABLED",
    );
  });

  it("rejects enabled production plaintext, inline credentials, and missing authentication", () => {
    expect(() =>
      getOpenSearchConfig({
        NODE_ENV: "production",
        OPENSEARCH_ENABLED: "true",
        OPENSEARCH_URL: "http://opensearch.internal:9200",
        OPENSEARCH_USERNAME: "ndsep-indexer",
        OPENSEARCH_PASSWORD: "A-long-production-password-value",
      }),
    ).toThrow("https://");

    expect(() =>
      getOpenSearchConfig({
        NODE_ENV: "production",
        OPENSEARCH_ENABLED: "true",
        OPENSEARCH_URL: "https://operator:secret@opensearch.example.internal",
        OPENSEARCH_USERNAME: "ndsep-indexer",
        OPENSEARCH_PASSWORD: "A-long-production-password-value",
      }),
    ).toThrow("inline credentials");

    expect(() =>
      getOpenSearchConfig({
        NODE_ENV: "production",
        OPENSEARCH_ENABLED: "true",
        OPENSEARCH_URL: "https://opensearch.example.internal",
      }),
    ).toThrow("OPENSEARCH_USERNAME");
  });

  it("accepts a non-placeholder HTTPS production endpoint with strong explicit credentials", () => {
    expect(
      getOpenSearchConfig({
        NODE_ENV: "production",
        OPENSEARCH_ENABLED: "true",
        OPENSEARCH_URL: "https://opensearch.ndsep.internal/",
        OPENSEARCH_USERNAME: "ndsep-indexer",
        OPENSEARCH_PASSWORD: "kT9qPx7WvL3mR8sN2cF6hJ4dZa1YbE5",
      }),
    ).toEqual({
      enabled: true,
      url: "https://opensearch.ndsep.internal",
      username: "ndsep-indexer",
      password: "kT9qPx7WvL3mR8sN2cF6hJ4dZa1YbE5",
    });
  });

  it("allows an explicitly disabled production integration without requiring service credentials", () => {
    expect(
      getOpenSearchConfig({
        NODE_ENV: "production",
        OPENSEARCH_ENABLED: "false",
      }),
    ).toEqual({
      enabled: false,
      url: "http://localhost:9200",
      username: undefined,
      password: undefined,
    });
  });

  it("supports the legacy variable names only when they agree with canonical names", () => {
    expect(
      getOpenSearchConfig({
        NODE_ENV: "test",
        OPENSEARCH_USER: "legacy-user",
        OPENSEARCH_PASS: "legacy-password",
      }),
    ).toMatchObject({
      username: "legacy-user",
      password: "legacy-password",
    });

    expect(() =>
      getOpenSearchConfig({
        NODE_ENV: "test",
        OPENSEARCH_USERNAME: "canonical-user",
        OPENSEARCH_USER: "legacy-user",
      }),
    ).toThrow("conflicting values");
  });

  it("rejects indices outside each caller's explicit allow-list", () => {
    expect(() => assertOpenSearchIndex("arbitrary-index", ["ndsep-audit-logs"])).toThrow(
      "not allow-listed",
    );
    expect(() => assertOpenSearchIndex("ndsep-audit-logs", ["ndsep-audit-logs"])).not.toThrow();
  });
});
