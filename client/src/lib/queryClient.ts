import { QueryClient } from "@tanstack/react-query";

/**
 * QueryClient configured for a frontend-only application.
 * All data is generated in-memory — no server calls are made.
 * staleTime: Infinity ensures React Query never auto-refetches.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
