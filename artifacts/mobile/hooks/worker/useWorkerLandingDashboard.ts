import { useQuery } from "@tanstack/react-query";

import { getWorkerLandingDashboard } from "@/lib/dashboard-api";

export function useWorkerLandingDashboard() {
  return useQuery({
    queryKey: ["dashboard", "worker-landing"],
    queryFn: getWorkerLandingDashboard,
    staleTime: 30_000,
  });
}
