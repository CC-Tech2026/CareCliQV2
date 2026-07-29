import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { getMyCompliance } from "@/lib/worker-api";

export const COMPLIANCE_SESSIONS_PAGE_SIZE = 10;

export function useWorkerCompliance() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ["worker", "my-compliance", "overview"],
    queryFn: () => getMyCompliance({ sessionsLimit: 0 }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled: isAuthenticated,
  });
}

export function useWorkerComplianceSessionsInfinite() {
  const { isAuthenticated } = useAuth();
  return useInfiniteQuery({
    queryKey: ["worker", "my-compliance", "sessions"],
    queryFn: async ({ pageParam }) => {
      const offset = typeof pageParam === "number" ? pageParam : 0;
      return getMyCompliance({
        sessionsLimit: COMPLIANCE_SESSIONS_PAGE_SIZE,
        sessionsOffset: offset,
      });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      const loaded = lastPage.sessions?.length ?? 0;
      if (loaded < COMPLIANCE_SESSIONS_PAGE_SIZE) return undefined;
      const offset = typeof lastPageParam === "number" ? lastPageParam : 0;
      const total = lastPage.sessions_total ?? 0;
      if (offset + loaded >= total) return undefined;
      return offset + COMPLIANCE_SESSIONS_PAGE_SIZE;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled: isAuthenticated,
  });
}
