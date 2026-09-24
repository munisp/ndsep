import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl } from "@/constants/oauth";
import { Platform } from "react-native";
import * as Auth from "./auth";

/**
 * Mobile API layer performance features:
 * - AbortController-based request timeouts (default 15s) so a hung network
 *   request never blocks UI or the offline queue forever.
 * - Response caching for GET requests via `apiGet` — two-tier (in-memory
 *   + AsyncStorage-backed) with a per-entry TTL, so repeated reads (bundle
 *   metadata, reference lists) are served instantly and survive app restarts.
 * - In-flight request deduplication: concurrent `apiGet` calls to the same
 *   endpoint share a single network request.
 */

export const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_GET_TTL_MS = 60_000;
const STORAGE_PREFIX = "@ndsep/api-cache:";
const MAX_PERSISTED_BYTES = 512 * 1024; // never persist payloads >512KB

export type ApiCallOptions = RequestInit & {
  /** Abort the request after this many milliseconds (default 15s). */
  timeoutMs?: number;
};

type CacheEntry = { expiresAt: number; data: unknown };

const memoryCache = new Map<string, CacheEntry>();
const inflightGets = new Map<string, Promise<unknown>>();

function resolveUrl(endpoint: string): string {
  const baseUrl = getApiBaseUrl();
  const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return baseUrl ? `${cleanBaseUrl}${cleanEndpoint}` : endpoint;
}

async function readPersistedCache(key: string): Promise<CacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (entry.expiresAt <= Date.now()) {
      void AsyncStorage.removeItem(STORAGE_PREFIX + key).catch(() => undefined);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function writePersistedCache(key: string, entry: CacheEntry): void {
  try {
    const serialized = JSON.stringify(entry);
    if (serialized.length > MAX_PERSISTED_BYTES) return;
    void AsyncStorage.setItem(STORAGE_PREFIX + key, serialized).catch(() => undefined);
  } catch {
    // Non-serializable payload — memory cache only.
  }
}

/**
 * Clear cached GET responses. Call after mutations that change server state
 * (or on logout). `prefix` optionally narrows invalidation to one resource.
 */
export async function invalidateApiCache(prefix?: string): Promise<void> {
  if (prefix) {
    memoryCache.delete(prefix);
    await AsyncStorage.removeItem(STORAGE_PREFIX + prefix).catch(() => undefined);
    return;
  }
  memoryCache.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith(STORAGE_PREFIX));
    if (cacheKeys.length > 0) await AsyncStorage.multiRemove(cacheKeys);
  } catch {
    // Best-effort invalidation.
  }
}

/**
 * Cached, deduplicated GET. Returns a fresh network value on TTL expiry and
 * shares one in-flight request between concurrent callers.
 */
export function apiGet<T>(
  endpoint: string,
  options: { ttlMs?: number; persist?: boolean; forceRefresh?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const { ttlMs = DEFAULT_GET_TTL_MS, persist = true, forceRefresh = false, timeoutMs } = options;

  if (!forceRefresh) {
    const hit = memoryCache.get(endpoint);
    if (hit && hit.expiresAt > Date.now()) {
      return Promise.resolve(hit.data as T);
    }
  }

  const inflight = inflightGets.get(endpoint);
  if (inflight) return inflight as Promise<T>;

  const request = (async () => {
    if (!forceRefresh && !memoryCache.has(endpoint)) {
      const persisted = await readPersistedCache(endpoint);
      if (persisted) {
        memoryCache.set(endpoint, persisted);
        return persisted.data as T;
      }
    }
    const data = await apiCall<T>(endpoint, { method: "GET", timeoutMs });
    const entry: CacheEntry = { expiresAt: Date.now() + ttlMs, data };
    memoryCache.set(endpoint, entry);
    if (persist) writePersistedCache(endpoint, entry);
    return data;
  })().finally(() => {
    inflightGets.delete(endpoint);
  });

  inflightGets.set(endpoint, request);
  return request;
}

export async function apiCall<T>(endpoint: string, options: ApiCallOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  if (Platform.OS !== "web") {
    const sessionToken = await Auth.getSessionToken();
    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }
  }

  const url = resolveUrl(endpoint);

  // Enforce a hard timeout; forward caller abort signals too.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timeout);
      throw callerSignal.reason ?? new Error("Request aborted");
    }
    callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      headers,
      credentials: "include",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && !callerSignal?.aborted) {
      throw new Error(`API call timed out after ${timeoutMs}ms: ${endpoint}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = errorText;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error || errorJson.message || errorText;
    } catch {
      // Keep plain text.
    }
    throw new Error(errorMessage || `API call failed: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  return (await response.text()) as T;
}

export async function login(input: { email: string; name?: string; role?: "user" | "admin" }) {
  const result = await apiCall<{ sessionToken: string; user: any }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (result.sessionToken) {
    await Auth.setSessionToken(result.sessionToken);
  }
  if (result.user) {
    await Auth.setUserInfo({
      id: result.user.id,
      openId: result.user.openId,
      name: result.user.name,
      email: result.user.email,
      loginMethod: result.user.loginMethod,
      lastSignedIn: new Date(result.user.lastSignedIn),
    });
  }
  return result;
}

export async function exchangeOAuthCode(
  _code: string,
  _state: string,
): Promise<{ sessionToken: string; user: any }> {
  return login({
    email: "portable-user@example.com",
    name: "Portable User",
    role: "user",
  });
}

export async function logout(): Promise<void> {
  await apiCall<void>("/api/auth/logout", { method: "POST" });
  // Drop all cached GET responses so a different user never sees stale data.
  await invalidateApiCache();
}

export async function getMe(): Promise<{
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  lastSignedIn: string;
  role?: "user" | "admin";
} | null> {
  try {
    const result = await apiCall<{ user: any }>("/api/auth/me");
    return result.user || null;
  } catch {
    return null;
  }
}

export async function establishSession(token: string): Promise<boolean> {
  try {
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
    });
    return response.ok;
  } catch {
    return false;
  }
}
