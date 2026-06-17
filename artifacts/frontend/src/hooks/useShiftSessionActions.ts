import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { persistSessionTimerStart } from "@/hooks/useShiftTimer";
import {
  enqueueStartSession,
  getPendingStartSession,
  migrateLegacyPendingStartSession,
  removePendingAction,
  syncPendingActions,
} from "@/lib/shift-offline-queue";
import {
  clearPendingStartSession,
  startSessionById,
  startShiftSession,
  type WorkerShift,
} from "@/services/shiftService";

type Options = {
  shiftId: string;
  orgId: string;
  shift?: WorkerShift | null;
  onTasksUpdated?: (tasks: WorkerShift["tasks"]) => void;
  onSessionStarted?: () => void;
};

/**
 * Session start/sync actions (CARECLIQV2-243 equivalent without Redux).
 */
export function useShiftSessionActions({
  shiftId,
  orgId,
  shift,
  onTasksUpdated,
  onSessionStarted,
}: Options) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const shiftQueryKey = [orgId, "worker", "shift", shiftId] as const;

  const [instantSessionActive, setInstantSessionActive] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const applyShiftToCache = useCallback(
    (next: WorkerShift) => {
      queryClient.setQueryData(shiftQueryKey, next);
    },
    [queryClient, shiftQueryKey],
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["worker", "shifts"] });
    void queryClient.invalidateQueries({ queryKey: ["worker", "shift", shiftId] });
  }, [queryClient, shiftId]);

  const refreshPendingCount = useCallback(async () => {
    const pending = await getPendingStartSession(shiftId);
    setPendingCount(pending ? 1 : 0);
  }, [shiftId]);

  const processPendingAction = useCallback(
    async (action: { shiftId: string; sessionId?: string | null; startedAt: string }) => {
      if (action.sessionId) {
        const result = await startSessionById(action.sessionId, { startedAt: action.startedAt });
        if (result.shift) {
          applyShiftToCache(result.shift);
          onTasksUpdated?.(result.shift.tasks ?? []);
        }
        persistSessionTimerStart(action.sessionId, action.startedAt);
        return;
      }
      const updated = await startShiftSession(action.shiftId);
      applyShiftToCache(updated);
      onTasksUpdated?.(updated.tasks ?? []);
      if (updated.session_id) {
        persistSessionTimerStart(updated.session_id, action.startedAt);
      }
    },
    [applyShiftToCache, onTasksUpdated],
  );

  const syncPending = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    await migrateLegacyPendingStartSession(shiftId);
    const pending = await getPendingStartSession(shiftId);
    if (!pending && shift?.visual_state === "session_active") {
      clearPendingStartSession(shiftId);
      await refreshPendingCount();
      return;
    }
    if (!pending) {
      await refreshPendingCount();
      return;
    }
    if (shift?.visual_state === "session_active") {
      await removePendingAction(pending.id);
      clearPendingStartSession(shiftId);
      await refreshPendingCount();
      return;
    }

    setSyncing(true);
    try {
      await processPendingAction(pending);
      await removePendingAction(pending.id);
      clearPendingStartSession(shiftId);
      invalidate();
      onSessionStarted?.();
      await refreshPendingCount();
      toast({
        title: "Session synced",
        description: "Start session saved to server.",
      });
    } catch {
      await refreshPendingCount();
    } finally {
      setSyncing(false);
    }
  }, [
    shiftId,
    shift?.visual_state,
    processPendingAction,
    invalidate,
    onSessionStarted,
    refreshPendingCount,
    toast,
  ]);

  useEffect(() => {
    void migrateLegacyPendingStartSession(shiftId).then(() => refreshPendingCount());
  }, [shiftId, refreshPendingCount]);

  useEffect(() => {
    const onOnline = () => {
      void syncPending();
    };
    window.addEventListener("online", onOnline);
    void syncPending();
    return () => window.removeEventListener("online", onOnline);
  }, [syncPending]);

  const startSession = useCallback(async () => {
    if (!shift) return { ok: false as const };

    const startedAt = new Date().toISOString();
    setInstantSessionActive(true);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await enqueueStartSession({ shiftId: shift.id, startedAt });
      await refreshPendingCount();
      toast({
        title: "Offline",
        description: "Session started locally — will sync when online.",
      });
      return { ok: true as const, offline: true };
    }

    try {
      const updated = await startShiftSession(shift.id);
      clearPendingStartSession(shift.id);
      setInstantSessionActive(false);
      applyShiftToCache(updated);
      onTasksUpdated?.(updated.tasks ?? []);
      if (updated.session_id) {
        persistSessionTimerStart(updated.session_id, updated.session_started_at ?? startedAt);
      }
      invalidate();
      onSessionStarted?.();
      toast({
        title: "Session started!",
        description: `Session started with ${shift.participant_name ?? "participant"}.`,
      });
      await refreshPendingCount();
      return { ok: true as const, shift: updated };
    } catch (err) {
      setInstantSessionActive(false);
      await enqueueStartSession({ shiftId: shift.id, startedAt, sessionId: shift.session_id });
      await refreshPendingCount();
      toast({
        title: "Failed to start session",
        description: (err as Error).message || "Check your connection and try again.",
        variant: "destructive",
      });
      return { ok: false as const, error: err };
    }
  }, [
    shift,
    shiftId,
    applyShiftToCache,
    invalidate,
    onSessionStarted,
    onTasksUpdated,
    refreshPendingCount,
    toast,
  ]);

  const syncAllPending = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    setSyncing(true);
    try {
      await syncPendingActions(async (action) => {
        if (action.type !== "start_session") return;
        await processPendingAction(action);
      });
      await refreshPendingCount();
    } finally {
      setSyncing(false);
    }
  }, [processPendingAction, refreshPendingCount]);

  return {
    instantSessionActive,
    setInstantSessionActive,
    startSession,
    syncPending,
    syncAllPending,
    syncing,
    pendingCount,
    applyShiftToCache,
    invalidate,
  };
}
