export interface OpenSearchConfig {
  enabled: boolean;
  url: string;
  username?: string;
  password?: string;
}

type Environment = Record<string, string | undefined>;

const DEFAULT_DEVELOPMENT_URL = "http://localhost:9200";
const PLACEHOLDER_PATTERN = /(?:change[_ -]?me|placeholder|example|default|replace[_ -]?me|<[^>]+>)/i;

function isProduction(env: Environment): boolean {
  return env.NODE_ENV === "production" || env.APP_ENV === "production";
}

function resolveCredential(
  env: Environment,
  canonicalName: "OPENSEARCH_USERNAME" | "OPENSEARCH_PASSWORD",
  legacyName: "OPENSEARCH_USER" | "OPENSEARCH_PASS",
): string | undefined {
  const canonical = env[canonicalName];
  const legacy = env[legacyName];
  if (canonical && legacy && canonical !== legacy) {
    throw new Error(`${canonicalName} and ${legacyName} must not contain conflicting values`);
  }
  return canonical ?? legacy;
}

function isUnsafeSecret(value: string): boolean {
  return value.trim().length < 24 || PLACEHOLDER_PATTERN.test(value);
}

export function getOpenSearchConfig(env: Environment = process.env): OpenSearchConfig {
  const production = isProduction(env);
  const configuredEnabled = env.OPENSEARCH_ENABLED;
  if (configuredEnabled !== undefined && configuredEnabled !== "true" && configuredEnabled !== "false") {
    throw new Error("OPENSEARCH_ENABLED must be exactly true or false when set");
  }
  if (production && configuredEnabled === undefined) {
    throw new Error("Production OpenSearch requires OPENSEARCH_ENABLED to be explicitly true or false");
  }

  const enabled = configuredEnabled === "true" || (!production && configuredEnabled !== "false");
  const url = env.OPENSEARCH_URL ?? DEFAULT_DEVELOPMENT_URL;
  const username = resolveCredential(env, "OPENSEARCH_USERNAME", "OPENSEARCH_USER");
  const password = resolveCredential(env, "OPENSEARCH_PASSWORD", "OPENSEARCH_PASS");

  if (!enabled) {
    return { enabled, url, username, password };
  }

  let endpoint: URL;
  try {
    endpoint = new URL(url);
  } catch {
    throw new Error("OPENSEARCH_URL must be an absolute URL");
  }

  if (endpoint.username || endpoint.password) {
    throw new Error("OPENSEARCH_URL must not contain inline credentials");
  }

  if (production) {
    if (endpoint.protocol !== "https:") {
      throw new Error("Enabled production OpenSearch requires an https:// OPENSEARCH_URL");
    }
    if (!username || username.trim().length < 3 || PLACEHOLDER_PATTERN.test(username)) {
      throw new Error("Enabled production OpenSearch requires a non-placeholder OPENSEARCH_USERNAME");
    }
    if (!password || isUnsafeSecret(password)) {
      throw new Error("Enabled production OpenSearch requires a non-placeholder OPENSEARCH_PASSWORD of at least 24 characters");
    }
  }

  return { enabled, url: endpoint.toString().replace(/\/$/, ""), username, password };
}

export function assertOpenSearchIndex(index: string, allowedIndices: readonly string[]): void {
  if (!allowedIndices.includes(index)) {
    throw new Error(`OpenSearch index is not allow-listed: ${index}`);
  }
}
