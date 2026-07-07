import { useQuery } from "@tanstack/react-query";

import { getWorkerDashboard } from "@/lib/dashboard-api";

export function useWorkerDashboard() {
  return useQuery({
    queryKey: ["dashboard", "worker"],
    queryFn: getWorkerDashboard,
    staleTime: 30_000,
  });
}
