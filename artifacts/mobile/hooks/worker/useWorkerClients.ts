import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { getMyClients } from "@/lib/worker-api";

export function useWorkerClients() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ["worker", "my-clients"],
    queryFn: getMyClients,
    staleTime: 60_000,
    enabled: isAuthenticated,
  });
}
