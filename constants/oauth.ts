import * as Linking from "expo-linking";
import * as ReactNative from "react-native";

const env = {
  authPortalUrl: process.env.EXPO_PUBLIC_AUTH_PORTAL_URL ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  appId: process.env.EXPO_PUBLIC_APP_ID ?? "idlr-pts-platform",
  deepLinkScheme: process.env.EXPO_PUBLIC_APP_SCHEME ?? "idlrpts",
};

export const AUTH_PORTAL_URL = env.authPortalUrl;
export const API_BASE_URL = env.apiBaseUrl;
export const APP_ID = env.appId;

export function getApiBaseUrl(): string {
  if (API_BASE_URL) {
    return API_BASE_URL.replace(/\/$/, "");
  }

  if (ReactNative.Platform.OS === "web" && typeof window !== "undefined" && window.location) {
    return window.location.origin.replace(/\/$/, "");
  }

  return "http://localhost:3000";
}

export const SESSION_TOKEN_KEY = "app_session_token";
export const USER_INFO_KEY = "idlr-pts-user-info";

export const getRedirectUri = () => {
  if (ReactNative.Platform.OS === "web") {
    return `${getApiBaseUrl()}/auth/callback`;
  }

  return Linking.createURL("/oauth/callback", {
    scheme: env.deepLinkScheme,
  });
};

export const getLoginUrl = () => {
  if (AUTH_PORTAL_URL) {
    const url = new URL(`${AUTH_PORTAL_URL.replace(/\/$/, "")}/login`);
    url.searchParams.set("appId", APP_ID);
    url.searchParams.set("redirectUri", getRedirectUri());
    return url.toString();
  }

  return `${getApiBaseUrl()}/login`;
};

export async function startOAuthLogin(): Promise<string | null> {
  const loginUrl = getLoginUrl();

  if (ReactNative.Platform.OS === "web") {
    if (typeof window !== "undefined") {
      window.location.href = loginUrl;
    }
    return null;
  }

  const supported = await Linking.canOpenURL(loginUrl);
  if (!supported) {
    return null;
  }

  try {
    await Linking.openURL(loginUrl);
  } catch {
    return null;
  }

  return null;
}
