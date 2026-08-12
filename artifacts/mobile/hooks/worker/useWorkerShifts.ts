import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { getWorkerShifts, type ShiftFilter } from "@/lib/worker-api";

export const SHIFTS_PAGE_SIZE = 10;

export function useWorkerShifts(filter: ShiftFilter = "today") {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ["worker", "shifts", filter],
    queryFn: () => getWorkerShifts(filter),
    staleTime: 30_000,
    enabled: isAuthenticated,
  });
}

export function useWorkerShiftsInfinite(filter: ShiftFilter) {
  const { isAuthenticated } = useAuth();
  return useInfiniteQuery({
    queryKey: ["worker", "shifts", "infinite", filter],
    queryFn: async ({ pageParam }) => {
      const offset = typeof pageParam === "number" ? pageParam : 0;
      return getWorkerShifts(filter, { limit: SHIFTS_PAGE_SIZE, offset });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (lastPage.has_more === false) return undefined;
      const loaded = lastPage.shifts.length;
      if (loaded < SHIFTS_PAGE_SIZE) return undefined;
      const offset = typeof lastPageParam === "number" ? lastPageParam : 0;
      return offset + SHIFTS_PAGE_SIZE;
    },
    staleTime: 30_000,
    enabled: isAuthenticated,
  });
}
