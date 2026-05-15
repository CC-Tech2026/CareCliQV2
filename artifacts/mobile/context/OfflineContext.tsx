import { useSaveSessionWithAI, useUpdateSession } from "@workspace/api-client-react";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import {
  type OfflineQueueItem,
  enqueueOfflineUpdate,
  getOfflineQueue,
  removeFromQueue,
} from "@/hooks/useOfflineCache";

interface OfflineContextValue {
  isOnline: boolean;
  pendingCount: number;
  queueNoteUpdate: (item: OfflineQueueItem) => Promise<void>;
  markOffline: () => void;
}

const OfflineContext = createContext<OfflineContextValue>({
  isOnline: true,
  pendingCount: 0,
  queueNoteUpdate: async () => {},
  markOffline: () => {},
});

export function useOffline() {
  return useContext(OfflineContext);
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { isOnline, markOffline } = useNetworkStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const updateSession = useUpdateSession();
  const saveWithAI = useSaveSessionWithAI();
  const isSyncingRef = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    const queue = await getOfflineQueue();
    setPendingCount(queue.length);
  }, []);

  useEffect(() => {
    refreshPendingCount();
  }, [refreshPendingCount]);

  const syncQueue = useCallback(async () => {
    if (isSyncingRef.current) return;
    const queue = await getOfflineQueue();
    if (queue.length === 0) return;

    isSyncingRef.current = true;
    for (const item of queue) {
      try {
        await updateSession.mutateAsync({
          sessionId: item.sessionId,
          data: {
            notes: item.notes,
            activities_performed: item.activities.join(", "),
            duration_minutes: item.durationMinutes,
            ...(item.completed ? { status: "completed" } : {}),
          },
        });
        if (item.completed) {
          try {
            await saveWithAI.mutateAsync({ sessionId: item.sessionId });
          } catch {
          }
        }
        await removeFromQueue(item.sessionId);
      } catch {
      }
    }
    isSyncingRef.current = false;
    await refreshPendingCount();
  }, [updateSession, saveWithAI, refreshPendingCount]);

  useEffect(() => {
    if (isOnline) {
      syncQueue();
    }
  }, [isOnline, syncQueue]);

  const queueNoteUpdate = useCallback(
    async (item: OfflineQueueItem) => {
      await enqueueOfflineUpdate(item);
      await refreshPendingCount();
    },
    [refreshPendingCount]
  );

  return (
    <OfflineContext.Provider
      value={{ isOnline, pendingCount, queueNoteUpdate, markOffline }}
    >
      {children}
    </OfflineContext.Provider>
  );
}
