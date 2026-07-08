import { useQuery } from "@tanstack/react-query";

import { cacheWorkerShift, getCachedWorkerShift } from "@/hooks/useOfflineCache";
import { getWorkerShift, type WorkerShift } from "@/lib/worker-api";

export function useWorkerShift(shiftId: string | undefined) {
  return useQuery({
    queryKey: ["worker", "shift", shiftId],
    queryFn: async () => {
      try {
        const shift = await getWorkerShift(shiftId!);
        void cacheWorkerShift(shiftId!, shift);
        return shift;
      } catch (err) {
        const cached = await getCachedWorkerShift<WorkerShift>(shiftId!);
        if (cached) return cached;
        throw err;
      }
    },
    enabled: Boolean(shiftId),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
