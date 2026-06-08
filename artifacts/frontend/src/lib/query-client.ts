// CCQ-113 — Shared QueryClient instance.
// Exported so AuthContext can call queryClient.clear() on logout,
// preventing stale cross-org data from being served after an org switch.
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        if (error && typeof error === "object" && "status" in error) {
          const s = (error as { status: number }).status;
          if (s === 401 || s === 403) return false;
        }
        return failureCount < 2;
      },
    },
  },
});
