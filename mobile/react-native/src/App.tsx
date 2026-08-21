/**
 * NDSEP Mobile — Root App Component
 */
import React, { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { trpc, createTRPCClient } from "./api/trpc";
import AppNavigator from "./navigation/AppNavigator";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
    },
  },
});

const trpcClient = createTRPCClient();

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem("ndsep_session_token").then((token) => {
      setIsAuthenticated(!!token);
      setIsLoading(false);
    });
  }, []);

  if (isLoading) return null;

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AppNavigator isAuthenticated={isAuthenticated} />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
