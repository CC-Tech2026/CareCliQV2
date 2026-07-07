import { useQuery } from "@tanstack/react-query";

import { listSessionNotes } from "@/lib/worker-api";

export function useSessionNotes(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["worker", "session", sessionId, "notes"],
    queryFn: () => listSessionNotes(sessionId!),
    enabled: Boolean(sessionId),
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
}
