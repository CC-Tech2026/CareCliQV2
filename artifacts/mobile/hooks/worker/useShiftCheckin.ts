import { useQuery } from "@tanstack/react-query";

import { getBreakStatusByShift, getCheckinStatusByShift } from "@/lib/worker-api";

export function useShiftCheckinStatus(shiftId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["worker", "shift", shiftId, "checkin-status"],
    queryFn: () => getCheckinStatusByShift(shiftId!),
    enabled: Boolean(shiftId) && enabled,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useShiftBreakStatus(shiftId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["worker", "shift", shiftId, "break-status"],
    queryFn: () => getBreakStatusByShift(shiftId!),
    enabled: Boolean(shiftId) && enabled,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
