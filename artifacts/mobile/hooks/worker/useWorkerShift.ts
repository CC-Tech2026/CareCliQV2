import { useQuery } from "@tanstack/react-query";

import { getWorkerShift } from "@/lib/worker-api";

export function useWorkerShift(shiftId: string | undefined) {
  return useQuery({
    queryKey: ["worker", "shift", shiftId],
    queryFn: () => getWorkerShift(shiftId!),
    enabled: Boolean(shiftId),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
