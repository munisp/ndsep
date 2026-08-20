import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

function composeServiceBlock(compose: string, service: string): string {
  const match = compose.match(new RegExp(`^  ${service}:\\n([\\s\\S]*?)(?=^  [A-Za-z0-9_-]+:|^# ─── Volumes|\\Z)`, "m"));
  if (!match) throw new Error(`Missing Compose service '${service}'`);
  return match[0];
}

describe("production security configuration", () => {
  it("keeps Caddy as the only host-published production service", () => {
    const compose = read("docker-compose.production.yml");
    const allPortBlocks = [...compose.matchAll(/^    ports:\n((?:      - .*\n)+)/gm)];
    expect(allPortBlocks).toHaveLength(1);
    const caddy = composeServiceBlock(compose, "caddy");
    expect(caddy).toContain('"80:80"');
    expect(caddy).toContain('"443:443"');
    expect(composeServiceBlock(compose, "apisix")).not.toContain("ports:");
    expect(composeServiceBlock(compose, "keycloak")).not.toContain("ports:");
    expect(composeServiceBlock(compose, "ndsep-api")).not.toContain("ports:");
  });

  it("requires a Caddy edge, OpenAppSec APISIX attachment, and internal OPA service", () => {
    const compose = read("docker-compose.production.yml");
    expect(composeServiceBlock(compose, "caddy")).toContain("no-new-privileges:true");
    const apisix = composeServiceBlock(compose, "apisix");
    expect(apisix).toContain("ghcr.io/openappsec/apisix-attachment");
    expect(apisix).toContain("ipc: service:openappsec-agent");
    expect(apisix).toContain("APISIX_STAND_ALONE");
    expect(composeServiceBlock(compose, "opa")).toContain("openpolicyagent/opa");
    expect(composeServiceBlock(compose, "ndsep-api")).toContain('OPA_ENABLED: "true"');
  });

  it("requires OIDC and trusted-forwarded-client limits at APISIX", () => {
    const apisix = read("config/apisix.yaml");
    expect(apisix).toContain("openid-connect:");
    expect(apisix).toContain("bearer_only: true");
    expect(apisix).toContain("key: http_x_forwarded_for");
    expect(apisix).toContain("limit-req:");
    expect(apisix).toContain("limit-count:");
    expect(apisix).toContain("# No catch-all anonymous route");
  });

  it("retains Keycloak MFA enrollment, PKCE, short sessions, and non-wildcard redirects", () => {
    const realm = JSON.parse(read("orchestration/keycloak/ndsep-realm.json")) as {
      accessTokenLifespan: number;
      ssoSessionIdleTimeout: number;
      requiredActions: Array<{ alias: string; defaultAction: boolean }>;
      clients: Array<{
        redirectUris: string[];
        directAccessGrantsEnabled: boolean;
        attributes: Record<string, string>;
        protocolMappers: Array<{ name: string; protocolMapper: string; config: Record<string, string> }>;
      }>;
    };
    expect(realm.accessTokenLifespan).toBeLessThanOrEqual(600);
    expect(realm.ssoSessionIdleTimeout).toBeLessThanOrEqual(900);
    expect(realm.requiredActions).toContainEqual(expect.objectContaining({ alias: "CONFIGURE_TOTP", defaultAction: true }));
    expect(realm.clients[0].directAccessGrantsEnabled).toBe(false);
    expect(realm.clients[0].attributes["pkce.code.challenge.method"]).toBe("S256");
    expect(realm.clients[0].protocolMappers).toContainEqual(
      expect.objectContaining({
        name: "ndsep-access-token-amr",
        protocolMapper: "oidc-amr-mapper",
        config: expect.objectContaining({ "access.token.claim": "true" }),
      }),
    );
    expect(realm.clients[0].redirectUris.join("\n")).not.toContain("localhost");
    expect(realm.clients[0].redirectUris.join("\n")).not.toContain("*.manus");
  });

  it("requires OPA MFA assurance for privileged production decisions", () => {
    const policy = read("infra/opa/policies/ndsep_authz.rego");
    expect(policy).toContain("default allow := false");
    expect(policy).toContain("input.context.mfaVerified");
    expect(policy).toContain('"admin", "approve", "delete", "export"');
  });
});
