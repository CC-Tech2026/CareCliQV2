import { useMemo, useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  format, isSameDay, parseISO, startOfMonth, endOfMonth,
  addMonths, subMonths, startOfWeek, endOfWeek,
  eachDayOfInterval, isToday, isSameMonth, addDays, getDay,
} from "date-fns";
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock3, Loader2,
  Plus, Users2, User2, AlertCircle, LayoutGrid, Settings2,
  CheckCircle2, XCircle, MinusCircle, UserCheck, Activity,
  Search, RefreshCw,
} from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useGetParticipants } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { KpiCard, KpiGrid } from "@/components/ui/stat-card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  getCoordinatorWorkerStats,
  listCoordinatorShifts,
  getWorkerAvailability,
  type CoordinatorShiftRecord,
  type WorkerStats,
  type WorkerAvailability,
  type BlackoutDate,
} from "@/services/coordinatorService";
import { ShiftAssignmentModal } from "@/components/coordinator/ShiftAssignmentModal";
import { DndScheduleView }        from "@/components/coordinator/DndScheduleView";
import { BulkShiftModal }         from "@/components/coordinator/BulkShiftModal";
import { WorkerAvailabilityPanel } from "@/components/coordinator/WorkerAvailabilityPanel";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useAuth } from "@/contexts/AuthContext";
import { appLocalDateKey } from "@/lib/datetime";
import CoordinatorLivePage from "./coordinator-live";
import CoordinatorMonitorPage from "./coordinator-monitor";

type ScheduleTab = "roster" | "live";
const SCHEDULE_TABS: { id: ScheduleTab; label: string }[] = [
  { id: "roster", label: "Roster"         },
  { id: "live",   label: "Live Monitor" },
];

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

type ViewMode = "month" | "week" | "schedule" | "list";

const STATUS_CFG: Record<string, { labelKey: string; bg: string; color: string }> = {
  scheduled:   { labelKey: "coordinator.rostering.status.scheduled", bg: "#FCE3EB", color: "#E8457A" },
  in_progress: { labelKey: "coordinator.rostering.status.active",    bg: "#DBEAFE", color: "#1D4ED8" },
  clocked_in:  { labelKey: "coordinator.rostering.status.active",    bg: "#DBEAFE", color: "#1D4ED8" },
  completed:   { labelKey: "coordinator.rostering.status.completed", bg: "#DCFCE7", color: "#166534" },
  cancelled:   { labelKey: "coordinator.rostering.status.cancelled", bg: "#F1F5F9", color: "#64748B" },
};

function statusCfg(s: string | null | undefined, translate: (key: string) => string) {
  const cfg = STATUS_CFG[s ?? ""] ?? STATUS_CFG.scheduled;
  return { ...cfg, label: translate(cfg.labelKey) };
}

function parseStart(s: CoordinatorShiftRecord): Date | null {
  if (!s.scheduled_start) return null;
  try { return parseISO(s.scheduled_start); } catch { return null; }
}

function ShiftChip({ shift }: { shift: CoordinatorShiftRecord }) {
  const { translate, translateParams } = useAccessibility();
  const cfg = statusCfg(shift.status, translate);
  const d   = parseStart(shift);
  const participant = shift.participant_name || translate("common.participant");
  const worker = shift.worker_name || translate("common.worker");
  const timeSuffix = d ? ` @ ${format(d, "HH:mm")}` : "";
  return (
    <div
      className="truncate rounded px-1.5 py-0.5 text-[10px] font-bold leading-tight cursor-default"
      style={{ background: cfg.bg, color: cfg.color }}
      title={translateParams("coordinator.rostering.shiftChipTitle", { participant, worker, time: timeSuffix })}
    >
      {shift.participant_name?.split(" ")[0] || "N/A"}
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
  const { translate, translateParams } = useAccessibility();
  const dayLabels = [
    translate("coordinator.rostering.day.mon"),
    translate("coordinator.rostering.day.tue"),
    translate("coordinator.rostering.day.wed"),
    translate("coordinator.rostering.day.thu"),
    translate("coordinator.rostering.day.fri"),
    translate("coordinator.rostering.day.sat"),
    translate("coordinator.rostering.day.sun"),
  ];
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
        {dayLabels.map((d) => (
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
                    background: today ? "var(--cc-text)" : "transparent",
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
                    {translateParams("coordinator.rostering.moreShifts", { count: String(dayShifts.length - 2) })}
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

const UNASSIGNED_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

type AvailabilityMap = Record<string, WorkerAvailability & { blackout_dates?: BlackoutDate[] }>;

/** Returns 0=Mon – 6=Sun matching the available_days encoding in WorkerAvailability */
function ccDayIndex(date: Date): number {
  const js = getDay(date); // 0=Sun, 1=Mon – 6=Sat
  return js === 0 ? 6 : js - 1; // convert to 0=Mon – 6=Sun
}

function isBlackout(date: Date, blackouts: BlackoutDate[] = []): boolean {
  const key = format(date, "yyyy-MM-dd");
  return blackouts.some((b) => b.start_date <= key && key <= b.end_date);
}

function RosterGrid({
  weekStart, shifts, workers, availMap, loadingAvail, onCellClick,
}: {
  weekStart: Date;
  shifts: CoordinatorShiftRecord[];
  workers: WorkerStats[];
  availMap: AvailabilityMap;
  loadingAvail: boolean;
  onCellClick: (worker: WorkerStats, date: string) => void;
}) {
  const { translate } = useAccessibility();
  const days = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });

  const byWorkerDay = useMemo(() => {
    const map = new Map<string, CoordinatorShiftRecord[]>();
    for (const s of shifts) {
      const d = parseStart(s);
      if (!d || !s.worker_id || s.worker_id === UNASSIGNED_PLACEHOLDER_ID) continue;
      const key = `${s.worker_id}|${format(d, "yyyy-MM-dd")}`;
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  }, [shifts]);

  const unassigned = useMemo(
    () => shifts.filter((s) => !s.worker_id || s.worker_id === UNASSIGNED_PLACEHOLDER_ID),
    [shifts]
  );

  // Each day's total shift count (for column header badge)
  const shiftsByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of shifts) {
      const d = parseStart(s);
      if (!d || !s.worker_id || s.worker_id === UNASSIGNED_PLACEHOLDER_ID) continue;
      const k = format(d, "yyyy-MM-dd");
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }, [shifts]);

  const rows = workers.length > 0 ? workers : [];

  return (
    <div className="space-y-3">
      {/* Unassigned shifts banner */}
      {unassigned.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-black text-amber-900">
              {unassigned.length} unassigned {unassigned.length === 1 ? "shift" : "shifts"} need a worker
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {unassigned.map((s) => {
                const d = parseStart(s);
                return (
                  <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-white border border-amber-200 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                    <User2 size={10} />
                    {s.participant_name?.split(" ")[0] || "Shift"}
                    {d ? ` · ${format(d, "d MMM, h:mm a")}` : ""}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-white px-4 py-2.5" style={{ borderColor: BORDER }}>
        <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>Availability</span>
        {[
          { color: "#DCFCE7", border: "#86EFAC", text: "#166534", label: "Available" },
          { color: "#FCE3EB", border: "#A78BFA", text: "#4C1D95", label: "Assigned" },
          { color: "#FEF3C7", border: "#FCD34D", text: "#92400E", label: "On leave" },
          { color: "#F1F5F9", border: "#CBD5E1", text: "#64748B", label: "Not rostered" },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded" style={{ background: l.color, border: `1px solid ${l.border}` }} />
            <span className="text-[11px]" style={{ color: MUTED }}>{l.label}</span>
          </div>
        ))}
        {loadingAvail && <Loader2 size={12} className="ml-auto animate-spin" style={{ color: MUTED }} />}
      </div>

      {/* Main grid */}
      <div className="rounded-2xl border bg-white overflow-auto" style={{ borderColor: BORDER }}>
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th
                className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest min-w-[180px]"
                style={{ color: MUTED, borderBottom: `1px solid ${BORDER}` }}
              >
                Worker
              </th>
              {days.map((d) => {
                const dayKey = format(d, "yyyy-MM-dd");
                const count = shiftsByDay.get(dayKey) ?? 0;
                return (
                  <th
                    key={d.toISOString()}
                    className="min-w-[120px] px-2 py-2.5 text-center"
                    style={{ borderBottom: `1px solid ${BORDER}`, background: isToday(d) ? "#F0ECFF" : "var(--cc-soft)" }}
                  >
                    <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: isToday(d) ? PLUM : MUTED }}>
                      {format(d, "EEE")}
                    </div>
                    <div
                      className="mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-black"
                      style={{ background: isToday(d) ? "var(--cc-text)" : "transparent", color: isToday(d) ? "white" : TEXT }}
                    >
                      {format(d, "d")}
                    </div>
                    {count > 0 && (
                      <div className="mt-1 text-[9px] font-black" style={{ color: PLUM }}>
                        {count} shift{count !== 1 ? "s" : ""}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((worker) => {
              const avail = availMap[worker.id];
              const weekShifts = days.reduce((n, d) => n + (byWorkerDay.get(`${worker.id}|${format(d, "yyyy-MM-dd")}`) ?? []).length, 0);
              return (
                <tr key={worker.id}>
                  {/* Worker column */}
                  <td className="sticky left-0 z-10 bg-white px-3 py-2.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <div className="flex items-center gap-2.5">
                      <div
                        className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-[11px] font-black text-white shadow-sm"
                        style={{ background: "var(--cc-text)" }}
                      >
                        {worker.full_name.split(" ").map((p: string) => p[0]).join("").slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-bold leading-tight" style={{ color: TEXT }}>{worker.full_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {worker.avg_compliance != null && (
                            <span className="text-[10px] font-semibold" style={{
                              color: worker.avg_compliance >= 85 ? "#16A34A" : worker.avg_compliance >= 60 ? "#D97706" : "#DC2626"
                            }}>
                              {worker.avg_compliance.toFixed(0)}% compliance
                            </span>
                          )}
                          {weekShifts > 0 && (
                            <span className="text-[10px]" style={{ color: MUTED }}>{weekShifts} shift{weekShifts !== 1 ? "s" : ""}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Day cells */}
                  {days.map((d) => {
                    const dayKey    = format(d, "yyyy-MM-dd");
                    const dayShifts = byWorkerDay.get(`${worker.id}|${dayKey}`) ?? [];
                    const dayIdx    = ccDayIndex(d);
                    const onBlackout = avail ? isBlackout(d, avail.blackout_dates) : false;
                    const isWorkDay  = avail ? avail.available_days.includes(dayIdx) : true; // assume available if not loaded
                    const hasShift   = dayShifts.length > 0;

                    // Cell state
                    let cellBg    = "var(--cc-bg)";
                    let cellState: "available" | "assigned" | "blackout" | "unavailable" | "loading" = "available";
                    if (!avail && loadingAvail) {
                      cellState = "loading";
                    } else if (onBlackout) {
                      cellState = "blackout";
                      cellBg = "#FFFBEB";
                    } else if (!isWorkDay) {
                      cellState = "unavailable";
                      cellBg = "#F8FAFC";
                    } else if (hasShift) {
                      cellState = "assigned";
                      cellBg = isToday(d) ? "#FAFAFE" : "var(--cc-bg)";
                    } else {
                      cellState = "available";
                      cellBg = isToday(d) ? "#F0FFF4" : "#F7FEF9";
                    }

                    return (
                      <td
                        key={d.toISOString()}
                        className="px-1.5 py-1.5 align-top"
                        style={{ borderBottom: `1px solid ${BORDER}`, background: cellBg, minWidth: 120 }}
                      >
                        {cellState === "loading" && (
                          <div className="flex h-10 items-center justify-center">
                            <div className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: BORDER }} />
                          </div>
                        )}

                        {cellState === "blackout" && (
                          <div className="flex flex-col items-center justify-center h-10 gap-0.5">
                            <XCircle size={13} className="text-amber-500" />
                            <span className="text-[9px] font-bold text-amber-700">On leave</span>
                            {avail?.blackout_dates?.find(b => {
                              const k = format(d, "yyyy-MM-dd");
                              return b.start_date <= k && k <= b.end_date && b.reason;
                            })?.reason && (
                              <span className="text-[8px] text-amber-600 truncate max-w-[90px]">
                                {avail.blackout_dates!.find(b => { const k = format(d, "yyyy-MM-dd"); return b.start_date <= k && k <= b.end_date && b.reason; })!.reason}
                              </span>
                            )}
                          </div>
                        )}

                        {cellState === "unavailable" && (
                          <div className="flex h-10 items-center justify-center">
                            <MinusCircle size={12} className="opacity-25" style={{ color: MUTED }} />
                          </div>
                        )}

                        {cellState === "available" && (
                          <button
                            type="button"
                            title={`Assign shift to ${worker.full_name} on ${format(d, "d MMM")}`}
                            onClick={() => onCellClick(worker, dayKey)}
                            className="group flex h-10 w-full items-center justify-center rounded-lg border border-dashed border-green-200 hover:border-green-400 hover:bg-green-50 transition-all"
                          >
                            <Plus size={13} className="text-green-400 group-hover:text-green-600 transition-colors" />
                          </button>
                        )}

                        {cellState === "assigned" && (
                          <div className="space-y-1">
                            {dayShifts.map((s) => {
                              const cfg   = statusCfg(s.status, translate);
                              const start = parseStart(s);
                              const end   = s.scheduled_end ? parseISO(s.scheduled_end) : null;
                              return (
                                <div key={s.id}
                                  className="rounded-lg px-2 py-1.5 text-[10px] font-bold"
                                  style={{ background: cfg.bg, color: cfg.color, borderLeft: `3px solid ${cfg.color}` }}
                                >
                                  <div className="truncate font-black">{s.participant_name?.split(" ")[0] || "N/A"}</div>
                                  {start && (
                                    <div className="mt-0.5 font-medium opacity-80">
                                      {format(start, "h:mm a")}{end ? `–${format(end, "h:mm a")}` : ""}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {/* Allow adding a second shift on the same day */}
                            <button
                              type="button"
                              title={`Add another shift for ${worker.full_name} on ${format(d, "d MMM")}`}
                              onClick={() => onCellClick(worker, dayKey)}
                              className="flex h-5 w-full items-center justify-center rounded border border-dashed border-violet-200 hover:border-violet-400 hover:bg-violet-50 transition-all opacity-0 hover:opacity-100 focus:opacity-100"
                            >
                              <Plus size={9} style={{ color: PLUM }} />
                            </button>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-16 text-center text-[13px]" style={{ color: MUTED }}>
                  {translate("coordinator.rostering.noShiftsWeek")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
  const { translate } = useAccessibility();
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
            {dayShifts.length} {dayShifts.length === 1 ? translate("coordinator.rostering.shift") : translate("coordinator.rostering.shifts")}
          </span>
          <Button
            size="sm"
            onClick={onAssign}
            className="flex items-center gap-1.5 rounded-full text-white text-xs"
            style={{ background: "var(--cc-cta)" }}
          >
            <Plus size={12} /> {translate("coordinator.rostering.assign")}
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[560px] px-3 py-3 space-y-2">
        {dayShifts.length === 0 ? (
          <div className="py-14 text-center">
            <CalendarDays className="mx-auto mb-2" size={22} style={{ color: MUTED }} />
            <p className="text-[13px] font-bold" style={{ color: TEXT }}>{translate("coordinator.rostering.noShiftsDay")}</p>
            <p className="mt-1 text-[11px]" style={{ color: MUTED }}>{translate("coordinator.rostering.noShiftsDayHint")}</p>
          </div>
        ) : (
          dayShifts.map((shift) => {
            const cfg   = statusCfg(shift.status, translate);
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
                    {start ? format(start, "h:mm a") : "N/A"}
                    {end ? ` – ${format(end, "h:mm a")}` : ""}
                    {durH ? ` · ${durH}h` : ""}
                  </span>
                </div>
                <p className="text-[14px] font-black" style={{ color: TEXT }}>{shift.participant_name || translate("common.participant")}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1 text-[11px]" style={{ color: MUTED }}>
                    <User2 size={11} /> {shift.worker_name || workers.find((w) => w.id === shift.worker_id)?.full_name || translate("common.worker")}
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

export default function CoordinatorRosteringPage() {
  const { translate, translateParams } = useAccessibility();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const liveOrgId = currentUser?.organizationId ?? "__no_org__";
  const [liveSearch, setLiveSearch] = useState("");
  const [pageTab,      setPageTab]      = useState<ScheduleTab>("roster");
  const [viewMode,     setViewMode]     = useState<ViewMode>("month");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [weekStart,    setWeekStart]    = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedDay,  setSelectedDay]  = useState(new Date());
  const [statusFilter, setStatusFilter] = useState("all");
  const [workerFilter, setWorkerFilter] = useState("all");
  const [assignOpen,   setAssignOpen]   = useState(false);
  const [bulkOpen,     setBulkOpen]     = useState(false);
  const [availWorker,  setAvailWorker]  = useState<WorkerStats | null>(null);
  const [assignTarget, setAssignTarget] = useState<{ worker: WorkerStats; date: string } | null>(null);
  const [availMap,     setAvailMap]     = useState<AvailabilityMap>({});
  const [loadingAvail, setLoadingAvail] = useState(false);

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

  // Load availability for all workers when the list changes
  useEffect(() => {
    if (workers.length === 0) return;
    let cancelled = false;
    setLoadingAvail(true);
    (async () => {
      const map: AvailabilityMap = {};
      for (const w of workers) {
        try {
          const data = await getWorkerAvailability(w.id);
          map[w.id] = { ...data.availability, blackout_dates: data.blackout_dates };
        } catch { /* skip unavailable */ }
      }
      if (!cancelled) { setAvailMap(map); setLoadingAvail(false); }
    })();
    return () => { cancelled = true; };
  }, [workers]);

  const todayKey       = appLocalDateKey(new Date().toISOString());
  const shiftsToday    = shifts.filter((s) => s.scheduled_start && appLocalDateKey(s.scheduled_start) === todayKey);
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
          <p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: "var(--cc-coral)" }}>Schedule</p>
          <h1 className="mt-1 text-xl font-black tracking-tight" style={{ color: TEXT }}>{translate("coordinator.rostering.title")}</h1>
          <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>Plan shifts, review worker availability and manage the roster</p>
        </div>
        {pageTab === "roster" ? (
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setBulkOpen(true)}
            variant="outline"
            className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-black"
            style={{ borderColor: BORDER, color: MUTED }}
          >
            <LayoutGrid size={14} /> {translate("coordinator.rostering.recurring")}
          </Button>
          <Button
            onClick={() => setAssignOpen(true)}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-black text-white"
            style={{ background: "var(--cc-cta)" }}
          >
            <Plus size={15} /> {translate("coordinator.rostering.createShift")}
          </Button>
        </div>
        ) : pageTab === "live" ? (
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: MUTED }} />
            <input
              value={liveSearch}
              onChange={(e) => setLiveSearch(e.target.value)}
              placeholder="Search worker or participant…"
              className="h-9 pl-8 pr-3 rounded-xl border text-[13px] outline-none w-56 focus:w-72 transition-all"
              style={{ borderColor: BORDER, color: TEXT, background: "var(--cc-bg)" }}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5 h-9"
            style={{ borderColor: BORDER }}
            onClick={() => queryClient.invalidateQueries({ queryKey: ["live-shifts", liveOrgId] })}
          >
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>
        ) : null}
      </div>

      {/* Page-level tabs: Roster | Live | Monitor */}
      <div role="tablist" className="flex gap-5 overflow-x-auto scrollbar-none border-b" style={{ borderColor: BORDER }}>
        {SCHEDULE_TABS.map((tab) => {
          const active = pageTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active ? "true" : "false"}
              onClick={() => setPageTab(tab.id)}
              className="relative flex shrink-0 items-center gap-1.5 pb-3 pt-1 text-[14px] font-bold whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ color: active ? TEXT : MUTED, outlineColor: active ? PLUM : "transparent" }}
            >
              {tab.label}
              {active && (
                <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full" style={{ background: PLUM }} />
              )}
            </button>
          );
        })}
      </div>

      {pageTab === "live" && <CoordinatorLivePage embedded externalSearch={liveSearch} />}

      {pageTab === "roster" && (
      <>
      {/* Inline stat strip instead of 4 identical cards */}
      <KpiGrid className="sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={translate("coordinator.rostering.today")} value={shiftsToday.length} icon={<CalendarDays />} />
        <KpiCard label={translate("coordinator.rostering.activeNow")} value={activeShifts.length} tone="info" icon={<Activity />} />
        <KpiCard label={translate("coordinator.rostering.upcoming")} value={scheduledCount} tone="brand" icon={<Clock3 />} />
        <KpiCard
          label={workersQuery.isLoading ? translate("coordinator.rostering.loadingTeam") : translate("coordinator.rostering.teamMembers")}
          value={workers.length}
          icon={<Users2 />}
        />
      </KpiGrid>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-white px-4 py-3" style={{ borderColor: BORDER }}>
        <div className="flex overflow-hidden rounded-xl border" style={{ borderColor: BORDER }}>
          {(["month", "week", "schedule", "list"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className="px-4 py-2 text-[12px] font-bold capitalize transition-colors"
              style={{ background: viewMode === mode ? "var(--cc-cta)" : "var(--cc-bg)", color: viewMode === mode ? "white" : MUTED }}
            >
              {translate(`coordinator.rostering.view.${mode}`)}
            </button>
          ))}
        </div>

        {viewMode !== "list" && viewMode !== "schedule" && (
          <div className="flex items-center gap-2">
            <button
              title={translate("coordinator.rostering.previousPeriod")}
              onClick={handlePrev}
              className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-[#F8F6FE]"
              style={{ borderColor: BORDER }}
            >
              <ChevronLeft size={15} />
            </button>
            <span className="min-w-[160px] text-center text-[13px] font-black" style={{ color: TEXT }}>{periodLabel}</span>
            <button
              title={translate("coordinator.rostering.nextPeriod")}
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
              {translate("coordinator.rostering.todayBtn")}
            </button>
          </div>
        )}

        <div className="ml-auto flex flex-wrap gap-2">
          <Select value={workerFilter} onValueChange={setWorkerFilter}>
            <SelectTrigger className="h-8 flex-1 sm:w-[170px] rounded-lg text-[12px]" style={{ borderColor: BORDER }}>
              <SelectValue placeholder={translate("coordinator.rostering.allWorkers")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{translate("coordinator.rostering.allWorkers")}</SelectItem>
              {workers.map((w) => <SelectItem key={w.id} value={w.id}>{w.full_name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 flex-1 sm:w-[145px] rounded-lg text-[12px]" style={{ borderColor: BORDER }}>
              <SelectValue placeholder={translate("coordinator.rostering.allStatuses")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{translate("coordinator.rostering.allStatuses")}</SelectItem>
              <SelectItem value="scheduled">{translate("coordinator.rostering.status.scheduled")}</SelectItem>
              <SelectItem value="in_progress">{translate("coordinator.rostering.status.active")}</SelectItem>
              <SelectItem value="completed">{translate("coordinator.rostering.status.completed")}</SelectItem>
              <SelectItem value="cancelled">{translate("coordinator.rostering.status.cancelled")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {shiftsQuery.isLoading && <Loader2 className="h-4 w-4 animate-spin" style={{ color: MUTED }} />}
      </div>

      {shiftsQuery.error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          <AlertCircle size={15} className="shrink-0" />
          {translate("coordinator.rostering.loadError")}
        </div>
      )}

      {viewMode === "month" && (
        <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
          <MonthGrid month={currentMonth} shifts={shifts} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
          <DayPanel day={selectedDay} shifts={shifts} workers={workers} onAssign={() => setAssignOpen(true)} />
        </div>
      )}

      {viewMode === "week" && (
        <RosterGrid
          weekStart={weekStart}
          shifts={shifts}
          workers={workers}
          availMap={availMap}
          loadingAvail={loadingAvail}
          onCellClick={(worker, date) => {
            setAssignTarget({ worker, date });
            setAssignOpen(true);
          }}
        />
      )}

      {viewMode === "list" && (
        <div className="rounded-2xl border bg-white overflow-hidden" style={{ borderColor: BORDER }}>
          <div
            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-[2fr_2fr_1.4fr_1.2fr_1fr] gap-2 px-4 py-3 text-[10px] font-black uppercase tracking-widest"
            style={{ color: MUTED, borderBottom: `1px solid ${BORDER}`, background: SOFT }}
          >
            <span>{translate("common.participant")}</span><span className="hidden sm:inline">{translate("common.worker")}</span><span className="hidden md:inline">{translate("coordinator.rostering.list.dateTime")}</span><span className="hidden md:inline">{translate("coordinator.rostering.list.shiftType")}</span><span className="hidden sm:inline">{translate("coordinator.rostering.list.status")}</span>
          </div>
          <div>
            {shifts.length === 0 && !shiftsQuery.isLoading && (
              <div className="py-16 text-center">
                <Users2 className="mx-auto mb-2" size={24} style={{ color: MUTED }} />
                <p className="text-[13px] font-bold" style={{ color: TEXT }}>{translate("coordinator.rostering.list.noMatch")}</p>
                <p className="mt-1 text-[11px]" style={{ color: MUTED }}>{translate("coordinator.rostering.list.noMatchHint")}</p>
              </div>
            )}
            {shifts.map((shift) => {
              const cfg   = statusCfg(shift.status, translate);
              const start = parseStart(shift);
              const end   = shift.scheduled_end ? parseISO(shift.scheduled_end) : null;
              return (
                <div
                  key={shift.id}
                  className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-[2fr_2fr_1.4fr_1.2fr_1fr] gap-2 items-center px-4 py-3 text-sm hover:bg-[#F8F6FE] transition-colors"
                  style={{ borderBottom: `1px solid ${BORDER}` }}
                >
                  <p className="truncate font-bold" style={{ color: TEXT }}>{shift.participant_name || translate("common.participant")}</p>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black text-white" style={{ background: "var(--cc-text)" }}>
                      {(shift.worker_name || "W").split(" ").map((p: string) => p[0]).join("").slice(0, 2)}
                    </div>
                    <p className="truncate text-[12px]" style={{ color: MUTED }}>{shift.worker_name || translate("common.worker")}</p>
                  </div>
                  <div>
                    {start ? (
                      <>
                        <p className="text-[12px] font-bold" style={{ color: TEXT }}>{format(start, "d MMM yyyy")}</p>
                        <p className="text-[11px]" style={{ color: MUTED }}>{format(start, "h:mm a")}{end ? ` – ${format(end, "h:mm a")}` : ""}</p>
                      </>
                    ) : <span style={{ color: MUTED }}>N/A</span>}
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
        onOpenChange={(open) => { setAssignOpen(open); if (!open) setAssignTarget(null); }}
        worker={assignTarget?.worker ?? assignWorker}
        workers={workers}
        initialDate={assignTarget?.date}
      />

      {/* -- Schedule (DnD) view -------------------------------------------- */}
      {viewMode === "schedule" && (
        <div className="space-y-4">
          {/* Period nav for schedule view */}
          <div className="flex items-center gap-2 rounded-2xl border bg-white px-4 py-3" style={{ borderColor: BORDER }}>
            <button
              title={translate("coordinator.rostering.previousWeek")}
              onClick={handlePrev}
              className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-[#F8F6FE]"
              style={{ borderColor: BORDER }}
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              {format(weekStart, "d MMM")} – {format(addDays(weekStart, 6), "d MMM yyyy")}
            </span>
            <button title={translate("coordinator.rostering.nextWeek")} onClick={handleNext}
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
              {translate("coordinator.rostering.todayBtn")}
            </button>
            <div className="ml-auto text-[11px] font-medium" style={{ color: MUTED }}>
              {translate("coordinator.rostering.dragHint")}
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
              {translate("coordinator.rostering.workerAvailability")}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {workers.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setAvailWorker((prev) => prev?.id === w.id ? null : w)}
                  className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-[#F4EDE6]"
                  style={{
                    borderColor: availWorker?.id === w.id ? PLUM : BORDER,
                    background:  availWorker?.id === w.id ? "#FCE3EB" : "var(--cc-bg)",
                  }}
                >
                  <div
                    className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black text-white"
                    style={{ background: "var(--cc-cta)" }}
                  >
                    {w.full_name.split(" ").map((p: string) => p[0]).join("").slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-bold" style={{ color: PLUM }}>{w.full_name.split(" ")[0]}</p>
                    <p className="text-[10px] flex items-center gap-1" style={{ color: MUTED }}>
                      <Settings2 size={9} /> {translate("common.settings")}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* -- Bulk/Recurring shift modal ------------------------------------- */}
      <BulkShiftModal
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        participants={participantList}
        workers={workers}
      />
      </>
      )}
    </div>
  );
}
