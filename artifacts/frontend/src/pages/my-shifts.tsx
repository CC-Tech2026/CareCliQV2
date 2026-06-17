import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { CalendarDays, FileText } from "lucide-react";
import { ShiftListCard } from "@/components/shifts/ShiftListCard";
import { OfflineSyncBanner } from "@/components/shifts/OfflineSyncBanner";
import { listPendingActions } from "@/lib/shift-offline-queue";
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

function ShiftSkeleton() {
  return (
    <div className="flex overflow-hidden rounded-2xl border bg-white p-4 animate-pulse" style={{ borderColor: BORDER }}>
      <div className="h-11 w-11 rounded-full bg-slate-200" />
      <div className="ml-3 flex-1 space-y-2">
        <div className="h-4 w-2/3 rounded bg-slate-200" />
        <div className="h-3 w-1/2 rounded bg-slate-100" />
        <div className="h-3 w-3/4 rounded bg-slate-100" />
      </div>
    </div>
  );
}

export default function MyShifts() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<ShiftFilter>("today");
  const [pendingCount, setPendingCount] = useState(0);
  const firstName = (user?.full_name || "there").split(" ")[0];

  useEffect(() => {
    void listPendingActions().then((actions) => setPendingCount(actions.length));
    const onOnline = () => {
      void listPendingActions().then((actions) => setPendingCount(actions.length));
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

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

  return (
    <div className="mx-auto max-w-lg space-y-5 pb-10">
      <header>
        <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: CORAL }}>
          Support Worker
        </p>
        <h1 className="mt-1 text-2xl font-black tracking-tight" style={{ color: TEXT }}>
          {greetingForHour()}, {firstName}
        </h1>
        <p className="mt-0.5 text-sm font-semibold" style={{ color: MUTED }}>
          {dateLabel}
        </p>
      </header>

      <OfflineSyncBanner pendingCount={pendingCount} className="-mx-4 rounded-none sm:mx-0 sm:rounded-xl" />

      <div className="grid grid-cols-3 gap-2">
        <StatCard value={String(filterCounts?.today ?? todayShifts.length)} label="Shifts today" />
        <StatCard value={String(completedToday)} label="Completed" />
        <StatCard value={hoursScheduled} label="Hrs scheduled" />
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {FILTERS.map((f) => {
          const count = filterCounts?.[f.id as keyof typeof filterCounts] ?? 0;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "shrink-0 rounded-full px-4 py-2 text-xs font-black transition",
                filter === f.id ? "text-white shadow-sm" : "bg-white border",
              )}
              style={{
                background: filter === f.id ? PLUM : undefined,
                color: filter === f.id ? "#fff" : MUTED,
                borderColor: filter === f.id ? PLUM : BORDER,
              }}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>

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
          className="rounded-2xl border bg-white px-6 py-10 text-center shadow-sm"
          style={{ borderColor: BORDER }}
        >
          <CalendarDays size={36} className="mx-auto mb-3 opacity-40" style={{ color: MUTED }} />
          <p className="text-base font-black" style={{ color: TEXT }}>
            No {filter} shifts
          </p>
          <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>
            Select a shift and tap Open Shift to review details before you arrive.
          </p>
        </section>
      )}

      <div className="space-y-3">
        {list.map((shift: WorkerShift) => (
          <ShiftListCard key={shift.id} shift={shift} />
        ))}
      </div>

      {filter === "today" && todayShifts.some((s) => s.status === "completed") && (
        <section className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <FileText size={20} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black" style={{ color: TEXT }}>
              Notes due within 24 hours
            </p>
            <p className="mt-1 text-xs font-medium leading-relaxed text-amber-900/80">
              NDIS Practice Standard 2.3 requires documentation within 24h of shift completion.
            </p>
            <button
              type="button"
              className="mt-3 rounded-full bg-amber-500 px-4 py-2 text-xs font-black text-white"
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
    <div className="rounded-2xl border bg-white px-3 py-3 text-center shadow-sm" style={{ borderColor: BORDER }}>
      <p className="text-xl font-black" style={{ color: PLUM }}>
        {value}
      </p>
      <p className="mt-0.5 text-[10px] font-bold leading-tight" style={{ color: MUTED }}>
        {label}
      </p>
    </div>
  );
}
