/**
 * RosterBoard — unified drag-and-drop weekly roster.
 * Replaces the separate "week" (click-only) and "schedule" (hourly DnD) views
 * with a single day-grained worker × day grid: click OR drag to assign,
 * drag a card between workers/days (same day only) to reassign, availability
 * shading shows where a coordinator can safely drop a shift.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { format, addDays, isToday, parseISO, differenceInMinutes, eachDayOfInterval, getDay } from "date-fns";
import {
  AlertTriangle, ChevronRight, Clock3, GripVertical,
  Loader2, Minus, Plus, User2, Users, XCircle, MinusCircle, CalendarPlus,
} from "lucide-react";
import {
  assignExistingShift,
  getWorkerConflicts,
  rescheduleShift,
  unassignShift,
  type CoordinatorShiftRecord,
  type WorkerStats,
  type ConflictItem,
  type BlackoutDate,
} from "@/services/coordinatorService";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { UnassignedShiftPanel } from "@/components/coordinator/UnassignedShiftPanel";
import { ConflictModal, type PendingDrop } from "@/components/coordinator/ConflictModal";
import { ZoneLabel } from "@/components/branches/ZoneLabel";
import { PersonPreview } from "./PersonPreview";
import { PersonPhoto } from "@/components/ui/person-photo";
import { sharedNames } from "@/lib/person-identity";
import { ShiftHoverCard, shiftLiveStatus } from "./ShiftHoverCard";
import {
  FIT_COLORS,
  OPEN_ROW_ID,
  UNASSIGNED_PLACEHOLDER_ID,
  dayAvailability,
  isOpenShift,
  workerFit,
  type AvailabilityMap,
  type Fit,
} from "./rosterShared";
import { CALENDAR_LEGEND, CALENDAR_MINUTE_PX, RosterCalendar, snapMinutes, swallowNextClick } from "./RosterCalendar";
import { appLocalDateKey, appMinutesOfDay, datetimeLocalValueToUtcIso, formatAppTime } from "@/lib/datetime";
import { clock } from "./rosterShared";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

const STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  unassigned:  { bg: "#FEF2F2", color: "#DC2626", border: "#FCA5A5" },
  scheduled:   { bg: "#FCE3EB", color: "#E8457A", border: "#F3A8C4" },
  in_progress: { bg: "#DBEAFE", color: "#1D4ED8", border: "#93C5FD" },
  clocked_in:  { bg: "#DBEAFE", color: "#1D4ED8", border: "#93C5FD" },
  completed:   { bg: "#DCFCE7", color: "#166534", border: "#86EFAC" },
  cancelled:   { bg: "#F1F5F9", color: "#64748B", border: "#CBD5E1" },
};
function statusColors(status?: string | null) {
  return STATUS_COLORS[status ?? ""] ?? STATUS_COLORS.scheduled;
}

/** Deterministic, cheerful avatar color per worker — purely decorative variety. */
const AVATAR_PALETTE = [
  { bg: "#F3E8FF", fg: "#7C3AED" },
  { bg: "#FCE3EB", fg: "#DB2777" },
  { bg: "#DBEAFE", fg: "#1D4ED8" },
  { bg: "#DCFCE7", fg: "#15803D" },
  { bg: "#FEF3C7", fg: "#B45309" },
  { bg: "#E0F2FE", fg: "#0369A1" },
];
function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
function initials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}
function parseStart(s: CoordinatorShiftRecord): Date | null {
  if (!s.scheduled_start) return null;
  try { return parseISO(s.scheduled_start); } catch { return null; }
}
/** ISO weekday (1 = Monday … 7 = Sunday) — the numbering worker
 * availability is saved in (WorkerAvailabilityPanel, the matching and
 * capacity services). This used to be 0 = Monday, which shifted every
 * worker's availability by a day: Mondays showed as unavailable (no way to
 * add a shift, and any shift already there hidden) and Saturdays as open. */
export function isoWeekday(date: Date): number {
  const js = getDay(date); // 0=Sun..6=Sat
  return js === 0 ? 7 : js;
}
function isBlackout(date: Date, blackouts: BlackoutDate[] = []): boolean {
  const key = format(date, "yyyy-MM-dd");
  return blackouts.some((b) => b.start_date <= key && key <= b.end_date);
}

// ── Draggable shift chip (unassigned tray + assigned cells) ──────────────────
function ShiftCard({
  shift, dimmed = false, onClick, colorBy = "status",
}: { shift: CoordinatorShiftRecord; dimmed?: boolean; onClick?: () => void; colorBy?: "status" | "worker" }) {
  const { translate } = useAccessibility();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: shift.id,
    data: { shift },
  });
  const clrs = statusColors(shift.status);
  const start = parseStart(shift);
  const end = shift.scheduled_end ? parseISO(shift.scheduled_end) : null;

  if (colorBy === "worker") {
    // One colour per worker so a row reads as that person's week; status is
    // a dot (on shift / not clocked in) and the hover card has the detail.
    const tint = avatarColor(shift.worker_name || "Worker");
    const live = shiftLiveStatus(shift);
    const dot = live === "on_shift" ? "var(--cc-status-success)" : live === "late" ? "var(--cc-status-danger)" : null;
    return (
      <ShiftHoverCard shift={shift}>
        <div
          ref={setNodeRef}
          style={{
            transform: CSS.Translate.toString(transform),
            opacity: isDragging ? 0.25 : dimmed || live === "cancelled" ? 0.5 : 1,
            background: tint.bg,
            boxShadow: live === "on_shift" ? `inset 0 0 0 1.5px ${tint.fg}` : undefined,
            cursor: onClick ? "pointer" : "grab",
          }}
          {...listeners}
          {...attributes}
          onClick={onClick}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); onClick?.(); } else { listeners?.onKeyDown?.(event); } }}
          className="select-none rounded-lg px-2.5 py-2 transition-shadow hover:shadow-md"
        >
          <p
            className="flex items-center gap-1.5 text-[11.5px] font-bold leading-tight"
            style={{ color: "#1A1A2E", textDecoration: live === "cancelled" ? "line-through" : undefined }}
          >
            {dot && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />}
            {start ? `${formatAppTime(shift.scheduled_start!, shift.timezone)}${end ? ` – ${formatAppTime(shift.scheduled_end!, shift.timezone)}` : ""}` : ""}
            {start && <ZoneLabel tz={shift.timezone} at={shift.scheduled_start!} />}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px]" style={{ color: tint.fg }}>
            {shift.is_shadow_shift && <Users size={10} aria-label="Shadow shift" className="shrink-0" />}
            <span className="truncate">{shift.participant_name || translate("common.participant")}</span>
          </p>
        </div>
      </ShiftHoverCard>
    );
  }

  return (
    <ShiftHoverCard shift={shift}>
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.25 : dimmed ? 0.5 : 1,
        borderLeftColor: clrs.border,
        background: clrs.bg,
        cursor: onClick ? "pointer" : "grab",
      }}
      {...listeners}
      {...attributes}
      onClick={onClick}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); onClick?.(); } else { listeners?.onKeyDown?.(event); } }}
      className="group flex items-start gap-1 rounded-lg border-l-[3px] px-2 py-1.5 select-none shadow-sm transition-shadow hover:shadow-md"
    >
      <GripVertical size={10} className="mt-0.5 shrink-0 opacity-40 group-hover:opacity-80" style={{ color: clrs.color }} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 truncate text-[10.5px] font-black leading-tight" style={{ color: clrs.color }}>
          {shift.is_shadow_shift && (
            <span
              className="inline-flex shrink-0"
              title={shift.shadow_of_worker_name ? `Shadowing ${shift.shadow_of_worker_name}` : "Shadow shift"}
            >
              <Users size={10} aria-label="Shadow shift" />
            </span>
          )}
          <span className="truncate">{shift.participant_name || translate("common.participant")}</span>
        </p>
        {start && (
          <p className="truncate text-[9.5px] font-medium opacity-80" style={{ color: clrs.color }}>
            {formatAppTime(shift.scheduled_start!, shift.timezone)}{end ? `–${formatAppTime(shift.scheduled_end!, shift.timezone)}` : ""}
            <ZoneLabel tz={shift.timezone} at={shift.scheduled_start!} className="ml-1" />
          </p>
        )}
      </div>
    </div>
    </ShiftHoverCard>
  );
}

function ShiftDragClone({ shift }: { shift: CoordinatorShiftRecord }) {
  const { translate } = useAccessibility();
  const clrs = statusColors(shift.status);
  const start = parseStart(shift);
  const end = shift.scheduled_end ? parseISO(shift.scheduled_end) : null;
  return (
    <div
      className="w-48 rotate-2 rounded-xl border-2 shadow-2xl px-3 py-2.5"
      style={{ borderColor: clrs.border, background: clrs.bg, cursor: "grabbing" }}
    >
      <p className="text-[12px] font-black" style={{ color: clrs.color }}>
        {shift.participant_name || translate("common.participant")}
      </p>
      {start && (
        <p className="text-[11px] font-medium opacity-80" style={{ color: clrs.color }}>
          {format(start, "EEE d MMM")}, {formatAppTime(shift.scheduled_start!, shift.timezone)}{end ? ` – ${formatAppTime(shift.scheduled_end!, shift.timezone)}` : ""}
          <ZoneLabel tz={shift.timezone} at={shift.scheduled_start!} className="ml-1" />
        </p>
      )}
    </div>
  );
}

// ── Droppable worker × day cell ───────────────────────────────────────────────
function DayCell({
  workerId, dayIso, disabled, cellBg, children, style, minWidth = 132, fit,
}: {
  minWidth?: number;
  /** While a shift is dragged: how this worker suits it, which colours the drop. */
  fit?: Fit;
  workerId: string;
  dayIso: string;
  disabled: boolean;
  cellBg: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `${workerId}|${dayIso}`,
    data: { workerId, dayIso },
    disabled,
  });
  return (
    <td
      ref={setNodeRef}
      className="px-1.5 py-1.5 align-top transition-colors"
      style={{
        background: isOver && !disabled ? (fit ? FIT_COLORS[fit.tone].bg : "var(--cc-plum-soft)") : cellBg,
        boxShadow: isOver && !disabled && fit ? `inset 0 0 0 2px ${FIT_COLORS[fit.tone].border}` : undefined,
        opacity: disabled ? 0.4 : 1,
        minWidth,
        minHeight: 56,
        ...style,
      }}
    >
      {children}
    </td>
  );
}

// ── Unassign confirmation modal ───────────────────────────────────────────────
// (ConflictModal + PendingDrop now live in ./ConflictModal.tsx — shared with
// UnassignedShiftPanel so every assign-a-worker entry point confirms the same way.)

function UnassignModal({
  shift, workerName, onConfirm, onCancel, confirming, warning,
}: {
  shift: CoordinatorShiftRecord; workerName: string; onConfirm: () => void; onCancel: () => void; confirming: boolean; warning?: string;
}) {
  const { translate, translateParams } = useAccessibility();
  const start = parseStart(shift);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-white shadow-2xl" style={{ borderColor: BORDER }}>
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <h2 className="text-[15px] font-black" style={{ color: TEXT }}>{translate("coordinator.dnd.removeWorker")}</h2>
          <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
            {translateParams("coordinator.dnd.removeWorkerDesc", {
              worker: workerName,
              shift: shift.participant_name || translate("coordinator.dnd.thisShift"),
              date: start ? ` on ${format(start, "d MMM")}` : "",
            })}
          </p>
        </div>
        {warning && (
          <div className="mx-5 my-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            <AlertTriangle size={12} className="text-amber-600" />
            <p className="text-[11px] font-medium text-amber-800">{warning}</p>
          </div>
        )}
        <div className="flex justify-end gap-2 px-5 py-4">
          <button onClick={onCancel} className="rounded-full px-4 py-1.5 text-[12px] font-bold" style={{ background: SOFT, color: MUTED }}>
            {translate("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={confirming}
            className="rounded-full px-4 py-1.5 text-[12px] font-bold text-white"
            style={{ background: CORAL, opacity: confirming ? 0.65 : 1 }}
          >
            {confirming ? translate("coordinator.dnd.removing") : translate("coordinator.dnd.removeWorkerBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main board ─────────────────────────────────────────────────────────────
interface RosterBoardProps {
  newShiftId?: string | null;
  weekStart: Date;
  shifts: CoordinatorShiftRecord[];
  workers: WorkerStats[];
  availMap: AvailabilityMap;
  loadingAvail: boolean;
  onCellClick: (worker: WorkerStats, dateKey: string) => void;
  /** Adds an open (unassigned) shift on a day, from the open shifts row. */
  onOpenShiftCreate?: (dateKey: string) => void;
  onRefresh: () => void;
  /** "worker" gives each worker's shifts their own colour (Master Schedule). */
  colorBy?: "status" | "worker";
  /** False hides the "+" add-shift buttons, for viewers who can't create shifts. */
  allowCreate?: boolean;
  /** Seven days from weekStart, fourteen, or one day as a calendar. */
  view?: "week" | "fortnight" | "day";
  /** The day view's day, yyyy-MM-dd. */
  dayKey?: string;
  /** Day view: add a shift at a time, for a worker or (null) as an open shift. */
  onCreateAt?: (worker: WorkerStats | null, dateKey: string, time: string) => void;
  /** Week and fortnight: a day's heading opens that day on its own. */
  onOpenDay?: (dateKey: string) => void;
  /** Week and fortnight as an hour calendar (day by day, a column per worker), or as cards per day. The day view is always a calendar. */
  layout?: "calendar" | "grid";
}

export function RosterBoard({
  newShiftId, weekStart, shifts, workers, availMap, loadingAvail, onCellClick, onOpenShiftCreate, onRefresh,
  colorBy = "status", allowCreate = true, view = "week", dayKey, onCreateAt, onOpenDay, layout = "grid",
}: RosterBoardProps) {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__";
  const qc = useQueryClient();

  const [activeShift, setActiveShift] = useState<CoordinatorShiftRecord | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [pendingUnassign, setPendingUnassign] = useState<{ shift: CoordinatorShiftRecord; workerName: string; warning?: string } | null>(null);
  const [detailShift, setDetailShift] = useState<CoordinatorShiftRecord | null>(null);

  // Deep-link from a coordinator notification (worker cancelled / offer queue
  // exhausted) — opens the reassignment panel for that shift once it's loaded,
  // then strips the param so it doesn't reopen on refetch or reload.
  const openedFromQueryRef = useRef(false);
  useEffect(() => {
    if (openedFromQueryRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const openId = params.get("openShift");
    if (!openId) return;
    const match = shifts.find((s) => s.id === openId);
    if (!match) return;
    openedFromQueryRef.current = true;
    setDetailShift(match);
    params.delete("openShift");
    const next = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
  }, [shifts]);

  const dayCount = view === "fortnight" ? 14 : 7;
  const days = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, dayCount - 1) });
  const colWidth = view === "fortnight" ? 96 : 132;
  const calendar = view === "day" ? !!dayKey : layout === "calendar";

  const byWorkerDay = useMemo(() => {
    const map = new Map<string, CoordinatorShiftRecord[]>();
    for (const s of shifts) {
      const d = parseStart(s);
      if (!d || !s.worker_id || s.worker_id === UNASSIGNED_PLACEHOLDER_ID) continue;
      // Column = the shift's own local day (its participant's branch)
      const key = `${s.worker_id}|${appLocalDateKey(s.scheduled_start!, s.timezone)}`;
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  }, [shifts]);

  const unassigned = useMemo(
    () => shifts.filter((s) => !s.worker_id || s.worker_id === UNASSIGNED_PLACEHOLDER_ID).sort((a, b) => (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? "")),
    [shifts]
  );

  const openByDay = useMemo(() => {
    const map = new Map<string, CoordinatorShiftRecord[]>();
    for (const s of unassigned) {
      if (!s.scheduled_start) continue;
      const key = appLocalDateKey(s.scheduled_start, s.timezone);
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  }, [unassigned]);
  const weekKeys = days.map((d) => format(d, "yyyy-MM-dd"));
  const openThisWeek = weekKeys.reduce((n, key) => n + (openByDay.get(key)?.length ?? 0), 0);
  const openOtherWeeks = unassigned.length - openThisWeek;

  const sameNames = useMemo(() => sharedNames(workers.map((w) => w.full_name)), [workers]);
  // Support workers first: they're who gets rostered. Office staff (who can
  // still pick up a shift) follow, so the rows a rosterer needs lead the board.
  const rosterRows = useMemo(() => {
    const rank = (w: WorkerStats) => ((w.role ?? "support_worker") === "support_worker" ? 0 : 1);
    return [...workers].sort((a, b) => rank(a) - rank(b));
  }, [workers]);
  const weekHoursByWorker = useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of shifts) {
      if (!s.worker_id || s.worker_id === UNASSIGNED_PLACEHOLDER_ID) continue;
      const start = parseStart(s);
      const end = s.scheduled_end ? parseISO(s.scheduled_end) : null;
      if (!start || !end) continue;
      const hrs = (end.getTime() - start.getTime()) / 3_600_000;
      totals.set(s.worker_id, (totals.get(s.worker_id) ?? 0) + Math.max(hrs, 0));
    }
    return totals;
  }, [shifts]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const assignMut = useMutation({
    mutationFn: ({ shiftId, workerId, confirm }: { shiftId: string; workerId: string; confirm: boolean }) =>
      assignExistingShift(shiftId, { worker_id: workerId, confirm_conflicts: confirm }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [orgId, "coordinator"] });
      toast({ title: translate("coordinator.dnd.shiftAssigned"), description: translate("coordinator.dnd.workerNotified") });
      setPendingDrop(null);
      onRefresh();
    },
    onError: (err: Error) => {
      toast({ title: translate("coordinator.dnd.assignmentFailed"), description: err.message, variant: "destructive" });
      setPendingDrop(null);
    },
  });

  const unassignMut = useMutation({
    mutationFn: (shiftId: string) => unassignShift(shiftId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [orgId, "coordinator"] });
      toast({ title: translate("coordinator.dnd.workerRemoved"), description: translate("coordinator.dnd.shiftUnassigned") });
      setPendingUnassign(null);
      onRefresh();
    },
    onError: (err: Error) => {
      toast({ title: translate("coordinator.dnd.unassignFailed"), description: err.message, variant: "destructive" });
      setPendingUnassign(null);
    },
  });

  /** Times can change until the shift starts, and not once it's done or cancelled. */
  const canEditTimes = useCallback((shift: CoordinatorShiftRecord) => {
    if (!allowCreate) return false;
    if (!["scheduled", "unassigned", "offered"].includes(shift.status ?? "scheduled")) return false;
    return !!shift.scheduled_start && new Date(shift.scheduled_start).getTime() > Date.now();
  }, [allowCreate]);

  // Moves or stretches a shift. A clash for its worker (another shift then,
  // leave) stops it; softer warnings (overtime, outside their hours) go
  // through and are said in the confirmation.
  const retimeShift = useCallback(async (shift: CoordinatorShiftRecord, start: string, end: string) => {
    const label = `${clock(appMinutesOfDay(start, shift.timezone))} to ${clock(appMinutesOfDay(end, shift.timezone))}`;
    let warning: string | undefined;
    try {
      if (!isOpenShift(shift)) {
        const check = await getWorkerConflicts(shift.worker_id!, start, end, { participantId: shift.participant_id, excludeShiftId: shift.id });
        const hard = check.conflicts.find((c) => c.severity === "error");
        if (hard) {
          toast({ title: "Couldn't change the time", description: hard.message, variant: "destructive" });
          return;
        }
        warning = [...check.conflicts, ...check.skill_warnings][0]?.message;
      }
      await rescheduleShift(shift.id, { scheduled_start: start, scheduled_end: end });
      qc.invalidateQueries({ queryKey: [orgId, "coordinator"] });
      toast({
        title: `${shift.participant_name ?? "Shift"} now ${label}`,
        description: warning ?? (isOpenShift(shift) ? undefined : `${shift.worker_name ?? "The worker"} has been told.`),
      });
      onRefresh();
    } catch (err) {
      toast({ title: "Couldn't change the time", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }, [qc, orgId, toast, onRefresh]);

  const moveShiftBy = useCallback((shift: CoordinatorShiftRecord, minutes: number) => {
    if (!shift.scheduled_start || !shift.scheduled_end) return;
    const ms = minutes * 60_000;
    void retimeShift(
      shift,
      new Date(new Date(shift.scheduled_start).getTime() + ms).toISOString(),
      new Date(new Date(shift.scheduled_end).getTime() + ms).toISOString(),
    );
  }, [retimeShift]);

  const resizeShift = useCallback((shift: CoordinatorShiftRecord, dayKey: string, endMinute: number) => {
    if (!shift.scheduled_start) return;
    const endDay = endMinute >= 24 * 60 ? format(addDays(parseISO(dayKey), 1), "yyyy-MM-dd") : dayKey;
    const m = endMinute % (24 * 60);
    const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    void retimeShift(shift, shift.scheduled_start, datetimeLocalValueToUtcIso(`${endDay}T${hhmm}`, shift.timezone));
  }, [retimeShift]);

  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    const shift = active.data.current?.shift as CoordinatorShiftRecord | undefined;
    if (shift) setActiveShift(shift);
  }, []);

  const handleDragEnd = useCallback(async ({ active, over, delta }: DragEndEvent) => {
    setActiveShift(null);
    if (calendar) swallowNextClick();
    if (!over || !active.data.current?.shift) return;
    const shift = active.data.current.shift as CoordinatorShiftRecord;
    const { workerId } = over.data.current as { workerId: string; dayIso: string };
    // Calendar: dropped back in its own column, up or down is a new time.
    if (calendar) {
      const ownColumn = workerId === OPEN_ROW_ID ? isOpenShift(shift) : shift.worker_id === workerId;
      if (ownColumn) {
        const minutes = snapMinutes(delta.y / CALENDAR_MINUTE_PX);
        if (minutes !== 0 && canEditTimes(shift)) moveShiftBy(shift, minutes);
        return;
      }
    }
    if (workerId === OPEN_ROW_ID) {
      if (shift.worker_id && shift.worker_id !== UNASSIGNED_PLACEHOLDER_ID) handleUnassignClick(shift);
      return;
    }
    if (!workerId || shift.worker_id === workerId) return;

    const worker = workers.find((w) => w.id === workerId);
    const workerName = worker?.full_name ?? translate("common.worker");
    if (!shift.scheduled_start || !shift.scheduled_end) {
      assignMut.mutate({ shiftId: shift.id, workerId, confirm: false });
      return;
    }

    setCheckingConflicts(true);
    try {
      const result = await getWorkerConflicts(workerId, shift.scheduled_start, shift.scheduled_end, {
        participantId: shift.participant_id,
        excludeShiftId: shift.id,
      });
      setCheckingConflicts(false);
      const allIssues = [...result.conflicts, ...result.skill_warnings];
      if (allIssues.length > 0) {
        setPendingDrop({ shift, workerId, workerName, conflicts: result.conflicts, skillWarnings: result.skill_warnings });
      } else {
        assignMut.mutate({ shiftId: shift.id, workerId, confirm: false });
      }
    } catch {
      setCheckingConflicts(false);
      assignMut.mutate({ shiftId: shift.id, workerId, confirm: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workers, assignMut, translate, calendar, canEditTimes, moveShiftBy]);

  function handleUnassignClick(shift: CoordinatorShiftRecord) {
    const worker = workers.find((w) => w.id === shift.worker_id);
    const workerName = worker?.full_name ?? translate("common.worker");
    const start = parseStart(shift);
    const minsUntil = start ? differenceInMinutes(start, new Date()) : Infinity;
    const warning = minsUntil < 1440 && minsUntil > 0
      ? (minsUntil < 60 ? translateParams("coordinator.dnd.shiftStartsInMins", { mins: String(minsUntil) }) : translateParams("coordinator.dnd.shiftStartsInHours", { hours: String(Math.round(minsUntil / 60)) }))
      : undefined;
    setPendingUnassign({ shift, workerName, warning });
  }

  const activeDayIso = activeShift?.scheduled_start ? appLocalDateKey(activeShift.scheduled_start, activeShift.timezone) : null;

  // While a shift is dragged: how each worker suits it, shown on their row.
  const shiftsByWorker = useMemo(() => {
    const map = new Map<string, CoordinatorShiftRecord[]>();
    for (const s of shifts) {
      if (!s.worker_id || s.worker_id === UNASSIGNED_PLACEHOLDER_ID) continue;
      map.set(s.worker_id, [...(map.get(s.worker_id) ?? []), s]);
    }
    return map;
  }, [shifts]);
  const fits = useMemo(() => {
    const map = new Map<string, Fit>();
    if (!activeShift) return map;
    for (const w of workers) {
      if (w.id === activeShift.worker_id) continue;
      map.set(w.id, workerFit({ shift: activeShift, avail: availMap[w.id], workerShifts: shiftsByWorker.get(w.id) ?? [] }));
    }
    return map;
  }, [activeShift, workers, availMap, shiftsByWorker]);

  return (
    <div className="space-y-3">
      {checkingConflicts && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/10">
          <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 shadow-xl">
            <Loader2 size={14} className="animate-spin" style={{ color: PLUM }} />
            <span className="text-[12px] font-bold" style={{ color: TEXT }}>{translate("coordinator.dnd.checkingConflicts")}</span>
          </div>
        </div>
      )}
      {pendingDrop && (
        <ConflictModal
          pending={pendingDrop}
          onConfirm={() => assignMut.mutate({ shiftId: pendingDrop.shift.id, workerId: pendingDrop.workerId, confirm: true })}
          onCancel={() => setPendingDrop(null)}
          confirming={assignMut.isPending}
        />
      )}
      {pendingUnassign && (
        <UnassignModal
          shift={pendingUnassign.shift}
          workerName={pendingUnassign.workerName}
          warning={pendingUnassign.warning}
          onConfirm={() => unassignMut.mutate(pendingUnassign.shift.id)}
          onCancel={() => setPendingUnassign(null)}
          confirming={unassignMut.isPending}
        />
      )}

      {/* Legend — a lightweight caption, not a competing card: no border/box,
          solid dots instead of bordered swatches, and no persistent "click or
          drag to assign" instructional copy (that's onboarding-style text
          that just becomes noise once a coordinator already knows the UI). */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        {(calendar ? CALENDAR_LEGEND : [
          { color: "#86EFAC", label: translate("coordinator.rostering.legend.available") },
          { color: "#F3A8C4", label: translate("coordinator.rostering.legend.assigned") },
          { color: "#FCD34D", label: translate("coordinator.rostering.legend.onLeave") },
          { color: "#CBD5E1", label: translate("coordinator.rostering.legend.notRostered") },
        ]).map((l) => (
          <div key={l.label} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
            <span className="text-[10.5px] font-medium" style={{ color: MUTED }}>{l.label}</span>
          </div>
        ))}
        {loadingAvail && <Loader2 size={11} className="animate-spin" style={{ color: MUTED }} />}
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        {calendar ? (
          <RosterCalendar
            dayKeys={view === "day" && dayKey ? [dayKey] : weekKeys}
            onOpenDay={onOpenDay}
            workers={rosterRows}
            shifts={shifts}
            availMap={availMap}
            allowCreate={allowCreate && !!onCreateAt}
            newShiftId={newShiftId}
            activeShift={activeShift}
            fits={fits}
            onCreateAt={(worker, date, time) => onCreateAt?.(worker, date, time)}
            onSelect={setDetailShift}
            canEditTimes={canEditTimes}
            onResize={resizeShift}
          />
        ) : (
        /* Worker × day grid */
        <div className="rounded-2xl border bg-white overflow-auto" style={{ borderColor: BORDER }}>
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th
                  className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest min-w-[190px]"
                  style={{ color: MUTED, borderBottom: `1px solid ${BORDER}` }}
                >
                  {translate("coordinator.rostering.worker")}
                </th>
                {days.map((d) => (
                  <th
                    key={d.toISOString()}
                    className="px-1.5 py-2.5 text-center"
                    style={{ minWidth: colWidth, borderBottom: `1px solid ${BORDER}`, background: isToday(d) ? "var(--cc-today-header)" : "var(--cc-grid-header)" }}
                  >
                    <button
                      type="button"
                      disabled={!onOpenDay}
                      onClick={() => onOpenDay?.(format(d, "yyyy-MM-dd"))}
                      aria-label={onOpenDay ? `Open ${format(d, "EEEE d MMMM")} as a day calendar` : undefined}
                      title={onOpenDay ? "See this day hour by hour" : undefined}
                      className="w-full rounded-lg py-0.5 transition-colors enabled:hover:bg-cc-soft disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
                    >
                      <span className="block text-[10px] font-black uppercase tracking-wider" style={{ color: isToday(d) ? PLUM : MUTED }}>
                        {format(d, "EEE")}
                      </span>
                      <span
                        className="mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-black"
                        style={{ background: isToday(d) ? "var(--cc-text)" : "transparent", color: isToday(d) ? "var(--cc-bg)" : TEXT }}
                      >
                        {format(d, "d")}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(allowCreate || unassigned.length > 0) && (
                <tr>
                  <td className="sticky left-0 z-10 bg-white px-3 py-2.5" style={{ borderBottom: `2px solid ${BORDER}` }}>
                    <div className="flex items-center gap-2.5">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                        style={{ background: "var(--cc-status-danger-bg)", color: "var(--cc-danger-text)" }}
                        aria-hidden="true"
                      >
                        <CalendarPlus size={16} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold leading-tight" style={{ color: TEXT }}>Open shifts</p>
                        <p className="mt-0.5 text-[10px] font-medium" style={{ color: openThisWeek ? "var(--cc-danger-text)" : MUTED }}>
                          {openThisWeek ? `${openThisWeek} to fill` : "None to fill"}
                          {openOtherWeeks > 0 && <span style={{ color: MUTED }}> · {openOtherWeeks} in other weeks</span>}
                        </p>
                      </div>
                    </div>
                  </td>
                  {days.map((d) => {
                    const dayKey = format(d, "yyyy-MM-dd");
                    const dayOpen = openByDay.get(dayKey) ?? [];
                    const canCreateHere = allowCreate && !!onOpenShiftCreate && dayKey >= appLocalDateKey(new Date().toISOString());
                    // While dragging, only an assigned shift from this day can be
                    // dropped here (to take its worker off).
                    const dropDisabled =
                      activeShift != null &&
                      (activeDayIso !== dayKey || !activeShift.worker_id || activeShift.worker_id === UNASSIGNED_PLACEHOLDER_ID);
                    return (
                      <DayCell
                        key={d.toISOString()}
                        minWidth={colWidth}
                        workerId={OPEN_ROW_ID}
                        dayIso={dayKey}
                        disabled={dropDisabled}
                        cellBg={isToday(d) ? "var(--cc-today-col)" : "var(--cc-surface)"}
                        style={{ borderBottom: `2px solid ${BORDER}` }}
                      >
                        <div className="space-y-1">
                          {dayOpen.map((s) => (
                            <div key={s.id} className={"rounded-lg " + (newShiftId === s.id ? "outline-dashed outline-2 outline-offset-2 outline-[#E8457A] animate-in fade-in zoom-in-95 duration-500" : "")}>
                              <ShiftCard shift={s} colorBy={colorBy} onClick={() => setDetailShift(s)} />
                            </div>
                          ))}
                          {canCreateHere && (
                            <button
                              type="button"
                              aria-label={`Add an open shift on ${format(d, "EEEE d MMMM")}`}
                              onClick={() => onOpenShiftCreate!(dayKey)}
                              className={`group/open flex w-full items-center justify-center rounded-lg border-[1.5px] border-dashed border-transparent text-xs font-semibold transition-colors hover:border-cc-border hover:bg-cc-soft focus-visible:border-cc-plum focus-visible:outline-none ${dayOpen.length ? "h-7" : "min-h-12"}`}
                              style={{ color: MUTED }}
                            >
                              {/* Shown on hover and keyboard focus so the row stays calm; always shown on touch screens. */}
                              <span className="flex items-center gap-1 transition-opacity [@media(hover:hover)]:opacity-0 group-hover/open:opacity-100 group-focus-visible/open:opacity-100">
                                <Plus size={13} /> Open shift
                              </span>
                            </button>
                          )}
                          {!canCreateHere && !dayOpen.length && <div className="h-12" />}
                        </div>
                      </DayCell>
                    );
                  })}
                </tr>
              )}
              {rosterRows.map((worker) => {
                const avail = availMap[worker.id];
                const avatar = avatarColor(worker.full_name);
                const weekHrs = weekHoursByWorker.get(worker.id) ?? 0;
                const maxHrs = avail?.max_hours_per_week;
                // A fortnight is measured against two weeks of the weekly cap.
                const capHrs = maxHrs != null ? maxHrs * (dayCount / 7) : null;
                const overCap = capHrs != null && weekHrs > capHrs;
                return (
                  <tr key={worker.id}>
                    <td className="sticky left-0 z-10 bg-white px-3 py-2.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <div className="flex items-center gap-2.5">
                        {worker.profile_photo_url ? (
                          <PersonPhoto name={worker.full_name} photoUrl={worker.profile_photo_url} size={36} />
                        ) : (
                          <div
                            className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-[11px] font-black shadow-sm"
                            style={{ background: avatar.bg, color: avatar.fg }}
                          >
                            {initials(worker.full_name)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <PersonPreview id={worker.id} name={worker.full_name} kind="worker" worker={worker} scheduledHours={weekHrs} maxHours={maxHrs} className="truncate text-[12px] font-bold leading-tight text-cc-text" />
                          <div className="flex items-center gap-2 mt-0.5">
                            {worker.avg_compliance != null && (
                              <span className="text-[10px] font-semibold" style={{ color: worker.avg_compliance >= 85 ? "#16A34A" : worker.avg_compliance >= 60 ? "#D97706" : "#DC2626" }}>
                                {worker.avg_compliance.toFixed(0)}%
                              </span>
                            )}
                            <span className="text-[10px] font-medium" style={{ color: overCap ? CORAL : MUTED }}>
                              {weekHrs.toFixed(1)}h{capHrs != null ? ` / ${capHrs}h` : ""}
                            </span>
                            {sameNames.has(worker.full_name.trim().toLowerCase()) && (worker.suburb || worker.employee_id) && (
                              <span className="truncate text-[10px] font-medium" style={{ color: MUTED }}>
                                {worker.suburb || `ID ${worker.employee_id}`}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    {days.map((d) => {
                      const dayKey = format(d, "yyyy-MM-dd");
                      const dayShifts = byWorkerDay.get(`${worker.id}|${dayKey}`) ?? [];
                      const onBlackout = avail ? isBlackout(d, avail.blackout_dates ?? []) : false;
                      // No availability recorded (or no days listed) = don't restrict.
                      const days = Array.isArray(avail?.available_days) ? avail!.available_days : null;
                      const isWorkDay = days && days.length > 0 ? days.map(Number).includes(isoWeekday(d)) : true;
                      const hasShift = dayShifts.length > 0;

                      let cellBg = "var(--cc-bg)";
                      let cellState: "available" | "assigned" | "blackout" | "unavailable" | "loading" = "available";
                      // A rostered shift always shows, even on a day off or leave —
                      // hiding it hid a real conflict.
                      if (hasShift) { cellState = "assigned"; cellBg = onBlackout ? "var(--cc-amber-tint)" : isToday(d) ? "var(--cc-today-col)" : "var(--cc-surface)"; }
                      else if (!avail && loadingAvail) cellState = "loading";
                      else if (onBlackout) { cellState = "blackout"; cellBg = "var(--cc-amber-tint)"; }
                      else if (!isWorkDay) { cellState = "unavailable"; cellBg = "var(--cc-soft)"; }
                      else { cellState = "available"; cellBg = isToday(d) ? "var(--cc-today-col)" : "var(--cc-surface)"; }
                      // Read-only boards don't need "free slot" green; keep today's column visible instead.
                      if (!allowCreate && (cellState === "available" || cellState === "assigned")) {
                        cellBg = isToday(d) ? "rgba(232,69,122,0.05)" : "var(--cc-bg)";
                      }

                      const dropDisabled = activeDayIso != null && activeDayIso !== dayKey;
                      // Past days can't take a new shift from the grid.
                      const canCreateHere = allowCreate && dayKey >= appLocalDateKey(new Date().toISOString());
                      const assignLabel = translateParams("coordinator.rostering.assignShiftTo", { worker: worker.full_name, date: format(d, "d MMM") });

                      return (
                        <DayCell key={d.toISOString()} minWidth={colWidth} workerId={worker.id} dayIso={dayKey} disabled={dropDisabled} cellBg={cellBg} fit={activeDayIso === dayKey ? fits.get(worker.id) : undefined}>
                          {activeDayIso === dayKey && fits.get(worker.id) && (() => {
                            const fit = fits.get(worker.id)!;
                            return (
                              <div
                                className="mb-1 flex items-center justify-center rounded-md px-1.5 py-1 text-[11px] font-semibold"
                                style={{ background: FIT_COLORS[fit.tone].bg, color: FIT_COLORS[fit.tone].fg, boxShadow: `inset 0 0 0 1px ${FIT_COLORS[fit.tone].border}` }}
                              >
                                {fit.label}
                              </div>
                            );
                          })()}
                          {/* When they're free, in words (days off and leave already say so). */}
                          {(cellState === "available" || cellState === "assigned") && isWorkDay && !onBlackout && (() => {
                            const usual = dayAvailability(avail, dayKey);
                            if (usual.start == null) return null;
                            return (
                              <p className="mb-1 truncate px-0.5 text-[11px] font-medium" style={{ color: MUTED }} title={`Usually works ${usual.text}`}>
                                {view === "fortnight" ? usual.text : `Free ${usual.text}`}
                              </p>
                            );
                          })()}
                          {cellState === "loading" && (
                            <div className="flex h-10 items-center justify-center">
                              <div className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: BORDER }} />
                            </div>
                          )}
                          {cellState === "blackout" && (
                            <div className="flex flex-col items-center justify-center h-10 gap-0.5">
                              <XCircle size={13} className="text-amber-500" />
                              <span className="text-[9px] font-bold text-amber-700">{translate("coordinator.rostering.onLeave")}</span>
                            </div>
                          )}
                          {cellState === "unavailable" && !canCreateHere && (
                            <div className="flex min-h-16 items-center justify-center rounded-lg text-xs text-cc-muted" style={{ background: "repeating-linear-gradient(135deg, transparent, transparent 5px, #88888810 5px, #88888810 7px), var(--cc-grid-header)" }}>{translate("schedule.unavailable")}</div>
                          )}
                          {cellState === "unavailable" && canCreateHere && (
                            // Outside the worker's usual days — still possible to roster
                            // (they may have agreed to it); the shift form checks conflicts.
                            <button type="button"
                              aria-label={`${assignLabel} (outside usual availability)`}
                              onClick={() => onCellClick(worker, dayKey)}
                              className="flex min-h-16 w-full items-center justify-center rounded-lg border border-dashed border-transparent text-xs text-cc-muted hover:border-cc-plum hover:text-cc-plum focus-visible:border-cc-plum focus-visible:outline-2 focus-visible:outline-cc-plum"
                              style={{ background: "repeating-linear-gradient(135deg, transparent, transparent 5px, #88888810 5px, #88888810 7px), var(--cc-grid-header)" }}>
                              {translate("schedule.unavailable")}
                            </button>
                          )}
                          {cellState === "available" && !canCreateHere && <div className="h-16" />}
                          {cellState === "available" && canCreateHere && (
                            <button type="button"
                              aria-label={assignLabel}
                              onClick={() => onCellClick(worker, dayKey)}
                              className="group/assign flex min-h-16 w-full items-center justify-center rounded-lg border-[1.5px] border-dashed border-transparent text-xs font-semibold text-[#E8457A] transition-colors hover:border-[#E8457A] hover:bg-[#E8457A]/5 focus-visible:border-[#E8457A] focus-visible:outline-none">
                              {/* Shown on hover (and keyboard focus) so the grid stays calm; always shown on touch screens. */}
                              <span className="flex items-center gap-1 transition-opacity [@media(hover:hover)]:opacity-0 group-hover/assign:opacity-100 group-focus-visible/assign:opacity-100">
                                <Plus size={14} /> {translate("schedule.assign")}
                              </span>
                            </button>
                          )}
                          {cellState === "assigned" && (
                            <div className="space-y-1">
                              {dayShifts.map((s) => (
                                <div key={s.id} className={"relative group/card rounded-lg " + (newShiftId === s.id ? "outline-dashed outline-2 outline-offset-2 outline-[#E8457A] animate-in fade-in zoom-in-95 duration-500" : "")}>
                                  <ShiftCard shift={s} colorBy={colorBy} onClick={() => setDetailShift(s)} />
                                  <button
                                    onClick={() => handleUnassignClick(s)}
                                    className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full border bg-white shadow group-hover/card:flex"
                                    style={{ borderColor: BORDER, color: MUTED }}
                                    title={translate("coordinator.dnd.removeWorker")}
                                    aria-label={translate("coordinator.dnd.removeWorker")}
                                  >
                                    <Minus size={9} />
                                  </button>
                                </div>
                              ))}
                              {allowCreate && <button
                                type="button"
                                title={translateParams("coordinator.rostering.addAnotherShift", { worker: worker.full_name, date: format(d, "d MMM") })}
                                onClick={() => onCellClick(worker, dayKey)}
                                className="flex h-5 w-full items-center justify-center rounded border border-dashed border-violet-200 hover:border-violet-400 hover:bg-violet-50 transition-all opacity-0 hover:opacity-100 focus:opacity-100"
                              >
                                <Plus size={9} style={{ color: PLUM }} />
                              </button>}
                            </div>
                          )}
                        </DayCell>
                      );
                    })}
                  </tr>
                );
              })}
              {workers.length === 0 && (
                <tr>
                  <td colSpan={dayCount + 1} className="py-16 text-center text-[13px]" style={{ color: MUTED }}>
                    {translate("coordinator.rostering.noShiftsWeek")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}

        <DragOverlay dropAnimation={null}>
          {/* In the calendar the block itself moves. */}
          {activeShift && !calendar ? <ShiftDragClone shift={activeShift} /> : null}
        </DragOverlay>
      </DndContext>

      <UnassignedShiftPanel
        shift={detailShift}
        open={!!detailShift}
        onOpenChange={(open) => { if (!open) setDetailShift(null); }}
        workers={workers}
        onAssigned={onRefresh}
      />
    </div>
  );
}
