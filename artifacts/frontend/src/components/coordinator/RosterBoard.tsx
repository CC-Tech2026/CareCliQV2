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
  AlertTriangle, CheckCircle2, ChevronRight, Clock3, GripVertical,
  Loader2, Minus, Plus, User2, Users, XCircle, MinusCircle,
} from "lucide-react";
import {
  assignExistingShift,
  getWorkerConflicts,
  unassignShift,
  type CoordinatorShiftRecord,
  type WorkerStats,
  type ConflictItem,
  type WorkerAvailability,
  type BlackoutDate,
} from "@/services/coordinatorService";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { UnassignedShiftPanel } from "@/components/coordinator/UnassignedShiftPanel";
import { ConflictModal, type PendingDrop } from "@/components/coordinator/ConflictModal";
import { ZoneLabel } from "@/components/branches/ZoneLabel";
import { appLocalDateKey, formatAppTime } from "@/lib/datetime";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

const UNASSIGNED_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

type AvailabilityMap = Record<string, WorkerAvailability & { blackout_dates?: BlackoutDate[] }>;

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
function ccDayIndex(date: Date): number {
  const js = getDay(date); // 0=Sun..6=Sat
  return js === 0 ? 6 : js - 1; // 0=Mon..6=Sun
}
function isBlackout(date: Date, blackouts: BlackoutDate[] = []): boolean {
  const key = format(date, "yyyy-MM-dd");
  return blackouts.some((b) => b.start_date <= key && key <= b.end_date);
}

// ── Draggable shift chip (unassigned tray + assigned cells) ──────────────────
function ShiftCard({ shift, dimmed = false, onClick }: { shift: CoordinatorShiftRecord; dimmed?: boolean; onClick?: () => void }) {
  const { translate } = useAccessibility();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: shift.id,
    data: { shift },
  });
  const clrs = statusColors(shift.status);
  const start = parseStart(shift);
  const end = shift.scheduled_end ? parseISO(shift.scheduled_end) : null;
  return (
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
  workerId, dayIso, disabled, cellBg, children,
}: {
  workerId: string;
  dayIso: string;
  disabled: boolean;
  cellBg: string;
  children?: React.ReactNode;
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
        background: isOver && !disabled ? "#F0ECFF" : cellBg,
        opacity: disabled ? 0.4 : 1,
        minWidth: 132,
        minHeight: 56,
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
  weekStart: Date;
  shifts: CoordinatorShiftRecord[];
  workers: WorkerStats[];
  availMap: AvailabilityMap;
  loadingAvail: boolean;
  onCellClick: (worker: WorkerStats, dateKey: string) => void;
  onRefresh: () => void;
}

export function RosterBoard({ weekStart, shifts, workers, availMap, loadingAvail, onCellClick, onRefresh }: RosterBoardProps) {
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

  const days = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });

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

  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    const shift = active.data.current?.shift as CoordinatorShiftRecord | undefined;
    if (shift) setActiveShift(shift);
  }, []);

  const handleDragEnd = useCallback(async ({ active, over }: DragEndEvent) => {
    setActiveShift(null);
    if (!over || !active.data.current?.shift) return;
    const shift = active.data.current.shift as CoordinatorShiftRecord;
    const { workerId } = over.data.current as { workerId: string; dayIso: string };
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
  }, [workers, assignMut, translate]);

  const handleUnassignClick = (shift: CoordinatorShiftRecord) => {
    const worker = workers.find((w) => w.id === shift.worker_id);
    const workerName = worker?.full_name ?? translate("common.worker");
    const start = parseStart(shift);
    const minsUntil = start ? differenceInMinutes(start, new Date()) : Infinity;
    const warning = minsUntil < 1440 && minsUntil > 0
      ? (minsUntil < 60 ? translateParams("coordinator.dnd.shiftStartsInMins", { mins: String(minsUntil) }) : translateParams("coordinator.dnd.shiftStartsInHours", { hours: String(Math.round(minsUntil / 60)) }))
      : undefined;
    setPendingUnassign({ shift, workerName, warning });
  };

  const activeDayIso = activeShift ? (() => { const d = parseStart(activeShift); return d ? format(d, "yyyy-MM-dd") : null; })() : null;

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
        {[
          { color: "#86EFAC", label: translate("coordinator.rostering.legend.available") },
          { color: "#F3A8C4", label: translate("coordinator.rostering.legend.assigned") },
          { color: "#FCD34D", label: translate("coordinator.rostering.legend.onLeave") },
          { color: "#CBD5E1", label: translate("coordinator.rostering.legend.notRostered") },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
            <span className="text-[10.5px] font-medium" style={{ color: MUTED }}>{l.label}</span>
          </div>
        ))}
        {loadingAvail && <Loader2 size={11} className="animate-spin" style={{ color: MUTED }} />}
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        {/* Unassigned tray — horizontal shelf */}
        <div
          className="rounded-2xl border p-3"
          style={{ borderColor: unassigned.length > 0 ? "#F3A8C4" : BORDER, background: unassigned.length > 0 ? "#FFF9FB" : "white" }}
        >
          <div className="mb-2 flex items-center gap-2">
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: MUTED }}>
              {translateParams("coordinator.dnd.unassigned", { count: String(unassigned.length) })}
            </p>
          </div>
          {unassigned.length === 0 ? (
            <div className="flex items-center gap-2 py-1.5">
              <CheckCircle2 size={16} style={{ color: "#16A34A" }} />
              <p className="text-[12px] font-bold" style={{ color: "#16A34A" }}>{translate("coordinator.dnd.allAssigned")}</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {unassigned.map((s) => <div key={s.id} className="w-52"><ShiftCard shift={s} onClick={() => setDetailShift(s)} /></div>)}
            </div>
          )}
        </div>

        {/* Worker × day grid */}
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
                    className="min-w-[132px] px-2 py-2.5 text-center"
                    style={{ borderBottom: `1px solid ${BORDER}`, background: isToday(d) ? "#F0ECFF" : SOFT }}
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
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workers.map((worker) => {
                const avail = availMap[worker.id];
                const avatar = avatarColor(worker.full_name);
                const weekHrs = weekHoursByWorker.get(worker.id) ?? 0;
                const maxHrs = avail?.max_hours_per_week;
                const overCap = maxHrs != null && weekHrs > maxHrs;
                return (
                  <tr key={worker.id}>
                    <td className="sticky left-0 z-10 bg-white px-3 py-2.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <div className="flex items-center gap-2.5">
                        <div
                          className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-[11px] font-black shadow-sm"
                          style={{ background: avatar.bg, color: avatar.fg }}
                        >
                          {initials(worker.full_name)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-bold leading-tight" style={{ color: TEXT }}>{worker.full_name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {worker.avg_compliance != null && (
                              <span className="text-[10px] font-semibold" style={{ color: worker.avg_compliance >= 85 ? "#16A34A" : worker.avg_compliance >= 60 ? "#D97706" : "#DC2626" }}>
                                {worker.avg_compliance.toFixed(0)}%
                              </span>
                            )}
                            <span className="text-[10px] font-medium" style={{ color: overCap ? CORAL : MUTED }}>
                              {weekHrs.toFixed(1)}h{maxHrs != null ? ` / ${maxHrs}h` : ""}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    {days.map((d) => {
                      const dayKey = format(d, "yyyy-MM-dd");
                      const dayShifts = byWorkerDay.get(`${worker.id}|${dayKey}`) ?? [];
                      const dayIdx = ccDayIndex(d);
                      const onBlackout = avail ? isBlackout(d, avail.blackout_dates) : false;
                      const isWorkDay = avail ? avail.available_days.includes(dayIdx) : true;
                      const hasShift = dayShifts.length > 0;

                      let cellBg = "var(--cc-bg)";
                      let cellState: "available" | "assigned" | "blackout" | "unavailable" | "loading" = "available";
                      if (!avail && loadingAvail) cellState = "loading";
                      else if (onBlackout) { cellState = "blackout"; cellBg = "#FFFBEB"; }
                      else if (!isWorkDay) { cellState = "unavailable"; cellBg = "#F8FAFC"; }
                      else if (hasShift) { cellState = "assigned"; cellBg = isToday(d) ? "#FAFAFE" : "var(--cc-bg)"; }
                      else { cellState = "available"; cellBg = isToday(d) ? "#F0FFF4" : "#F7FEF9"; }

                      const dropDisabled = activeDayIso != null && activeDayIso !== dayKey;

                      return (
                        <DayCell key={d.toISOString()} workerId={worker.id} dayIso={dayKey} disabled={dropDisabled} cellBg={cellBg}>
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
                          {cellState === "unavailable" && (
                            <div className="flex h-10 items-center justify-center">
                              <MinusCircle size={12} className="opacity-25" style={{ color: MUTED }} />
                            </div>
                          )}
                          {cellState === "available" && (
                            <button
                              type="button"
                              title={translateParams("coordinator.rostering.assignShiftTo", { worker: worker.full_name, date: format(d, "d MMM") })}
                              onClick={() => onCellClick(worker, dayKey)}
                              className="group flex h-10 w-full items-center justify-center rounded-lg border border-dashed border-green-200 hover:border-green-400 hover:bg-green-50 transition-all"
                            >
                              <Plus size={13} className="text-green-400 group-hover:text-green-600 transition-colors" />
                            </button>
                          )}
                          {cellState === "assigned" && (
                            <div className="space-y-1">
                              {dayShifts.map((s) => (
                                <div key={s.id} className="relative group/card">
                                  <ShiftCard shift={s} />
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
                              <button
                                type="button"
                                title={translateParams("coordinator.rostering.addAnotherShift", { worker: worker.full_name, date: format(d, "d MMM") })}
                                onClick={() => onCellClick(worker, dayKey)}
                                className="flex h-5 w-full items-center justify-center rounded border border-dashed border-violet-200 hover:border-violet-400 hover:bg-violet-50 transition-all opacity-0 hover:opacity-100 focus:opacity-100"
                              >
                                <Plus size={9} style={{ color: PLUM }} />
                              </button>
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
                  <td colSpan={8} className="py-16 text-center text-[13px]" style={{ color: MUTED }}>
                    {translate("coordinator.rostering.noShiftsWeek")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeShift ? <ShiftDragClone shift={activeShift} /> : null}
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
