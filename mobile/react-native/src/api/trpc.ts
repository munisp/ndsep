/**
 * NDSEP Mobile — tRPC client
 * Connects to the same backend as the web PWA.
 * Set NDSEP_API_URL in your .env (e.g. https://ndsep.nitda.gov.ng)
 */
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AppRouter } from "../../../../server/routers"; // shared type import

export const trpc = createTRPCReact<AppRouter>();

const API_URL = process.env.NDSEP_API_URL ?? "https://ndsep.nitda.gov.ng";

export function createTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${API_URL}/api/trpc`,
        transformer: superjson,
        async headers() {
          const token = await AsyncStorage.getItem("ndsep_session_token");
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}
