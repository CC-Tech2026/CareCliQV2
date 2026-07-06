import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { ShiftListCard } from "@/components/shifts/ShiftListCard";
import { OfflineSyncBanner } from "@/components/shifts/OfflineSyncBanner";
import { listPendingActions } from "@/lib/shift-offline-queue";
import { syncAllQueuedShiftActions } from "@/lib/sync-pending-shift-actions";
import { getWorkerShifts, type WorkerShift } from "@/services/shiftService";
import {
  getPrimaryTodayShiftId,
  sortTodayShiftsForList,
} from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

function ShiftSkeleton() {
  return (
    <div className="flex animate-pulse overflow-hidden rounded-2xl border border-cc-border bg-cc-surface p-5 shadow-sm">
      <div className="size-[3.25rem] shrink-0 rounded-full bg-cc-soft" />
      <div className="ml-3.5 flex-1 space-y-2.5 pt-1">
        <div className="h-4 w-2/3 rounded-lg bg-cc-soft" />
        <div className="h-3 w-1/2 rounded-lg bg-cc-soft" />
        <div className="h-3 w-3/4 rounded-lg bg-cc-soft" />
      </div>
    </div>
  );
}

export default function MyShifts() {
  const { translate } = useAccessibility();
  const queryClient = useQueryClient();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [nowTick, setNowTick] = useState(0);

  const refreshPendingCount = useCallback(async () => {
    const actions = await listPendingActions();
    setPendingCount(actions.length);
  }, []);

  const runPendingSync = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await refreshPendingCount();
      return;
    }
    setSyncing(true);
    try {
      const result = await syncAllQueuedShiftActions();
      if (result.synced > 0) {
        void queryClient.invalidateQueries({ queryKey: ["worker", "shifts"] });
      }
    } finally {
      setSyncing(false);
      await refreshPendingCount();
    }
  }, [queryClient, refreshPendingCount]);

  useEffect(() => {
    void runPendingSync();
    const onOnline = () => void runPendingSync();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [runPendingSync]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const { data, isLoading, error } = useOrgQuery(["worker", "shifts", "today"], {
    queryFn: () => getWorkerShifts("today"),
  });

  const { sortedShifts, primaryShiftId } = useMemo(() => {
    const list = data?.shifts ?? [];
    void nowTick;
    const now = new Date();
    return {
      sortedShifts: sortTodayShiftsForList(list, now),
      primaryShiftId: getPrimaryTodayShiftId(list, now),
    };
  }, [data?.shifts, nowTick]);

  return (
    <div className="space-y-4 pb-6">
      <OfflineSyncBanner syncing={syncing} pendingCount={pendingCount} className="-mx-5 rounded-none sm:mx-0 sm:rounded-xl" />

      {isLoading && (
        <div className="space-y-3">
          <ShiftSkeleton />
          <ShiftSkeleton />
        </div>
      )}

      {error && (
        <p className="text-sm font-bold text-red-600">{(error as Error).message}</p>
      )}

      {!isLoading && sortedShifts.length === 0 && (
        <section className="rounded-2xl border border-cc-border bg-cc-surface px-6 py-14 text-center shadow-sm">
          <div className="cc-plum-panel mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
            <CalendarDays size={28} className="text-cc-plum" />
          </div>
          <p className="text-base font-black text-cc-text">
            {translate("shifts.empty")}
          </p>
        </section>
      )}

      <div className="space-y-3" data-tutorial="shift-list">
        {sortedShifts.map((shift: WorkerShift) => (
          <ShiftListCard
            key={shift.id}
            shift={shift}
            showActions={shift.id === primaryShiftId}
          />
        ))}
      </div>
    </div>
  );
}
