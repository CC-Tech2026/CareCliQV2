import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { getShiftReviews, getShiftReviewThread } from "@/lib/worker-api";

/** Finished shifts and where each stands with the office. The overview asks
 * for the ones still in review; history includes verified shifts too. */
export function useShiftReviews(includeVerified = false) {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ["worker", "shift-reviews", includeVerified ? "all" : "open"],
    queryFn: () => getShiftReviews(includeVerified),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled: isAuthenticated,
  });
}

export function useShiftReviewThread(shiftId: string | undefined) {
  return useQuery({
    queryKey: ["worker", "shift-review", shiftId],
    queryFn: () => getShiftReviewThread(shiftId!),
    enabled: Boolean(shiftId),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}
