import { useCallback, useEffect, useState } from "react";
import {
  countPendingEvidence,
  subscribeEvidenceSync,
  syncEvidenceUploadQueue,
  type EvidenceSyncSnapshot,
} from "@/lib/evidence-upload-queue";

const EMPTY: EvidenceSyncSnapshot = {
  pending: 0,
  failed: 0,
  syncing: false,
  lastSyncedCount: 0,
  lastError: null,
};

export function useEvidenceSync(sessionId?: string | null) {
  const [snapshot, setSnapshot] = useState<EvidenceSyncSnapshot>(EMPTY);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setSnapshot(EMPTY);
      return EMPTY;
    }
    const counts = await countPendingEvidence(sessionId);
    setSnapshot((prev) => ({
      ...prev,
      pending: counts.pending,
      failed: counts.failed,
    }));
    return counts;
  }, [sessionId]);

  const retrySync = useCallback(async () => {
    if (!sessionId) return EMPTY;
    const result = await syncEvidenceUploadQueue(sessionId, { force: true });
    setSnapshot(result);
    return result;
  }, [sessionId]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    void refresh();
    const unsub = subscribeEvidenceSync(sessionId, setSnapshot);
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (detail?.sessionId === sessionId) void refresh();
    };
    window.addEventListener("evidence-sync-updated", onUpdated);
    return () => {
      unsub();
      window.removeEventListener("evidence-sync-updated", onUpdated);
    };
  }, [sessionId, refresh]);

  useEffect(() => {
    if (!sessionId || !online) return;
    void syncEvidenceUploadQueue(sessionId);
  }, [sessionId, online]);

  return {
    online,
    snapshot,
    retrySync,
    refresh,
    showBanner:
      Boolean(sessionId) &&
      (!online || snapshot.syncing || snapshot.pending > 0 || snapshot.failed > 0),
  };
}
