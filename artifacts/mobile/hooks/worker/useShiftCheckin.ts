import { useQuery } from "@tanstack/react-query";

import { getBreakStatusByShift, getCheckinStatusByShift } from "@/lib/worker-api";

export function useShiftCheckinStatus(shiftId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["worker", "shift", shiftId, "checkin-status"],
    queryFn: () => getCheckinStatusByShift(shiftId!),
    enabled: Boolean(shiftId) && enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useShiftBreakStatus(shiftId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["worker", "shift", shiftId, "break-status"],
    queryFn: () => getBreakStatusByShift(shiftId!),
    enabled: Boolean(shiftId) && enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
