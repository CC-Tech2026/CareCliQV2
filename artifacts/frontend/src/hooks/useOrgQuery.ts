import { useQuery, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

type OrgQueryKey = readonly [string, ...unknown[]];

/**
 * CCQ-113c — Drop-in replacement for useQuery that auto-prepends the current
 * organisation_id to the query key.
 *
 * The global queryKeyHashFn in QueryClient already namespaces all cache entries
 * by org_id, so this hook is an ergonomic complement: it makes the org scope
 * explicit in the key array, which helps with targeted invalidation
 * (e.g. queryClient.invalidateQueries({ queryKey: [orgId, "sessions"] })).
 *
 * Usage:
 *   useOrgQuery(["sessions", patientId], fetchFn)
 *   // becomes queryKey: [orgId, "sessions", patientId]
 */
export function useOrgQuery<TData = unknown, TError = Error>(
  key: readonly unknown[],
  options: Omit<UseQueryOptions<TData, TError, TData, OrgQueryKey>, "queryKey">,
): UseQueryResult<TData, TError> {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const orgScopedKey = [orgId, ...key] as const;

  return useQuery<TData, TError, TData, OrgQueryKey>({
    ...options,
    queryKey: orgScopedKey,
    // Prevent fetching when org context is not yet available
    enabled: !!user?.organizationId && (options.enabled !== false),
  });
}
