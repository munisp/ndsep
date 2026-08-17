import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type OidcConfig = { issuer: string; clientId: string; redirectUri: string };
export type OidcSession = { accessToken: string; refreshToken?: string; idToken?: string; expiresAt: number; subject: string; email?: string; name?: string };
const SESSION_KEY = "idlr.oidc.session.v1";
const SESSION_METADATA_KEY = "idlr.oidc.session_metadata.v1";
export type OidcSessionMetadata = Pick<OidcSession, "expiresAt" | "subject">;

export function assertOidcConfig(config: OidcConfig) {
  if (!config.issuer.startsWith("https://") || !config.clientId || !config.redirectUri) throw new Error("Enterprise sign-in is unavailable until a HTTPS OIDC issuer, public client ID, and redirect URI are configured.");
}
function decodeJwt(token?: string): Record<string, unknown> {
  if (!token) return {};
  try { return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64").toString("utf8")); } catch { return {}; }
}
export async function signInWithPkce(config: OidcConfig, registration = false): Promise<OidcSession> {
  assertOidcConfig(config);
  const discovery = await AuthSession.fetchDiscoveryAsync(config.issuer);
  if (!discovery.authorizationEndpoint || !discovery.tokenEndpoint) throw new Error("OIDC discovery is incomplete. Contact an administrator.");
  const request = new AuthSession.AuthRequest({ clientId: config.clientId, redirectUri: config.redirectUri, responseType: AuthSession.ResponseType.Code, usePKCE: true, scopes: ["openid", "profile", "email", "offline_access"], extraParams: registration ? { kc_action: "REGISTER" } : undefined });
  const response = await request.promptAsync(discovery);
  if (response.type === "dismiss" || response.type === "cancel") throw new Error("Sign-in was cancelled.");
  if (response.type !== "success") {
    const details = "params" in response ? response.params.error_description : undefined;
    throw new Error(details ?? "Sign-in failed.");
  }
  if (!response.params.code) throw new Error(response.params.error_description ?? "Sign-in failed.");
  const token = await AuthSession.exchangeCodeAsync({ clientId: config.clientId, code: response.params.code, redirectUri: config.redirectUri, extraParams: { code_verifier: request.codeVerifier ?? "" } }, discovery);
  const claims = decodeJwt(token.idToken);
  const subject = typeof claims.sub === "string" ? claims.sub : "";
  if (!subject) throw new Error("OIDC provider did not issue a subject claim.");
  const session: OidcSession = { accessToken: token.accessToken, refreshToken: token.refreshToken, idToken: token.idToken, expiresAt: Date.now() + (token.expiresIn ?? 300) * 1000, subject, email: typeof claims.email === "string" ? claims.email : undefined, name: typeof claims.name === "string" ? claims.name : undefined };
  await saveBiometricSession(session); return session;
}
export async function saveBiometricSession(session: OidcSession) {
  if (Platform.OS === "web") throw new Error("Browser sessions must be server-cookie based; native token storage is unavailable on web.");
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), { requireAuthentication: true, authenticationPrompt: "Unlock your IDLR-PTS session" });
  await SecureStore.setItemAsync(SESSION_METADATA_KEY, JSON.stringify({ expiresAt: session.expiresAt, subject: session.subject } satisfies OidcSessionMetadata));
}
export async function getBiometricSessionMetadata(): Promise<OidcSessionMetadata | null> {
  if (Platform.OS === "web") return null;
  try { const raw = await SecureStore.getItemAsync(SESSION_METADATA_KEY); return raw ? JSON.parse(raw) as OidcSessionMetadata : null; } catch { return null; }
}
export async function clearLocalBiometricSession() {
  if (Platform.OS === "web") return;
  await Promise.all([SecureStore.deleteItemAsync(SESSION_KEY), SecureStore.deleteItemAsync(SESSION_METADATA_KEY)]);
}
export async function loadBiometricSession(): Promise<OidcSession | null> {
  if (Platform.OS === "web") return null;
  try { const raw = await SecureStore.getItemAsync(SESSION_KEY, { requireAuthentication: true, authenticationPrompt: "Unlock your IDLR-PTS session" }); return raw ? JSON.parse(raw) as OidcSession : null; } catch { return null; }
}
export async function refreshBiometricSession(config: OidcConfig): Promise<OidcSession> {
  assertOidcConfig(config);
  const current = await loadBiometricSession();
  if (!current?.refreshToken) throw new Error("Your session cannot be refreshed. Please sign in again.");
  const discovery = await AuthSession.fetchDiscoveryAsync(config.issuer);
  if (!discovery.tokenEndpoint) throw new Error("OIDC token endpoint is unavailable.");
  try {
    const token = await AuthSession.refreshAsync({ clientId: config.clientId, refreshToken: current.refreshToken }, discovery);
    const next: OidcSession = { ...current, accessToken: token.accessToken, refreshToken: token.refreshToken ?? current.refreshToken, idToken: token.idToken ?? current.idToken, expiresAt: Date.now() + (token.expiresIn ?? 300) * 1000 };
    await saveBiometricSession(next);
    return next;
  } catch (error) {
    await clearLocalBiometricSession();
    throw new Error(error instanceof Error ? `Session refresh was rejected: ${error.message}` : "Session refresh was rejected. Please sign in again.");
  }
}
export async function revokeAndClearSession(config: OidcConfig) {
  const session = await loadBiometricSession();
  if (session?.refreshToken) { const d = await AuthSession.fetchDiscoveryAsync(config.issuer); if (d.revocationEndpoint) await fetch(d.revocationEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, token: session.refreshToken, token_type_hint: "refresh_token" }).toString() }); }
  await clearLocalBiometricSession();
}
