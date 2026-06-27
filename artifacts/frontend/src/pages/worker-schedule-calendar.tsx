import { useCallback, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  differenceInMinutes,
} from "date-fns";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useMutation } from "@tanstack/react-query";
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock3, Link2, List, Loader2, MapPin, Printer,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  anonymiseName,
  formatShiftBlockTime,
  shiftBlockStyle,
} from "@/components/shifts/ShiftCalendarDetailSheet";
import { WorkerShiftConfirmDialog } from "@/components/shifts/WorkerShiftConfirmDialog";
import {
  createCalendarFeedToken,
  getWorkerCalendar,
  type CalendarShift,
  type TimeOffBlock,
} from "@/services/workerCalendarService";
import { BORDER, CORAL, MUTED, PLUM, SOFT, TEXT } from "@/lib/shift-utils";

type ViewMode = "month" | "week";

const MIN_BLOCK_PX = 30;

function shiftOnLocalDay(shift: CalendarShift, d: Date): boolean {
  if (!shift.scheduled_start) return false;
  try {
    return isSameDay(parseISO(shift.scheduled_start), d);
  } catch {
    return shift.scheduled_start.startsWith(format(d, "yyyy-MM-dd"));
  }
}

function shiftsOnDay(shifts: CalendarShift[], d: Date) {
  return shifts.filter((s) => shiftOnLocalDay(s, d));
}

function timeOffOnDay(blocks: TimeOffBlock[], d: Date) {
  const key = format(d, "yyyy-MM-dd");
  return blocks.filter((b) => {
    const start = (b.start_date ?? "").slice(0, 10);
    const end = (b.end_date ?? "").slice(0, 10);
    return start <= key && end >= key;
  });
}

function parseStart(shift: CalendarShift): Date | null {
  if (!shift.scheduled_start) return null;
  try {
    return parseISO(shift.scheduled_start);
  } catch {
    return null;
  }
}

function shiftStatusCfg(shift: CalendarShift) {
  const s = (shift.status || "").toLowerCase();
  if (s === "in_progress" || s === "clocked_in") {
    return { label: "Active", bg: "#DBEAFE", color: "#1D4ED8" };
  }
  if (s === "completed") {
    return { label: "Completed", bg: "#DCFCE7", color: "#166534" };
  }
  if (shift.calendar_status === "cancelled" || s === "cancelled") {
    return { label: "Cancelled", bg: "#F1F5F9", color: "#64748B" };
  }
  if (shift.calendar_status === "tentative") {
    return { label: "Tentative", bg: "#FEF3C7", color: "#D97706" };
  }
  return { label: "Scheduled", bg: "#EDE9FF", color: 'var(--cc-plum)' };
}

function WorkerShiftChip({
  shift,
  onClick,
}: {
  shift: CalendarShift;
  onClick: () => void;
}) {
  const style = shiftBlockStyle(shift);
  const d = parseStart(shift);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-bold leading-tight"
      style={{ background: style.background as string, color: style.color as string }}
    >
      {shift.participant_first_name || shift.participant_name?.split(" ")[0] || "—"}
      {d ? ` ${format(d, "HH:mm")}` : ""}
    </button>
  );
}

function WorkerMonthGrid({
  month,
  shifts,
  timeOff,
  selectedDay,
  onSelectDay,
  onShiftClick,
}: {
  month: Date;
  shifts: CalendarShift[];
  timeOff: TimeOffBlock[];
  selectedDay: Date;
  onSelectDay: (d: Date) => void;
  onShiftClick: (shift: CalendarShift) => void;
}) {
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, CalendarShift[]>();
    for (const s of shifts) {
      const d = parseStart(s);
      if (!d) continue;
      const key = format(d, "yyyy-MM-dd");
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  }, [shifts]);

  return (
    <div className="rounded-2xl border bg-cc-surface overflow-hidden" style={{ borderColor: BORDER }}>
      <div
        className="grid grid-cols-7"
        style={{ borderBottom: `1px solid ${BORDER}`, background: SOFT }}
      >
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div
            key={d}
            className="py-2.5 text-center text-[10px] font-black uppercase tracking-widest"
            style={{ color: MUTED }}
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayShifts = (shiftsByDay.get(key) ?? []).sort((a, b) =>
            (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? ""),
          );
          const off = timeOffOnDay(timeOff, day);
          const isSelected = isSameDay(day, selectedDay);
          const today = isToday(day);
          const inMonth = isSameMonth(day, month);

          return (
            <div
              key={key}
              onClick={() => onSelectDay(day)}
              className="min-h-[88px] cursor-pointer p-1.5 transition-colors hover:bg-cc-bg"
              style={{
                borderBottom: `1px solid ${BORDER}`,
                borderRight: `1px solid ${BORDER}`,
                background: isSelected ? "#F0ECFF" : 'var(--cc-surface)',
                opacity: inMonth ? 1 : 0.38,
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
                {(dayShifts.length > 0 || off.length > 0) && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[9px] font-black"
                    style={{ background: SOFT, color: PLUM }}
                  >
                    {dayShifts.length + (off.length > 0 && dayShifts.length === 0 ? 1 : 0)}
                  </span>
                )}
              </div>
              {off.length > 0 && (
                <div className="mb-0.5 truncate rounded px-1.5 py-0.5 text-[9px] font-bold text-slate-600 bg-slate-200">
                  Time off
                </div>
              )}
              <div className="space-y-0.5">
                {dayShifts.slice(0, 2).map((s) => (
                  <WorkerShiftChip key={s.id} shift={s} onClick={() => onShiftClick(s)} />
                ))}
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

function WorkerDayPanel({
  day,
  shifts,
  timeOff,
  onShiftClick,
}: {
  day: Date;
  shifts: CalendarShift[];
  timeOff: TimeOffBlock[];
  onShiftClick: (shift: CalendarShift) => void;
}) {
  const dayShifts = useMemo(
    () =>
      shifts
        .filter((s) => shiftOnLocalDay(s, day))
        .sort((a, b) => (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? "")),
    [shifts, day],
  );
  const off = timeOffOnDay(timeOff, day);

  return (
    <div className="flex flex-col rounded-2xl border bg-cc-surface" style={{ borderColor: BORDER }}>
      <div
        className="flex items-center justify-between px-4 py-3.5"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: MUTED }}>
            {format(day, "EEEE")}
          </p>
          <p className="text-xl font-black" style={{ color: isToday(day) ? PLUM : TEXT }}>
            {format(day, "d MMMM yyyy")}
          </p>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-[11px] font-black"
          style={{ background: SOFT, color: PLUM }}
        >
          {dayShifts.length} {dayShifts.length === 1 ? "shift" : "shifts"}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[560px] px-3 py-3 space-y-2">
        {off.map((b) => (
          <div
            key={b.request_id}
            className="rounded-xl border border-l-[3px] border-l-slate-400 bg-slate-100 p-3.5"
            style={{ borderColor: BORDER }}
          >
            <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-[10px] font-black uppercase text-slate-600">
              Time off
            </span>
            <p className="mt-2 text-[13px] font-bold" style={{ color: TEXT }}>
              Approved leave
            </p>
          </div>
        ))}
        {dayShifts.length === 0 && off.length === 0 ? (
          <div className="py-14 text-center">
            <CalendarDays className="mx-auto mb-2" size={22} style={{ color: MUTED }} />
            <p className="text-[13px] font-bold" style={{ color: TEXT }}>
              No shifts scheduled
            </p>
            <p className="mt-1 text-[11px]" style={{ color: MUTED }}>
              Select another day or check your list view.
            </p>
          </div>
        ) : (
          dayShifts.map((shift) => {
            const cfg = shiftStatusCfg(shift);
            const start = parseStart(shift);
            const end = shift.scheduled_end ? parseISO(shift.scheduled_end) : null;
            const durMs = start && end ? end.getTime() - start.getTime() : null;
            const durH = durMs != null ? (durMs / 3600000).toFixed(1) : null;

            return (
              <button
                key={shift.id}
                type="button"
                onClick={() => onShiftClick(shift)}
                className="w-full rounded-xl border p-3.5 text-left transition-colors hover:bg-cc-bg"
                style={{
                  borderColor: BORDER,
                  borderLeftWidth: 3,
                  borderLeftColor: cfg.color,
                }}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase"
                    style={{ background: cfg.bg, color: cfg.color }}
                  >
                    {cfg.label}
                  </span>
                  <span className="flex items-center gap-1 text-[11px]" style={{ color: MUTED }}>
                    <Clock3 size={11} />
                    {start ? format(start, "h:mm a") : "—"}
                    {end ? ` – ${format(end, "h:mm a")}` : ""}
                    {durH ? ` · ${durH}h` : ""}
                  </span>
                </div>
                <p className="text-[14px] font-black" style={{ color: TEXT }}>
                  {shift.participant_name || "Participant"}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {shift.participant_suburb && (
                    <span className="flex items-center gap-1 text-[11px]" style={{ color: MUTED }}>
                      <MapPin size={11} /> {shift.participant_suburb}
                    </span>
                  )}
                  {shift.calendar_status === "tentative" && (
                    <span
                      className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase"
                      style={{ background: SOFT, color: MUTED }}
                    >
                      Awaiting confirmation
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function WorkerScheduleCalendar() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [confirmShift, setConfirmShift] = useState<CalendarShift | null>(null);
  const [feedUrl, setFeedUrl] = useState<string | null>(null);

  const rangeStart = viewMode === "week"
    ? weekStart
    : startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const rangeEnd = viewMode === "week"
    ? endOfWeek(weekStart, { weekStartsOn: 1 })
    : endOfWeek(endOfMonth(month), { weekStartsOn: 1 });

  const { data, isLoading, isError, error } = useOrgQuery(
    ["worker", "calendar", format(rangeStart, "yyyy-MM-dd"), format(rangeEnd, "yyyy-MM-dd")],
    {
      queryFn: () =>
        getWorkerCalendar(format(rangeStart, "yyyy-MM-dd"), format(rangeEnd, "yyyy-MM-dd")),
    },
  );

  const shifts = data?.shifts ?? [];
  const timeOff = data?.time_off_blocks ?? [];

  const weekDays = useMemo(() => {
    return eachDayOfInterval({
      start: weekStart,
      end: endOfWeek(weekStart, { weekStartsOn: 1 }),
    });
  }, [weekStart]);

  const feedMut = useMutation({
    mutationFn: createCalendarFeedToken,
    onSuccess: (res) => {
      const full = `${window.location.origin}${res.feed_path}.ics`;
      setFeedUrl(full);
      void navigator.clipboard?.writeText(full);
      toast({ title: "Calendar link copied", description: "Subscribe in your phone calendar app." });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const handlePrint = useCallback(async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const title = format(month, "MMMM yyyy");
    doc.setFontSize(16);
    doc.text(`My Schedule — ${title}`, 14, 18);
    doc.setFontSize(9);
    let y = 28;
    const confirmed = shifts.filter(
      (s) => s.calendar_status === "confirmed" && s.status !== "cancelled",
    );
    for (const day of eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) })) {
      const dayShifts = shiftsOnDay(confirmed, day);
      if (!dayShifts.length) continue;
      if (y > 270) {
        doc.addPage();
        y = 18;
      }
      doc.setFont("helvetica", "bold");
      doc.text(format(day, "EEE d MMM"), 14, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      for (const s of dayShifts) {
        const line = `${formatShiftBlockTime(s.scheduled_start, s.scheduled_end)} — ${anonymiseName(s.participant_name)}`;
        doc.text(line, 18, y);
        y += 5;
      }
      y += 3;
    }
    doc.save(`schedule-${format(month, "yyyy-MM")}.pdf`);
  }, [month, shifts]);

  const handleShiftClick = (shift: CalendarShift) => {
    setConfirmShift(shift);
  };

  const handleSelectDay = (day: Date) => {
    setSelectedDay(day);
    if (!isSameMonth(day, month)) {
      setMonth(startOfMonth(day));
    }
  };

  const navigatePrev = () => {
    if (viewMode === "month") setMonth((m) => subMonths(m, 1));
    else setWeekStart((w) => new Date(w.getTime() - 7 * 86400000));
  };
  const navigateNext = () => {
    if (viewMode === "month") setMonth((m) => addMonths(m, 1));
    else setWeekStart((w) => new Date(w.getTime() + 7 * 86400000));
  };
  const handleToday = () => {
    const now = new Date();
    setMonth(startOfMonth(now));
    setWeekStart(startOfWeek(now, { weekStartsOn: 1 }));
    setSelectedDay(now);
  };

  const periodLabel = viewMode === "month"
    ? format(month, "MMMM yyyy")
    : `${format(weekStart, "d MMM")} – ${format(endOfWeek(weekStart, { weekStartsOn: 1 }), "d MMM yyyy")}`;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 pb-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
            Support Worker
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>
            My Schedule
          </h1>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>
            View your shifts, time off, and calendar subscription.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/my-shifts">
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-black"
              style={{ borderColor: BORDER, color: PLUM }}
            >
              <List size={14} /> List view
            </button>
          </Link>
          <Link href="/my-shifts/requests">
            <button
              type="button"
              className="rounded-full border px-3 py-2 text-xs font-black"
              style={{ borderColor: BORDER, color: PLUM }}
            >
              Requests
            </button>
          </Link>
          <Link href="/worker/availability">
            <button
              type="button"
              className="rounded-full border px-3 py-2 text-xs font-black"
              style={{ borderColor: BORDER, color: PLUM }}
            >
              Availability
            </button>
          </Link>
        </div>
      </header>

      <div
        className="flex flex-wrap items-center gap-3 rounded-2xl border bg-cc-surface px-4 py-3"
        style={{ borderColor: BORDER }}
      >
        <div className="flex overflow-hidden rounded-xl border" style={{ borderColor: BORDER }}>
          {(["month", "week"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setViewMode(m)}
              className="px-4 py-2 text-[12px] font-bold capitalize transition-colors"
              style={{ background: viewMode === m ? PLUM : 'var(--cc-surface)', color: viewMode === m ? "white" : MUTED }}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={navigatePrev}
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-cc-bg"
            style={{ borderColor: BORDER }}
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-[160px] text-center text-[13px] font-black" style={{ color: TEXT }}>
            {periodLabel}
          </span>
          <button
            type="button"
            onClick={navigateNext}
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-cc-bg"
            style={{ borderColor: BORDER }}
          >
            <ChevronRight size={15} />
          </button>
          <button
            type="button"
            onClick={handleToday}
            className="rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors hover:bg-cc-bg"
            style={{ borderColor: BORDER, color: PLUM }}
          >
            Today
          </button>
        </div>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" style={{ color: MUTED }} />}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => feedMut.mutate()}
            className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-black text-white"
            style={{ background: PLUM }}
          >
            <Link2 size={14} /> {feedMut.isPending ? "Generating…" : "Share calendar"}
          </button>
          <button
            type="button"
            onClick={() => void handlePrint()}
            className="flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-black"
            style={{ borderColor: BORDER, color: PLUM }}
          >
            <Printer size={14} /> Print PDF
          </button>
        </div>
      </div>

      {feedUrl && (
        <div className="rounded-xl border bg-cc-bg p-3 text-xs" style={{ borderColor: BORDER }}>
          <p className="font-black" style={{ color: TEXT }}>iCal subscription URL</p>
          <p className="mt-1 break-all font-mono" style={{ color: MUTED }}>{feedUrl}</p>
        </div>
      )}

      {isError && (
        <div
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 dark:border-[var(--cc-status-critical)] dark:bg-[var(--cc-status-critical-bg)] dark:text-[var(--cc-status-critical)]"
        >
          Could not load calendar: {(error as Error)?.message || "Please try again."}
        </div>
      )}

      {viewMode === "month" && !isLoading && !isError && (
        <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
          <WorkerMonthGrid
            month={month}
            shifts={shifts}
            timeOff={timeOff}
            selectedDay={selectedDay}
            onSelectDay={handleSelectDay}
            onShiftClick={handleShiftClick}
          />
          <WorkerDayPanel
            day={selectedDay}
            shifts={shifts}
            timeOff={timeOff}
            onShiftClick={handleShiftClick}
          />
        </div>
      )}

      {viewMode === "week" && !isLoading && !isError && (
        <div className="space-y-2">
          {weekDays.map((day) => {
            const dayShifts = shiftsOnDay(shifts, day).sort((a, b) =>
              (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? ""),
            );
            const off = timeOffOnDay(timeOff, day);
            return (
              <div
                key={day.toISOString()}
                className="rounded-2xl border bg-cc-surface p-3"
                style={{ borderColor: BORDER }}
              >
                <p className="mb-2 text-xs font-black uppercase" style={{ color: isToday(day) ? PLUM : MUTED }}>
                  {format(day, "EEE d MMM")}
                </p>
                {off.length > 0 && (
                  <div className="mb-2 rounded-lg bg-slate-200 px-3 py-2 text-xs font-bold text-slate-600">
                    Time off
                  </div>
                )}
                <div className="space-y-2">
                  {dayShifts.map((shift) => {
                    const mins = shift.scheduled_start && shift.scheduled_end
                      ? Math.max(30, differenceInMinutes(parseISO(shift.scheduled_end), parseISO(shift.scheduled_start)))
                      : 30;
                    const height = Math.max(MIN_BLOCK_PX, (mins / 30) * (MIN_BLOCK_PX / 2));
                    const style = shiftBlockStyle(shift);
                    return (
                      <button
                        key={shift.id}
                        type="button"
                        onClick={() => handleShiftClick(shift)}
                        className="w-full rounded-lg px-3 py-2 text-left transition-opacity hover:opacity-90"
                        style={{ ...style, minHeight: height }}
                      >
                        <p className="text-sm font-black">{shift.participant_first_name || "Shift"}</p>
                        <p className="text-xs font-semibold opacity-90">
                          {formatShiftBlockTime(shift.scheduled_start, shift.scheduled_end)}
                        </p>
                        {shift.participant_suburb && (
                          <p className="text-[11px] font-medium opacity-80">{shift.participant_suburb}</p>
                        )}
                      </button>
                    );
                  })}
                  {!dayShifts.length && !off.length && (
                    <p className="text-xs font-medium py-2" style={{ color: MUTED }}>No shifts</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isLoading && viewMode === "month" && (
        <div className="rounded-2xl border bg-cc-surface p-8 text-center animate-pulse" style={{ borderColor: BORDER }}>
          <CalendarDays className="mx-auto mb-2 opacity-40" />
          Loading schedule…
        </div>
      )}

      <div
        className="flex flex-wrap gap-4 rounded-xl border bg-cc-surface px-4 py-3 text-[11px] font-bold"
        style={{ borderColor: BORDER }}
      >
        <LegendItem label="Confirmed" swatch={{ background: PLUM }} />
        <LegendItem
          label="Tentative"
          swatch={{
            background: `repeating-linear-gradient(45deg, ${PLUM}44, ${PLUM}44 4px, ${PLUM}22 4px, ${PLUM}22 8px)`,
          }}
        />
        <LegendItem label="Cancelled" swatch={{ background: "#CBD5E1", textDecoration: "line-through" }} />
        <LegendItem label="Time off" swatch={{ background: "#E2E8F0" }} />
      </div>

      <WorkerShiftConfirmDialog
        shift={confirmShift}
        open={!!confirmShift}
        onOpenChange={(open) => !open && setConfirmShift(null)}
        onViewDetails={() => {
          if (!confirmShift?.id) return;
          const shiftId = confirmShift.id;
          setConfirmShift(null);
          setLocation(`/my-shifts/${shiftId}`);
        }}
      />
    </div>
  );
}

function LegendItem({ label, swatch }: { label: string; swatch: React.CSSProperties }) {
  return (
    <span className="flex items-center gap-2" style={{ color: MUTED }}>
      <span className="h-3 w-6 rounded" style={swatch} />
      {label}
    </span>
  );
}
