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
  type WorkerOfflineQueueItem,
  enqueueOfflineUpdate,
  enqueueWorkerUpdate,
  getOfflineQueue,
  getWorkerOfflineQueue,
  removeFromQueue,
  removeWorkerQueueItem,
} from "@/hooks/useOfflineCache";
import { clockInShift, startShiftSession, syncSessionNotes, updateShiftTasks } from "@/lib/worker-api";

interface OfflineContextValue {
  isOnline: boolean;
  pendingCount: number;
  queueNoteUpdate: (item: OfflineQueueItem) => Promise<void>;
  queueWorkerUpdate: (item: WorkerOfflineQueueItem) => Promise<void>;
  markOffline: () => void;
}

const OfflineContext = createContext<OfflineContextValue>({
  isOnline: true,
  pendingCount: 0,
  queueNoteUpdate: async () => {},
  queueWorkerUpdate: async () => {},
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
    const [legacy, worker] = await Promise.all([getOfflineQueue(), getWorkerOfflineQueue()]);
    setPendingCount(legacy.length + worker.length);
  }, []);

  useEffect(() => {
    refreshPendingCount();
  }, [refreshPendingCount]);

  const syncLegacyQueue = useCallback(async () => {
    const queue = await getOfflineQueue();
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
            /* noop */
          }
        }
        await removeFromQueue(item.sessionId);
      } catch {
        /* keep in queue */
      }
    }
  }, [updateSession, saveWithAI]);

  const syncWorkerQueue = useCallback(async () => {
    const queue = await getWorkerOfflineQueue();
    for (const item of queue) {
      try {
        if (item.type === "sync_notes") {
          await syncSessionNotes(item.sessionId, item.notes);
        } else if (item.type === "update_tasks") {
          await updateShiftTasks(item.shiftId, item.tasks);
        } else if (item.type === "clock_in") {
          await clockInShift(item.shiftId, {
            method: item.method,
            location: item.location,
            qr_token: item.qrToken,
            client_timestamp: item.clientTimestamp,
          });
          if (item.startSession) {
            await startShiftSession(item.shiftId);
          }
        }
        await removeWorkerQueueItem(item.id);
      } catch {
        /* keep in queue */
      }
    }
  }, []);

  const syncQueue = useCallback(async () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    try {
      await syncLegacyQueue();
      await syncWorkerQueue();
    } finally {
      isSyncingRef.current = false;
      await refreshPendingCount();
    }
  }, [syncLegacyQueue, syncWorkerQueue, refreshPendingCount]);

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
    [refreshPendingCount],
  );

  const queueWorkerUpdate = useCallback(
    async (item: WorkerOfflineQueueItem) => {
      await enqueueWorkerUpdate(item);
      await refreshPendingCount();
    },
    [refreshPendingCount],
  );

  return (
    <OfflineContext.Provider
      value={{ isOnline, pendingCount, queueNoteUpdate, queueWorkerUpdate, markOffline }}
    >
      {children}
    </OfflineContext.Provider>
  );
}
