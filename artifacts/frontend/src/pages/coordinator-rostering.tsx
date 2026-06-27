import { useMemo, useState } from "react";
import {
  format, isSameDay, parseISO, startOfMonth, endOfMonth,
  addMonths, subMonths, startOfWeek, endOfWeek,
  eachDayOfInterval, isToday, isSameMonth, addDays,
} from "date-fns";
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock3, Loader2,
  Plus, Users2, User2, AlertCircle, LayoutGrid, Settings2,
} from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useGetParticipants } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  getCoordinatorWorkerStats,
  listCoordinatorShifts,
  type CoordinatorShiftRecord,
  type WorkerStats,
} from "@/services/coordinatorService";
import { ShiftAssignmentModal } from "@/components/coordinator/ShiftAssignmentModal";
import { DndScheduleView }        from "@/components/coordinator/DndScheduleView";
import { BulkShiftModal }         from "@/components/coordinator/BulkShiftModal";
import { WorkerAvailabilityPanel } from "@/components/coordinator/WorkerAvailabilityPanel";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

type ViewMode = "month" | "week" | "schedule" | "list";

const STATUS_CFG: Record<string, { label: string; bg: string; color: string }> = {
  scheduled:   { label: "Scheduled", bg: "#EDE9FF", color: "#3730A3" },
  in_progress: { label: "Active",    bg: "#DBEAFE", color: "#1D4ED8" },
  clocked_in:  { label: "Active",    bg: "#DBEAFE", color: "#1D4ED8" },
  completed:   { label: "Completed", bg: "#DCFCE7", color: "#166534" },
  cancelled:   { label: "Cancelled", bg: "#F1F5F9", color: "#64748B" },
};

function statusCfg(s?: string | null) {
  return STATUS_CFG[s ?? ""] ?? STATUS_CFG.scheduled;
}

function parseStart(s: CoordinatorShiftRecord): Date | null {
  if (!s.scheduled_start) return null;
  try { return parseISO(s.scheduled_start); } catch { return null; }
}

function ShiftChip({ shift }: { shift: CoordinatorShiftRecord }) {
  const cfg = statusCfg(shift.status);
  const d   = parseStart(shift);
  return (
    <div
      className="truncate rounded px-1.5 py-0.5 text-[10px] font-bold leading-tight cursor-default"
      style={{ background: cfg.bg, color: cfg.color }}
      title={`${shift.participant_name || "Participant"} — ${shift.worker_name || "Worker"}${d ? ` @ ${format(d, "HH:mm")}` : ""}`}
    >
      {shift.participant_name?.split(" ")[0] || "—"}
      {d ? ` ${format(d, "HH:mm")}` : ""}
    </div>
  );
}

function MonthGrid({
  month, shifts, selectedDay, onSelectDay,
}: {
  month: Date;
  shifts: CoordinatorShiftRecord[];
  selectedDay: Date;
  onSelectDay: (d: Date) => void;
}) {
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd   = endOfWeek(endOfMonth(month),     { weekStartsOn: 1 });
  const days      = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, CoordinatorShiftRecord[]>();
    for (const s of shifts) {
      const d = parseStart(s);
      if (!d) continue;
      const key = format(d, "yyyy-MM-dd");
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  }, [shifts]);

  return (
    <div className="rounded-2xl border bg-white overflow-hidden" style={{ borderColor: BORDER }}>
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-7" style={{ borderBottom: `1px solid ${BORDER}`, background: SOFT }}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-2.5 text-center text-[10px] font-black uppercase tracking-widest" style={{ color: MUTED }}>
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key       = format(day, "yyyy-MM-dd");
          const dayShifts = (shiftsByDay.get(key) ?? []).sort((a, b) =>
            (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? "")
          );
          const isSelected = isSameDay(day, selectedDay);
          const today      = isToday(day);
          const inMonth    = isSameMonth(day, month);
          return (
            <div
              key={key}
              onClick={() => onSelectDay(day)}
              className="min-h-[88px] cursor-pointer p-1.5 transition-colors hover:bg-[#F8F6FE]"
              style={{
                borderBottom: `1px solid ${BORDER}`,
                borderRight:  `1px solid ${BORDER}`,
                background:   isSelected ? "#F0ECFF" : "var(--cc-bg)",
                opacity:      inMonth ? 1 : 0.38,
              }}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-black"
                  style={{
                    background: today ? PLUM : "transparent",
                    color: today ? "white" : isSelected ? PLUM : inMonth ? TEXT : MUTED,
                  }}
                >
                  {format(day, "d")}
                </span>
                {dayShifts.length > 0 && (
                  <span className="rounded-full px-1.5 py-0.5 text-[9px] font-black" style={{ background: SOFT, color: PLUM }}>
                    {dayShifts.length}
                  </span>
                )}
              </div>
              <div className="space-y-0.5">
                {dayShifts.slice(0, 2).map((s) => <ShiftChip key={s.id} shift={s} />)}
                {dayShifts.length > 2 && (
                  <p className="pl-1 text-[10px] font-bold" style={{ color: PLUM }}>
                    +{dayShifts.length - 2} more
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({
  weekStart, shifts, workers,
}: {
  weekStart: Date;
  shifts: CoordinatorShiftRecord[];
  workers: WorkerStats[];
}) {
  const days = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });

  const byWorkerDay = useMemo(() => {
    const map = new Map<string, CoordinatorShiftRecord[]>();
    for (const s of shifts) {
      const d = parseStart(s);
      if (!d || !s.worker_id) continue;
      const key = `${s.worker_id}|${format(d, "yyyy-MM-dd")}`;
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  }, [shifts]);

  const activeWorkers = workers.filter((w) =>
    days.some((d) => (byWorkerDay.get(`${w.id}|${format(d, "yyyy-MM-dd")}`) ?? []).length > 0)
  );
  const rows = activeWorkers.length > 0 ? activeWorkers : workers.slice(0, 10);

  return (
    <div className="rounded-2xl border bg-white overflow-auto" style={{ borderColor: BORDER }}>
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th
              className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest min-w-[160px]"
              style={{ color: MUTED, borderBottom: `1px solid ${BORDER}` }}
            >
              Worker
            </th>
            {days.map((d) => (
              <th
                key={d.toISOString()}
                className="min-w-[130px] px-2 py-2.5 text-center"
                style={{ borderBottom: `1px solid ${BORDER}`, background: isToday(d) ? "#F0ECFF" : "var(--cc-bg)" }}
              >
                <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: isToday(d) ? PLUM : MUTED }}>
                  {format(d, "EEE")}
                </div>
                <div
                  className="mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-[14px] font-black"
                  style={{ background: isToday(d) ? PLUM : "transparent", color: isToday(d) ? "white" : TEXT }}
                >
                  {format(d, "d")}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((worker) => (
            <tr key={worker.id}>
              <td className="sticky left-0 z-10 bg-white px-4 py-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <div className="flex items-center gap-2.5">
                  <div
                    className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-[11px] font-black text-white"
                    style={{ background: PLUM }}
                  >
                    {worker.full_name.split(" ").map((p: string) => p[0]).join("").slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-bold" style={{ color: TEXT }}>{worker.full_name}</p>
                    {worker.avg_compliance != null && (
                      <p className="text-[10px]" style={{
                        color: worker.avg_compliance >= 85 ? "#16A34A" : worker.avg_compliance >= 60 ? "#D97706" : "#DC2626"
                      }}>
                        {worker.avg_compliance.toFixed(0)}% compliance
                      </p>
                    )}
                  </div>
                </div>
              </td>
              {days.map((d) => {
                const key       = `${worker.id}|${format(d, "yyyy-MM-dd")}`;
                const dayShifts = byWorkerDay.get(key) ?? [];
                return (
                  <td
                    key={d.toISOString()}
                    className="px-1.5 py-2 align-top"
                    style={{ borderBottom: `1px solid ${BORDER}`, background: isToday(d) ? "#FAFAFE" : "var(--cc-bg)" }}
                  >
                    <div className="space-y-1">
                      {dayShifts.map((s) => {
                        const cfg   = statusCfg(s.status);
                        const start = parseStart(s);
                        const end   = s.scheduled_end ? parseISO(s.scheduled_end) : null;
                        return (
                          <div key={s.id} className="rounded-lg px-2 py-1.5 text-[10px] font-bold" style={{ background: cfg.bg, color: cfg.color }}>
                            <div className="truncate">{s.participant_name?.split(" ")[0] || "—"}</div>
                            {start && (
                              <div className="mt-0.5 font-medium opacity-75">
                                {format(start, "h:mm a")}{end ? `–${format(end, "h:mm a")}` : ""}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {dayShifts.length === 0 && (
                        <div className="h-7 rounded-lg border border-dashed" style={{ borderColor: BORDER }} />
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="py-16 text-center text-[13px]" style={{ color: MUTED }}>
                No shifts scheduled for this week.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DayPanel({
  day, shifts, workers, onAssign,
}: {
  day: Date;
  shifts: CoordinatorShiftRecord[];
  workers: WorkerStats[];
  onAssign: () => void;
}) {
  const dayShifts = useMemo(
    () =>
      shifts
        .filter((s) => { const d = parseStart(s); return !!d && isSameDay(d, day); })
        .sort((a, b) => (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? "")),
    [shifts, day]
  );

  return (
    <div className="flex flex-col rounded-2xl border bg-white" style={{ borderColor: BORDER }}>
      <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: MUTED }}>{format(day, "EEEE")}</p>
          <p className="text-xl font-black" style={{ color: isToday(day) ? PLUM : TEXT }}>{format(day, "d MMMM yyyy")}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full px-2.5 py-1 text-[11px] font-black" style={{ background: SOFT, color: PLUM }}>
            {dayShifts.length} {dayShifts.length === 1 ? "shift" : "shifts"}
          </span>
          <Button
            size="sm"
            onClick={onAssign}
            className="flex items-center gap-1.5 rounded-full text-white text-xs"
            style={{ background: PLUM }}
          >
            <Plus size={12} /> Assign
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[560px] px-3 py-3 space-y-2">
        {dayShifts.length === 0 ? (
          <div className="py-14 text-center">
            <CalendarDays className="mx-auto mb-2" size={22} style={{ color: MUTED }} />
            <p className="text-[13px] font-bold" style={{ color: TEXT }}>No shifts scheduled</p>
            <p className="mt-1 text-[11px]" style={{ color: MUTED }}>Click Assign to add a shift for this date.</p>
          </div>
        ) : (
          dayShifts.map((shift) => {
            const cfg   = statusCfg(shift.status);
            const start = parseStart(shift);
            const end   = shift.scheduled_end ? parseISO(shift.scheduled_end) : null;
            const durMs = start && end ? end.getTime() - start.getTime() : null;
            const durH  = durMs != null ? (durMs / 3600000).toFixed(1) : null;
            return (
              <div key={shift.id} className="rounded-xl border p-3.5" style={{ borderColor: BORDER, borderLeftWidth: 3, borderLeftColor: cfg.color }}>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase" style={{ background: cfg.bg, color: cfg.color }}>
                    {cfg.label}
                  </span>
                  <span className="flex items-center gap-1 text-[11px]" style={{ color: MUTED }}>
                    <Clock3 size={11} />
                    {start ? format(start, "h:mm a") : "—"}
                    {end ? ` – ${format(end, "h:mm a")}` : ""}
                    {durH ? ` · ${durH}h` : ""}
                  </span>
                </div>
                <p className="text-[14px] font-black" style={{ color: TEXT }}>{shift.participant_name || "Participant"}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1 text-[11px]" style={{ color: MUTED }}>
                    <User2 size={11} /> {shift.worker_name || workers.find((w) => w.id === shift.worker_id)?.full_name || "Worker"}
                  </span>
                  {shift.shift_type && (
                    <span className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase" style={{ background: SOFT, color: MUTED }}>
                      {shift.shift_type.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, color = TEXT }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border bg-white px-4 py-4" style={{ borderColor: BORDER }}>
      <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: MUTED }}>{label}</p>
      <p className="mt-1.5 text-2xl font-black leading-none" style={{ color }}>{value}</p>
      {sub && <p className="mt-1 text-[11px]" style={{ color: MUTED }}>{sub}</p>}
    </div>
  );
}

export default function CoordinatorRosteringPage() {
  const [viewMode,     setViewMode]     = useState<ViewMode>("month");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [weekStart,    setWeekStart]    = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedDay,  setSelectedDay]  = useState(new Date());
  const [statusFilter, setStatusFilter] = useState("all");
  const [workerFilter, setWorkerFilter] = useState("all");
  const [assignOpen,   setAssignOpen]   = useState(false);
  const [bulkOpen,     setBulkOpen]     = useState(false);
  const [availWorker,  setAvailWorker]  = useState<WorkerStats | null>(null);

  const participantsQuery = useGetParticipants();
  const participantList   = (participantsQuery.data as Array<{ id: string; full_name: string }> | undefined) ?? [];

  const rangeStart = (viewMode === "week" || viewMode === "schedule")
    ? format(weekStart, "yyyy-MM-dd")
    : format(startOfMonth(currentMonth), "yyyy-MM-dd");
  const rangeEnd = (viewMode === "week" || viewMode === "schedule")
    ? format(addDays(weekStart, 6), "yyyy-MM-dd")
    : format(endOfMonth(currentMonth), "yyyy-MM-dd");

  const workersQuery = useOrgQuery(["coordinator", "worker-stats"], {
    queryFn: getCoordinatorWorkerStats,
    staleTime: 60_000,
  });

  const shiftsQuery = useOrgQuery(
    ["coordinator", "roster-shifts", rangeStart, rangeEnd, workerFilter, statusFilter],
    {
      queryFn: () =>
        listCoordinatorShifts({
          start_date: `${rangeStart}T00:00:00Z`,
          end_date:   `${rangeEnd}T23:59:59Z`,
          worker_id:  workerFilter === "all" ? undefined : workerFilter,
          status:     statusFilter === "all" ? undefined : statusFilter,
          limit: 2000,
        }),
    }
  );

  const workers = workersQuery.data ?? [];
  const shifts  = shiftsQuery.data  ?? [];

  const todayKey       = format(new Date(), "yyyy-MM-dd");
  const shiftsToday    = shifts.filter((s) => (s.scheduled_start ?? "").startsWith(todayKey));
  const activeShifts   = shifts.filter((s) => s.status === "in_progress" || s.status === "clocked_in");
  const scheduledCount = shifts.filter((s) => s.status === "scheduled").length;

  const handlePrev = () => {
    if (viewMode === "month") setCurrentMonth((m) => subMonths(m, 1));
    else setWeekStart((w) => addDays(w, -7));
  };
  const handleNext = () => {
    if (viewMode === "month") setCurrentMonth((m) => addMonths(m, 1));
    else setWeekStart((w) => addDays(w, 7));
  };
  const handleToday = () => {
    const now = new Date();
    setCurrentMonth(now);
    setWeekStart(startOfWeek(now, { weekStartsOn: 1 }));
    setSelectedDay(now);
  };

  const assignWorker   = workers.find((w) => w.id === workerFilter) ?? null;
  const periodLabel    = viewMode === "month"
    ? format(currentMonth, "MMMM yyyy")
    : `${format(weekStart, "d MMM")} – ${format(addDays(weekStart, 6), "d MMM yyyy")}`;

  return (
    <div className="space-y-5 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="hidden" style={{ color: MUTED }}>Support Coordinator</p>
          <h1 className="text-xl font-black tracking-tight" style={{ color: PLUM }}>Rostering & Scheduling</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setBulkOpen(true)}
            variant="outline"
            className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-black"
            style={{ borderColor: BORDER, color: MUTED }}
          >
            <LayoutGrid size={14} /> Recurring
          </Button>
          <Button
            onClick={() => setAssignOpen(true)}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-black text-white"
            style={{ background: PLUM }}
          >
            <Plus size={15} /> Create Shift
          </Button>
        </div>
      </div>

      {/* Inline stat strip instead of 4 identical cards */}
      <div
        className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-white px-5 py-4"
        style={{ borderColor: BORDER }}
      >
        <div className="flex items-center gap-2">
          <CalendarDays size={14} style={{ color: MUTED }} />
          <span className="text-sm font-black" style={{ color: TEXT }}>{shiftsToday.length}</span>
          <span className="text-sm font-medium" style={{ color: MUTED }}>today</span>
        </div>
        <div className="h-4 w-px" style={{ background: BORDER }} />
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
          <span className="text-sm font-black text-blue-700">{activeShifts.length}</span>
          <span className="text-sm font-medium" style={{ color: MUTED }}>active now</span>
        </div>
        <div className="h-4 w-px" style={{ background: BORDER }} />
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: PLUM }} />
          <span className="text-sm font-black" style={{ color: PLUM }}>{scheduledCount}</span>
          <span className="text-sm font-medium" style={{ color: MUTED }}>upcoming</span>
        </div>
        <div className="h-4 w-px" style={{ background: BORDER }} />
        <div className="flex items-center gap-2">
          <Users2 size={14} style={{ color: MUTED }} />
          <span className="text-sm font-black" style={{ color: TEXT }}>{workers.length}</span>
          <span className="text-sm font-medium" style={{ color: MUTED }}>
            {workersQuery.isLoading ? "loading…" : "team members"}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-white px-4 py-3" style={{ borderColor: BORDER }}>
        <div className="flex overflow-hidden rounded-xl border" style={{ borderColor: BORDER }}>
          {(["month", "week", "schedule", "list"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className="px-4 py-2 text-[12px] font-bold capitalize transition-colors"
              style={{ background: viewMode === mode ? PLUM : "var(--cc-bg)", color: viewMode === mode ? "white" : MUTED }}
            >
              {mode}
            </button>
          ))}
        </div>

        {viewMode !== "list" && viewMode !== "schedule" && (
          <div className="flex items-center gap-2">
            <button
              title="Previous period"
              onClick={handlePrev}
              className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-[#F8F6FE]"
              style={{ borderColor: BORDER }}
            >
              <ChevronLeft size={15} />
            </button>
            <span className="min-w-[160px] text-center text-[13px] font-black" style={{ color: TEXT }}>{periodLabel}</span>
            <button
              title="Next period"
              onClick={handleNext}
              className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-[#F8F6FE]"
              style={{ borderColor: BORDER }}
            >
              <ChevronRight size={15} />
            </button>
            <button
              onClick={handleToday}
              className="rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors hover:bg-[#F8F6FE]"
              style={{ borderColor: BORDER, color: PLUM }}
            >
              Today
            </button>
          </div>
        )}

        <div className="ml-auto flex flex-wrap gap-2">
          <Select value={workerFilter} onValueChange={setWorkerFilter}>
            <SelectTrigger className="h-8 flex-1 sm:w-[170px] rounded-lg text-[12px]" style={{ borderColor: BORDER }}>
              <SelectValue placeholder="All workers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All workers</SelectItem>
              {workers.map((w) => <SelectItem key={w.id} value={w.id}>{w.full_name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 flex-1 sm:w-[145px] rounded-lg text-[12px]" style={{ borderColor: BORDER }}>
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="in_progress">Active</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {shiftsQuery.isLoading && <Loader2 className="h-4 w-4 animate-spin" style={{ color: MUTED }} />}
      </div>

      {shiftsQuery.error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          <AlertCircle size={15} className="shrink-0" />
          Failed to load roster data. Please refresh or try again.
        </div>
      )}

      {viewMode === "month" && (
        <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
          <MonthGrid month={currentMonth} shifts={shifts} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
          <DayPanel day={selectedDay} shifts={shifts} workers={workers} onAssign={() => setAssignOpen(true)} />
        </div>
      )}

      {viewMode === "week" && (
        <WeekGrid weekStart={weekStart} shifts={shifts} workers={workers} />
      )}

      {viewMode === "list" && (
        <div className="rounded-2xl border bg-white overflow-hidden" style={{ borderColor: BORDER }}>
          <div
            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-[2fr_2fr_1.4fr_1.2fr_1fr] gap-2 px-4 py-3 text-[10px] font-black uppercase tracking-widest"
            style={{ color: MUTED, borderBottom: `1px solid ${BORDER}`, background: SOFT }}
          >
            <span>Participant</span><span className="hidden sm:inline">Worker</span><span className="hidden md:inline">Date & Time</span><span className="hidden md:inline">Shift Type</span><span className="hidden sm:inline">Status</span>
          </div>
          <div>
            {shifts.length === 0 && !shiftsQuery.isLoading && (
              <div className="py-16 text-center">
                <Users2 className="mx-auto mb-2" size={24} style={{ color: MUTED }} />
                <p className="text-[13px] font-bold" style={{ color: TEXT }}>No shifts match the current filters.</p>
                <p className="mt-1 text-[11px]" style={{ color: MUTED }}>Try adjusting the worker or status filter.</p>
              </div>
            )}
            {shifts.map((shift) => {
              const cfg   = statusCfg(shift.status);
              const start = parseStart(shift);
              const end   = shift.scheduled_end ? parseISO(shift.scheduled_end) : null;
              return (
                <div
                  key={shift.id}
                  className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-[2fr_2fr_1.4fr_1.2fr_1fr] gap-2 items-center px-4 py-3 text-sm hover:bg-[#F8F6FE] transition-colors"
                  style={{ borderBottom: `1px solid ${BORDER}` }}
                >
                  <p className="truncate font-bold" style={{ color: TEXT }}>{shift.participant_name || "Participant"}</p>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black text-white" style={{ background: PLUM }}>
                      {(shift.worker_name || "W").split(" ").map((p: string) => p[0]).join("").slice(0, 2)}
                    </div>
                    <p className="truncate text-[12px]" style={{ color: MUTED }}>{shift.worker_name || "Worker"}</p>
                  </div>
                  <div>
                    {start ? (
                      <>
                        <p className="text-[12px] font-bold" style={{ color: TEXT }}>{format(start, "d MMM yyyy")}</p>
                        <p className="text-[11px]" style={{ color: MUTED }}>{format(start, "h:mm a")}{end ? ` – ${format(end, "h:mm a")}` : ""}</p>
                      </>
                    ) : <span style={{ color: MUTED }}>—</span>}
                  </div>
                  <p className="truncate text-[11px]" style={{ color: MUTED }}>
                    {(shift.shift_type ?? "standard_support").replace(/_/g, " ")}
                  </p>
                  <span className="inline-block rounded-full px-2.5 py-1 text-[10px] font-black uppercase" style={{ background: cfg.bg, color: cfg.color }}>
                    {cfg.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ShiftAssignmentModal
        open={assignOpen}
        onOpenChange={setAssignOpen}
        worker={assignWorker}
        workers={workers}
      />

      {/* ── Schedule (DnD) view ──────────────────────────────────────────── */}
      {viewMode === "schedule" && (
        <div className="space-y-4">
          {/* Period nav for schedule view */}
          <div className="flex items-center gap-2 rounded-2xl border bg-white px-4 py-3" style={{ borderColor: BORDER }}>
            <button
              title="Previous week"
              onClick={handlePrev}
              className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-[#F8F6FE]"
              style={{ borderColor: BORDER }}
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              {format(weekStart, "d MMM")} – {format(addDays(weekStart, 6), "d MMM yyyy")}
            </span>
            <button title="Next week" onClick={handleNext}
              className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-[#F8F6FE]"
              style={{ borderColor: BORDER }}
            >
              <ChevronRight size={15} />
            </button>
            <button
              onClick={handleToday}
              className="rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors hover:bg-[#F8F6FE]"
              style={{ borderColor: BORDER, color: PLUM }}
            >
              Today
            </button>
            <div className="ml-auto text-[11px] font-medium" style={{ color: MUTED }}>
              Drag unassigned shifts onto worker rows to assign
            </div>
          </div>

          {/* Optional: Worker availability panel */}
          {availWorker && (
            <WorkerAvailabilityPanel
              worker={availWorker}
              onClose={() => setAvailWorker(null)}
            />
          )}

          <DndScheduleView
            weekStart={weekStart}
            shifts={shifts}
            workers={workers}
            onRefresh={() => shiftsQuery.refetch?.()}
          />

          {/* Worker settings list */}
          <div className="rounded-2xl border bg-white p-4" style={{ borderColor: BORDER }}>
            <p className="mb-3 text-[10px] font-black uppercase tracking-widest" style={{ color: MUTED }}>
              Worker Availability & Skills
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {workers.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setAvailWorker((prev) => prev?.id === w.id ? null : w)}
                  className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-[#F8F8FE]"
                  style={{
                    borderColor: availWorker?.id === w.id ? PLUM : BORDER,
                    background:  availWorker?.id === w.id ? "#EDE9FF" : "var(--cc-bg)",
                  }}
                >
                  <div
                    className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black text-white"
                    style={{ background: PLUM }}
                  >
                    {w.full_name.split(" ").map((p: string) => p[0]).join("").slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-bold" style={{ color: PLUM }}>{w.full_name.split(" ")[0]}</p>
                    <p className="text-[10px] flex items-center gap-1" style={{ color: MUTED }}>
                      <Settings2 size={9} /> Settings
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk/Recurring shift modal ───────────────────────────────────── */}
      <BulkShiftModal
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        participants={participantList}
        workers={workers}
      />
    </div>
  );
}
