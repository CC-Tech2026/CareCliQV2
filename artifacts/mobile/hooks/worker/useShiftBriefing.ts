import { useQuery } from "@tanstack/react-query";

import { getShiftBriefing } from "@/lib/worker-api";

export function useShiftBriefing(shiftId: string | undefined) {
  return useQuery({
    queryKey: ["worker", "shift", shiftId, "briefing"],
    queryFn: () => getShiftBriefing(shiftId!),
    enabled: Boolean(shiftId),
    staleTime: 30_000,
  });
}
