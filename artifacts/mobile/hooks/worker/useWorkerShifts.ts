import { useQuery } from "@tanstack/react-query";

import { getWorkerShifts, type ShiftFilter } from "@/lib/worker-api";

export function useWorkerShifts(filter: ShiftFilter = "today") {
  return useQuery({
    queryKey: ["worker", "shifts", filter],
    queryFn: () => getWorkerShifts(filter),
    staleTime: 30_000,
  });
}
