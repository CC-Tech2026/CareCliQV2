import { useQuery } from "@tanstack/react-query";

import { getCheckinStatusByShift } from "@/lib/worker-api";

export function useShiftCheckinStatus(shiftId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["worker", "shift", shiftId, "checkin-status"],
    queryFn: () => getCheckinStatusByShift(shiftId!),
    enabled: Boolean(shiftId) && enabled,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
