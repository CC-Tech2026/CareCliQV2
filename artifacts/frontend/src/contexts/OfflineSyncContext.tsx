import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  countPendingSyncItems,
  listSyncQueueItems,
  syncAllPendingItems,
  type SyncQueueItem,
} from "@/lib/offline-sync-registry";
import type { SyncItemResult } from "@/lib/sync-pending-shift-actions";

export type SyncVisualState = "offline" | "syncing" | "synced";

type OfflineSyncContextValue = {
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  visualState: SyncVisualState;
  queueItems: SyncQueueItem[];
  lastResults: SyncItemResult[];
  refresh: () => Promise<void>;
  retryAll: () => Promise<{ results: SyncItemResult[]; synced: number; failed: number } | undefined>;
  activeShiftId: string | null;
  setActiveShiftId: (shiftId: string | null) => void;
};

const OfflineSyncContext = createContext<OfflineSyncContextValue | null>(null);

export function OfflineSyncProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [queueItems, setQueueItems] = useState<SyncQueueItem[]>([]);
  const [lastResults, setLastResults] = useState<SyncItemResult[]>([]);
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  const isSyncingRef = useRef(false);

  const refresh = useCallback(async () => {
    const [count, items] = await Promise.all([countPendingSyncItems(), listSyncQueueItems()]);
    setPendingCount(count);
    setQueueItems(items);
  }, []);

  const retryAll = useCallback(async () => {
    if (isSyncingRef.current || !online) return { results: [], synced: 0, failed: 0 };
    isSyncingRef.current = true;
    setSyncing(true);
    try {
      const result = await syncAllPendingItems();
      setLastResults(result.results);
      if (result.synced > 0) {
        void queryClient.invalidateQueries({ queryKey: ["worker", "shifts"] });
      }
      return result;
    } finally {
      isSyncingRef.current = false;
      setSyncing(false);
      await refresh();
    }
  }, [online, queryClient, refresh]);

  useEffect(() => {
    void refresh();
    const onOnline = () => {
      setOnline(true);
      void retryAll();
    };
    const onOffline = () => setOnline(false);
    const onUpdated = () => void refresh();

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("offline-sync-updated", onUpdated);
    window.addEventListener("evidence-sync-updated", onUpdated);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("offline-sync-updated", onUpdated);
      window.removeEventListener("evidence-sync-updated", onUpdated);
    };
  }, [refresh, retryAll]);

  const visualState: SyncVisualState = useMemo(() => {
    if (!online) return "offline";
    if (syncing || pendingCount > 0) return "syncing";
    return "synced";
  }, [online, syncing, pendingCount]);

  const value = useMemo(
    () => ({
      online,
      syncing,
      pendingCount,
      visualState,
      queueItems,
      lastResults,
      refresh,
      retryAll,
      activeShiftId,
      setActiveShiftId,
    }),
    [
      online,
      syncing,
      pendingCount,
      visualState,
      queueItems,
      lastResults,
      refresh,
      retryAll,
      activeShiftId,
    ],
  );

  return <OfflineSyncContext.Provider value={value}>{children}</OfflineSyncContext.Provider>;
}

export function useOfflineSync() {
  const ctx = useContext(OfflineSyncContext);
  if (!ctx) {
    throw new Error("useOfflineSync must be used within OfflineSyncProvider");
  }
  return ctx;
}

export function useOfflineSyncOptional() {
  return useContext(OfflineSyncContext);
}
