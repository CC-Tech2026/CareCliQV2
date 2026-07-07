import { useQuery } from "@tanstack/react-query";

import { getMyClientDetail } from "@/lib/worker-api";

export function useWorkerClientDetail(clientId: string | undefined) {
  return useQuery({
    queryKey: ["worker", "my-clients", clientId],
    queryFn: () => getMyClientDetail(clientId!),
    enabled: Boolean(clientId),
    staleTime: 60_000,
  });
}
