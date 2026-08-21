import type { OidcConfig } from "@/lib/oidc-session";

export type OidcLoginReadiness = {
  ready: boolean;
  missing: Array<"issuer" | "clientId" | "redirectUri">;
  message: string;
};

export function getOidcLoginReadiness(config: OidcConfig): OidcLoginReadiness {
  const missing: OidcLoginReadiness["missing"] = [];
  if (!config.issuer.startsWith("https://")) missing.push("issuer");
  if (!config.clientId.trim()) missing.push("clientId");
  if (!config.redirectUri.trim()) missing.push("redirectUri");

  if (missing.length === 0) {
    return { ready: true, missing, message: "Enterprise sign-in is configured. Your identity provider will complete authentication in a secure browser session." };
  }

  const labels = missing.map((item) => item === "issuer" ? "HTTPS issuer" : item === "clientId" ? "public client ID" : "redirect URI");
  return { ready: false, missing, message: `Enterprise sign-in is unavailable until ${labels.join(", ")} ${labels.length === 1 ? "is" : "are"} configured by an administrator.` };
}
