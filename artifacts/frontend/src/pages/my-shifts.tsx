import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { ShiftListCard } from "@/components/shifts/ShiftListCard";
import { OfflineSyncBanner } from "@/components/shifts/OfflineSyncBanner";
import { listPendingActions } from "@/lib/shift-offline-queue";
import { syncAllQueuedShiftActions } from "@/lib/sync-pending-shift-actions";
import {
  getWorkerShifts,
  getWorkerShiftCounts,
  type WorkerShift,
} from "@/services/shiftService";
import {
  getPrimaryTodayShiftId,
  sortTodayShiftsForList,
} from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useAuth } from "@/contexts/AuthContext";

type CountFilter = "today" | "upcoming" | "completed" | "cancelled";

const FILTER_TABS: { id: CountFilter; labelKey: string }[] = [
  { id: "today", labelKey: "shifts.filter.today" },
  { id: "completed", labelKey: "shifts.filter.completed" },
];

function shiftMinutes(shift: WorkerShift): number {
  if (typeof shift.duration_minutes === "number" && shift.duration_minutes > 0) {
    return shift.duration_minutes;
  }
  if (shift.scheduled_start && shift.scheduled_end) {
    const ms = new Date(shift.scheduled_end).getTime() - new Date(shift.scheduled_start).getTime();
    return ms > 0 ? Math.round(ms / 60000) : 0;
  }
  return 0;
}

function formatHours(mins: number): string {
  if (mins <= 0) return "0h";
  const hours = mins / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

function ShiftSkeleton() {
  return (
    <div className="flex animate-pulse overflow-hidden rounded-2xl border-0 bg-card p-5 shadow-sm">
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
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [nowTick, setNowTick] = useState(0);
  const [activeFilter, setActiveFilter] = useState<CountFilter>("today");

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

  const todayQuery = useOrgQuery(["worker", "shifts", "today"], {
    queryFn: () => getWorkerShifts("today"),
  });

  const filterQuery = useOrgQuery(["worker", "shifts", activeFilter], {
    queryFn: () => getWorkerShifts(activeFilter),
    enabled: activeFilter !== "today",
  });

  const countsQuery = useOrgQuery(["worker", "shifts", "counts"], {
    queryFn: () => getWorkerShiftCounts(),
  });

  const listQuery = activeFilter === "today" ? todayQuery : filterQuery;
  const counts = countsQuery.data?.counts;

  const firstName = (user?.full_name || translate("hub.header.greetingFallback")).split(" ")[0];
  const dateLabel = format(new Date(), "EEEE d MMMM");
  const greetingKey = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return "common.greeting.morning";
    if (hour < 18) return "common.greeting.afternoon";
    return "common.greeting.evening";
  })();

  const hoursScheduled = useMemo(() => {
    const list = todayQuery.data?.shifts ?? [];
    return formatHours(list.reduce((sum, s) => sum + shiftMinutes(s), 0));
  }, [todayQuery.data?.shifts]);

  const { sortedShifts, primaryShiftId } = useMemo(() => {
    const list = listQuery.data?.shifts ?? [];
    void nowTick;
    const now = new Date();
    return {
      sortedShifts: sortTodayShiftsForList(list, now),
      primaryShiftId: getPrimaryTodayShiftId(list, now),
    };
  }, [listQuery.data?.shifts, nowTick]);

  return (
    <div className="space-y-4 pb-6">
      <OfflineSyncBanner syncing={syncing} pendingCount={pendingCount} className="-mx-5 rounded-none sm:mx-0 sm:rounded-xl" />

      {/* Greeting header */}
      <header className="pt-1">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cc-plum">
          {translate("common.supportWorker")}
        </p>
        <h1 className="mt-0.5 text-2xl font-black tracking-tight text-cc-text">
          {translate(greetingKey)}, {firstName} 👋
        </h1>
        <p className="mt-1 text-sm font-medium text-cc-muted">{dateLabel}</p>
      </header>

      {/* Key stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border-0 bg-card px-4 py-4 text-center" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)" }}>
          <p className="text-2xl font-black text-cc-plum">{counts?.today ?? 0}</p>
          <p className="mt-1 text-xs font-semibold leading-tight text-cc-muted">{translate("shifts.shiftsToday")}</p>
        </div>
        <div className="rounded-2xl border-0 bg-card px-4 py-4 text-center" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)" }}>
          <p className="text-2xl font-black text-cc-plum">{counts?.completed ?? 0}</p>
          <p className="mt-1 text-xs font-semibold leading-tight text-cc-muted">{translate("shifts.completedToday")}</p>
        </div>
        <div className="rounded-2xl border-0 bg-card px-4 py-4 text-center" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)" }}>
          <p className="text-2xl font-black text-cc-plum">{hoursScheduled}</p>
          <p className="mt-1 text-xs font-semibold leading-tight text-cc-muted">{translate("shifts.hrsScheduled")}</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 rounded-full bg-cc-soft p-1">
        {FILTER_TABS.map(({ id, labelKey }) => {
          const active = activeFilter === id;
          const count = counts?.[id] ?? 0;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveFilter(id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-bold transition ${
                active ? "bg-card text-cc-text shadow-sm" : "text-cc-muted hover:text-cc-text"
              }`}
            >
              {translate(labelKey)}
              {count > 0 && (
                <span
                  className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-black ${
                    active ? "bg-cc-plum text-white" : "bg-cc-border text-cc-muted"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {listQuery.isLoading && (
        <div className="space-y-3">
          <ShiftSkeleton />
          <ShiftSkeleton />
        </div>
      )}

      {listQuery.error && (
        <p className="text-sm font-bold text-red-600">{(listQuery.error as Error).message}</p>
      )}

      {!listQuery.isLoading && sortedShifts.length === 0 && (
        <section className="rounded-2xl border-0 bg-card px-6 py-14 text-center shadow-sm">
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
            showActions={activeFilter === "today" && shift.id === primaryShiftId}
          />
        ))}
      </div>
    </div>
  );
}
