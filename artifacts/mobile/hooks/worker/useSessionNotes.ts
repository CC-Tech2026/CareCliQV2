import { useQuery } from "@tanstack/react-query";

import { cacheSessionNotes, getCachedSessionNotes } from "@/hooks/useOfflineCache";
import { listSessionNotes, type SessionNoteRecord } from "@/lib/worker-api";

export function useSessionNotes(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["worker", "session", sessionId, "notes"],
    queryFn: async () => {
      try {
        const notes = await listSessionNotes(sessionId!);
        void cacheSessionNotes(sessionId!, notes);
        return notes;
      } catch (err) {
        const cached = await getCachedSessionNotes<SessionNoteRecord>(sessionId!);
        if (cached) return cached;
        throw err;
      }
    },
    enabled: Boolean(sessionId),
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
}
