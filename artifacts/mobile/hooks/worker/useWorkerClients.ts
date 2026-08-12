import { useQuery } from "@tanstack/react-query";

import { getMyClients } from "@/lib/worker-api";

export function useWorkerClients() {
  return useQuery({
    queryKey: ["worker", "my-clients"],
    queryFn: getMyClients,
    staleTime: 60_000,
  });
}
