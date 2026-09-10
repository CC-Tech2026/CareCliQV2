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
import {
  clockInShift,
  deleteSessionNote,
  endShift,
  startShiftSession,
  submitShiftSignature,
  syncSessionNotes,
  updateShiftTasks,
  uploadSessionAttachment,
  type SessionNoteRecord,
} from "@/lib/worker-api";
import { createWorkerIncident } from "@/lib/resource-api";

interface OfflineContextValue {
  isOnline: boolean;
  pendingCount: number;
  queueNoteUpdate: (item: OfflineQueueItem) => Promise<void>;
  /** Returns false if the item could not even be persisted to the queue
   * itself (e.g. AsyncStorage write failed) - callers that tell the worker
   * "saved, will sync later" must check this rather than assume it worked. */
  queueWorkerUpdate: (item: WorkerOfflineQueueItem) => Promise<boolean>;
  markOffline: () => void;
  /** Flushes the queue now and resolves with the count still pending
   * afterward (not necessarily 0 - genuinely offline/failed items stay
   * queued). Returns the fresh count directly rather than relying on
   * pendingCount state, which callers would otherwise read stale right
   * after awaiting this. Used before ending a shift so nothing is silently
   * left behind. */
  flushNow: () => Promise<number>;
}

const OfflineContext = createContext<OfflineContextValue>({
  isOnline: true,
  pendingCount: 0,
  queueNoteUpdate: async () => {},
  queueWorkerUpdate: async () => false,
  markOffline: () => {},
  flushNow: async () => 0,
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
    const count = legacy.length + worker.length;
    setPendingCount(count);
    return count;
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
        } else if (item.type === "delete_note") {
          await deleteSessionNote(item.sessionId, item.noteId);
        } else if (item.type === "submit_incident") {
          await createWorkerIncident(item.payload);
        } else if (item.type === "upload_attachment") {
          const uploaded = await uploadSessionAttachment(item.sessionId, {
            uri: item.uri,
            name: item.name,
            type: item.mimeType,
          });
          const note: SessionNoteRecord = {
            note_id: item.id,
            session_id: item.sessionId,
            task_id: item.taskId,
            content: `[Attachment: ${item.name}]`,
            note_type: item.noteType,
            file_name: item.name,
            attachment_urls: [uploaded.public_url],
            created_at: new Date(item.timestamp).toISOString(),
          };
          await syncSessionNotes(item.sessionId, [note]);
        } else if (item.type === "clock_in") {
          if (!item.clockedIn) {
            try {
              await clockInShift(item.shiftId, {
                method: item.method,
                location: item.location,
                qr_token: item.qrToken,
                client_timestamp: item.clientTimestamp,
              });
            } catch (clockInError) {
              // Don't let a startSession-only retry re-submit clock-in above
              // this catch on a future pass if it already succeeded once -
              // this failure means clock-in itself didn't go through, so
              // just re-throw and keep the whole item queued as-is.
              throw clockInError;
            }
            // Record success immediately so a startSession failure below
            // doesn't cause clock-in to be resubmitted next attempt - there's
            // no idempotency key server-side for it.
            await enqueueWorkerUpdate({ ...item, clockedIn: true });
          }
          if (item.startSession) {
            await startShiftSession(item.shiftId);
          }
        } else if (item.type === "end_shift") {
          if (!item.signatureSubmitted) {
            try {
              await submitShiftSignature(item.shiftId, item.signature);
            } catch (sigError) {
              const msg = sigError instanceof Error ? sigError.message : "";
              // Already signed on a prior attempt (e.g. this synced once
              // before but the end-shift call below failed) - fine, move on.
              if (!/already signed/i.test(msg)) throw sigError;
            }
            await enqueueWorkerUpdate({ ...item, signatureSubmitted: true });
          }
          try {
            await endShift(item.shiftId, { force: item.force, reason: item.reason });
          } catch (endError) {
            const msg = endError instanceof Error ? endError.message : "";
            if (!/already completed/i.test(msg)) throw endError;
          }
        }
        await removeWorkerQueueItem(item.id);
      } catch {
        /* keep in queue */
      }
    }
  }, []);

  const syncQueue = useCallback(async () => {
    if (isSyncingRef.current) return refreshPendingCount();
    isSyncingRef.current = true;
    try {
      await syncLegacyQueue();
      await syncWorkerQueue();
    } finally {
      isSyncingRef.current = false;
    }
    return refreshPendingCount();
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
      const ok = await enqueueWorkerUpdate(item);
      await refreshPendingCount();
      return ok;
    },
    [refreshPendingCount],
  );

  const flushNow = useCallback(async () => {
    return syncQueue();
  }, [syncQueue]);

  return (
    <OfflineContext.Provider
      value={{ isOnline, pendingCount, queueNoteUpdate, queueWorkerUpdate, markOffline, flushNow }}
    >
      {children}
    </OfflineContext.Provider>
  );
}
