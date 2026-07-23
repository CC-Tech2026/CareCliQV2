import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { getWorkerDashboard } from "@/lib/dashboard-api";

export function useWorkerDashboard() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ["dashboard", "worker"],
    queryFn: getWorkerDashboard,
    staleTime: 30_000,
    enabled: isAuthenticated,
  });
}
