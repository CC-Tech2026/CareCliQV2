import { useQuery } from "@tanstack/react-query";

import { getMyClientNdisPlan } from "@/lib/worker-api";

export function useWorkerClientNdisPlan(clientId: string | undefined) {
  return useQuery({
    queryKey: ["worker", "my-clients", clientId, "plan"],
    queryFn: () => getMyClientNdisPlan(clientId!),
    enabled: Boolean(clientId),
    staleTime: 60_000,
  });
}
