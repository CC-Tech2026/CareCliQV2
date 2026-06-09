// CCQ-113 — Shared QueryClient with org-scoped cache keys.
//
// Every cache entry is keyed under the current org_id via a custom
// queryKeyHashFn.  This means Org A's cached data can never be served
// to Org B — even if a user switches orgs in the same browser tab.
// queryClient.clear() is called on logout (see AuthContext) to purge
// all entries regardless.

import { QueryClient, hashKey } from "@tanstack/react-query";

let _currentOrgId: string | null = null;

/** Called by AuthContext when a session is established or refreshed. */
export function setQueryOrgId(orgId: string | null): void {
  _currentOrgId = orgId;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Prefix every cache hash with the current org_id so entries from
      // different orgs are stored under distinct keys (CCQ-113 AC).
      queryKeyHashFn: (queryKey) => hashKey([_currentOrgId ?? "__no_org__", ...queryKey]),
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
