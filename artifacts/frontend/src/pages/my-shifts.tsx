import { useCallback, useEffect, useMemo, useState } from "react";
import { format, isSameDay, parseISO, startOfDay, subDays } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { CalendarDays, FileText, Bell } from "lucide-react";
import { Link } from "wouter";
import { ShiftListCard } from "@/components/shifts/ShiftListCard";
import { OfflineSyncBanner } from "@/components/shifts/OfflineSyncBanner";
import { listPendingActions } from "@/lib/shift-offline-queue";
import { syncAllQueuedShiftActions } from "@/lib/sync-pending-shift-actions";
import {
  getWorkerShiftCounts,
  getWorkerShifts,
  type ShiftFilter,
  type WorkerShift,
} from "@/services/shiftService";
import { cn } from "@/lib/utils";
import {
  BORDER,
  CORAL,
  greetingForHour,
  MUTED,
  PLUM,
  TEXT,
  shiftDurationMinutes,
} from "@/lib/shift-utils";

const FILTERS: { id: ShiftFilter; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

function formatGroupLabel(dateKey: string) {
  if (dateKey === "unknown") return "Unscheduled";
  const date = parseISO(`${dateKey}T12:00:00`);
  const day = startOfDay(date);
  const today = startOfDay(new Date());
  const yesterday = startOfDay(subDays(today, 1));
  const formatted = format(date, "EEE d MMM").toUpperCase();
  if (isSameDay(day, yesterday)) return `Yesterday, ${formatted}`;
  if (isSameDay(day, today)) return `Today, ${formatted}`;
  return format(date, "EEEE, d MMM").toUpperCase();
}

function ShiftFilterTabs({
  filter,
  onChange,
  counts,
}: {
  filter: ShiftFilter;
  onChange: (next: ShiftFilter) => void;
  counts?: Record<"today" | "upcoming" | "completed" | "cancelled", number>;
}) {
  return (
    <div className="rounded-2xl bg-[#F0EDF8] p-1.5">
      <div className="flex gap-1 overflow-x-auto scrollbar-none">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const count = counts?.[f.id as keyof typeof counts] ?? 0;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onChange(f.id)}
              className={cn(
                "flex flex-1 min-w-[4.5rem] items-center justify-center gap-1.5 rounded-xl px-3 py-3 text-xs font-black whitespace-nowrap transition-all",
                active ? "bg-white text-[#111827] shadow-sm" : "text-[#6B7280]",
              )}
            >
              <span>{f.label}</span>
              <span
                className="grid h-5 min-w-[1.25rem] shrink-0 place-items-center rounded-full px-1 text-[11px] font-black text-white"
                style={{ background: active ? PLUM : "#9B8EC4" }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ShiftSkeleton() {
  return (
    <div className="flex overflow-hidden rounded-2xl border bg-white p-5 animate-pulse" style={{ borderColor: BORDER }}>
      <div className="size-[3.25rem] shrink-0 rounded-full bg-slate-200" />
      <div className="ml-3.5 flex-1 space-y-2.5 pt-1">
        <div className="h-4 w-2/3 rounded-lg bg-slate-200" />
        <div className="h-3 w-1/2 rounded-lg bg-slate-100" />
        <div className="h-3 w-3/4 rounded-lg bg-slate-100" />
      </div>
    </div>
  );
}

export default function MyShifts() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ShiftFilter>("today");
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const firstName = (user?.full_name || "there").split(" ")[0];

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

  const { data, isLoading, error } = useOrgQuery(["worker", "shifts", filter], {
    queryFn: () => getWorkerShifts(filter),
  });

  const { data: countsData } = useOrgQuery(["worker", "shifts", "counts"], {
    queryFn: () => getWorkerShiftCounts(),
  });

  const list = data?.shifts ?? [];
  const filterCounts = countsData?.counts;

  const { data: todayData } = useOrgQuery(["worker", "shifts", "today"], {
    queryFn: () => getWorkerShifts("today"),
  });
  const todayShifts = todayData?.shifts ?? [];

  const completedToday = todayShifts.filter((s) => s.status === "completed").length;
  const hoursScheduled = useMemo(() => {
    const mins = todayShifts.reduce(
      (sum, s) => sum + (shiftDurationMinutes(s.scheduled_start, s.scheduled_end, s.duration_minutes) ?? 0),
      0,
    );
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) return `${h}.${Math.round((m / 60) * 10)}h`;
    if (h) return `${h}h`;
    return m ? `${m}m` : "0h";
  }, [todayShifts]);

  const dateLabel = format(new Date(), "EEEE d MMMM");

  const groupedList = useMemo(() => {
    if (filter === "today") {
      return [{ label: null as string | null, shifts: list }];
    }
    const groups = new Map<string, WorkerShift[]>();
    for (const shift of list) {
      const key = shift.scheduled_start
        ? format(parseISO(shift.scheduled_start), "yyyy-MM-dd")
        : "unknown";
      const bucket = groups.get(key) ?? [];
      bucket.push(shift);
      groups.set(key, bucket);
    }
    const sorted =
      filter === "completed"
        ? Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a))
        : Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
    return sorted.map(([key, shifts]) => ({
      label: key === "unknown" ? "Unscheduled" : formatGroupLabel(key),
      shifts,
    }));
  }, [filter, list]);

  return (
    <div className="space-y-5 pb-6">
      <header className="flex items-start justify-between gap-3 pt-1">
        <div>
          <p className="hidden" style={{ color: CORAL }}>
            Support Worker
          </p>
          <h1 className="text-xl font-black tracking-tight" style={{ color: PLUM }}>
            My Shifts
          </h1>
          <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>
            {dateLabel}
          </p>
        </div>
        <div className="shrink-0 flex items-start gap-2 pt-1">
          <Link href="/worker/messages">
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-full text-white shadow-sm hover:opacity-90 transition sm:h-auto sm:w-auto sm:gap-2 sm:px-4 sm:py-2.5 sm:rounded-full"
              style={{ background: PLUM }}
              title="View messages from coordinator"
            >
              <Bell size={18} />
              <span className="hidden sm:inline text-xs font-black">Messages</span>
            </button>
          </Link>
          <Link href="/my-shifts">
            <button
              type="button"
              className="flex h-11 items-center rounded-full px-4 text-xs font-black text-white shadow-sm hover:opacity-90 transition"
              style={{ background: CORAL }}
            >
              + Quick Start
            </button>
          </Link>
        </div>
      </header>

      <OfflineSyncBanner syncing={syncing} pendingCount={pendingCount} className="-mx-5 rounded-none sm:mx-0 sm:rounded-xl" />

      <div className="grid grid-cols-3 gap-3">
        <StatCard value={String(filterCounts?.today ?? todayShifts.length)} label="Shifts today" />
        <StatCard value={String(completedToday)} label="Completed" />
        <StatCard value={hoursScheduled} label="Hrs scheduled" />
      </div>

      <ShiftFilterTabs filter={filter} onChange={setFilter} counts={filterCounts} />

      {isLoading && (
        <div className="space-y-3">
          <ShiftSkeleton />
          <ShiftSkeleton />
        </div>
      )}

      {error && (
        <p className="text-sm font-bold text-red-600">{(error as Error).message}</p>
      )}

      {!isLoading && list.length === 0 && (
        <section
          className="rounded-2xl border bg-white px-6 py-14 text-center shadow-sm"
          style={{ borderColor: BORDER }}
        >
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F0EDF8]">
            <CalendarDays size={28} style={{ color: PLUM }} />
          </div>
          <p className="text-base font-black" style={{ color: TEXT }}>
            No {filter} shifts
          </p>
          <p className="mx-auto mt-2 max-w-xs text-sm font-medium leading-relaxed" style={{ color: MUTED }}>
            Tap Open Shift on any upcoming card to review details before you arrive.
          </p>
        </section>
      )}

      <div className="space-y-4">
        {groupedList.map((group) => (
          <div key={group.label ?? "default"} className="space-y-3">
            {group.label && (
              <p className="text-[11px] font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>
                {group.label}
              </p>
            )}
            {group.shifts.map((shift: WorkerShift) => (
              <ShiftListCard key={shift.id} shift={shift} />
            ))}
          </div>
        ))}
      </div>

      {filter === "today" && todayShifts.some((s) => s.status === "completed") && (
        <section className="flex items-start gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
            <FileText size={18} className="text-amber-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black" style={{ color: TEXT }}>
              Session notes due within 24 hours
            </p>
            <p className="mt-1 text-xs font-medium leading-relaxed text-amber-900/80">
              NDIS Practice Standard 2.3 requires documentation within 24 hours of shift completion.
            </p>
            <button
              type="button"
              className="mt-3 flex h-10 items-center rounded-full bg-amber-500 px-5 text-xs font-black text-white hover:bg-amber-600 transition-colors"
            >
              Write Notes
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border bg-white px-3 py-4 text-center shadow-sm" style={{ borderColor: BORDER }}>
      <p className="text-2xl font-black" style={{ color: PLUM }}>
        {value}
      </p>
      <p className="mt-1 text-xs font-semibold leading-tight" style={{ color: MUTED }}>
        {label}
      </p>
    </div>
  );
}
