import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { getWorkerLandingDashboard } from "@/lib/dashboard-api";

export function useWorkerLandingDashboard() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ["dashboard", "worker-landing"],
    queryFn: getWorkerLandingDashboard,
    staleTime: 30_000,
    enabled: isAuthenticated,
  });
}
