// CCQ-113 — Shared QueryClient with org-scoped cache keys.
//
// Every cache entry is keyed under the current org_id via a custom
// queryKeyHashFn.  This means Org A's cached data can never be served
// to Org B — even if a user switches orgs in the same browser tab.
// queryClient.clear() is called on logout (see AuthContext) to purge
// all entries regardless.

import { MutationCache, QueryClient, hashKey, type Query } from "@tanstack/react-query";

let _currentOrgId: string | null = null;

/** Called by AuthContext when a session is established or refreshed. */
export function setQueryOrgId(orgId: string | null): void {
  _currentOrgId = orgId;
}

/** Default cache window for list/dashboard reads (reduces repeat API load while browsing). */
export const DEFAULT_QUERY_STALE_MS = 60_000;

/** Dashboard and summary queries (counts, KPI tiles, badges). Any successful
 * save can change these numbers, so they're refreshed after every mutation
 * instead of each form having to know which dashboards exist. Detail and
 * list queries are left to each mutation's own invalidation so forms that
 * are mid-edit aren't overwritten. */
export const SUMMARY_QUERY_ROOTS = new Set<string>([
  "dashboard",
  "md",
  "incident-stats",
  "compliance-centre",
  "care-alerts",
  "coordinator-credential-alerts",
  "coordinator-flagged-sessions",
  "coordinator-notifications",
]);

export function isSummaryQuery(query: Pick<Query, "queryKey">): boolean {
  const [first, second] = query.queryKey as unknown[];
  // useOrgQuery keys start with the orgId; plain useQuery keys don't.
  const root = typeof first === "string" && first === _currentOrgId ? second : first;
  return typeof root === "string" && SUMMARY_QUERY_ROOTS.has(root);
}

/** HTTP status of a failed request: `error.status` (jsonFetch, loadErrorFrom),
 * else the "Request failed with 404" message several query functions throw. */
export function requestStatus(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const s = Number((error as { status: unknown }).status);
    if (Number.isFinite(s) && s > 0) return s;
  }
  const match = error instanceof Error ? /Request failed with (\d{3})/.exec(error.message) : null;
  return match ? Number(match[1]) : null;
}

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: () => {
      void queryClient.invalidateQueries({ predicate: isSummaryQuery });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_QUERY_STALE_MS,
      gcTime: 5 * 60_000,
      // Returning to the tab refetches anything older than staleTime, so
      // changes made by someone else (or in another tab) show up without a
      // manual page refresh. Fresh data (< staleTime) is not refetched.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // Prefix every cache hash with the current org_id so entries from
      // different orgs are stored under distinct keys (CCQ-113 AC).
      queryKeyHashFn: (queryKey) => hashKey([_currentOrgId ?? "__no_org__", ...queryKey]),
      retry: (failureCount, error: unknown) => {
        // A 4xx won't change on retry (not found, not allowed, bad input), so
        // show the error now instead of sitting on a skeleton for seconds —
        // e.g. an endpoint the deployed API doesn't have yet. Timeouts and
        // rate limits can succeed later.
        const status = requestStatus(error);
        if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
        return failureCount < 2;
      },
    },
  },
});
