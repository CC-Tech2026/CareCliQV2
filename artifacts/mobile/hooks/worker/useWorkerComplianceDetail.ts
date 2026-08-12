import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { getWorkerComplianceDetail } from "@/lib/worker-api";

export function useWorkerComplianceDetail(days: 7 | 30 = 7) {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ["worker", "compliance-detail", days],
    queryFn: () => getWorkerComplianceDetail(days),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled: isAuthenticated,
  });
}
