import { isServer, QueryClient } from "@tanstack/react-query";
import axios from "axios";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000, // 30 seconds — data changes infrequently in a file-transfer app
        gcTime: 5 * 60_000, // 5 minutes — keep unused cache entries briefly
        // Disabled deliberately. Returning to a tab whose access token expired
        // while backgrounded fired a refetch storm: every query 401s at once and
        // funnels through the token-refresh interceptor, which briefly drops auth
        // to a resolving state and flashes — or, under load, wedges — the
        // full-screen LoadingScreen, even though a hard reload is instant and keeps
        // the user logged in. We don't need focus-driven refetching here: data is
        // refreshed on mutations (invalidateQueries) and explicit user actions, so
        // returning to the tab now renders the cached UI immediately. (The earlier
        // 30s refresh-timeout fix only masked the symptom.)
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Don't retry on client errors (auth, not found, forbidden)
          if (axios.isAxiosError(error)) {
            const status = error.response?.status ?? 0;
            if (status === 401 || status === 403 || status === 404 || status === 409) {
              return false;
            }
          }
          // Retry transient failures up to 2 times
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * Returns the shared QueryClient instance.
 *
 * Server: always creates a new client (avoids sharing state across requests).
 * Browser: reuses a singleton (survives React re-renders and suspense).
 */
export function getQueryClient(): QueryClient {
  if (isServer) {
    return makeQueryClient();
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}
