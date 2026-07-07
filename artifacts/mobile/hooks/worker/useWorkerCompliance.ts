import { useQuery } from "@tanstack/react-query";

import { getMyCompliance } from "@/lib/worker-api";

export function useWorkerCompliance() {
  return useQuery({
    queryKey: ["worker", "my-compliance"],
    queryFn: getMyCompliance,
    staleTime: 120_000,
  });
}
