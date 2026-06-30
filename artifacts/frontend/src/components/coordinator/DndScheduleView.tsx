/**
 * DndScheduleView — CARECLIQV2-235
 * Drag-and-drop week calendar: workers × hourly time slots.
 * Unassigned shifts panel (left) → drag to worker × hour cell.
 * Features: Real-time availability visualization with color-coded status.
 */
import { useCallback, useState, useEffect } from "react";
import { useAccessibility } from "@/contexts/AccessibilityContext";
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
import { format, addDays, isToday, parseISO, differenceInMinutes, getDay } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, Clock, GripVertical,
  User2, Minus, ChevronRight, Loader2,
} from "lucide-react";
import {
  assignExistingShift,
  getWorkerConflicts,
  unassignShift,
  getWorkerAvailability,
  type CoordinatorShiftRecord,
  type WorkerStats,
  type ConflictItem,
  type AvailabilityStatus,
  type WorkerAvailability,
} from "@/services/coordinatorService";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

const HOURS = Array.from({ length: 15 }, (_, i) => i + 6); // 6am–8pm
const CELL_WIDTH = 80; // px per hour cell
const ROW_HEIGHT = 56; // px per worker row

const STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  unassigned: { bg: "#FEF2F2", color: "#DC2626", border: "#FCA5A5" },
  scheduled:  { bg: "#EDE9FF", color: "#3730A3", border: "#C4B5FD" },
  in_progress:{ bg: "#DBEAFE", color: "#1D4ED8", border: "#93C5FD" },
  clocked_in: { bg: "#DBEAFE", color: "#1D4ED8", border: "#93C5FD" },
  completed:  { bg: "#DCFCE7", color: "#166534", border: "#86EFAC" },
  cancelled:  { bg: "#F1F5F9", color: "#64748B", border: "#CBD5E1" },
};

function statusColors(status?: string | null) {
  return STATUS_COLORS[status ?? ""] ?? STATUS_COLORS.scheduled;
}

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

// ── Draggable shift card ──────────────────────────────────────────────────────
function DraggableShiftCard({
  shift,
  compact = false,
}: {
  shift: CoordinatorShiftRecord;
  compact?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: shift.id,
    data: { shift },
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.3 : 1,
    cursor: "grab",
  };
  const clrs = statusColors(shift.status);
  const start = shift.scheduled_start ? parseISO(shift.scheduled_start) : null;
  const end   = shift.scheduled_end   ? parseISO(shift.scheduled_end)   : null;

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, borderColor: clrs.border, background: clrs.bg }}
      {...listeners}
      {...attributes}
      className="rounded-lg border-2 px-2.5 py-1.5 select-none transition-shadow hover:shadow-md"
    >
      <div className="flex items-start gap-1.5">
        <GripVertical size={12} className="mt-0.5 shrink-0" style={{ color: MUTED }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-black" style={{ color: clrs.color }}>
            {shift.participant_name || translate("common.participant")}
          </p>
          {start && (
            <p className="text-[10px] font-medium" style={{ color: MUTED }}>
              {format(start, "h:mm a")}{end ? `–${format(end, "h:mm a")}` : ""}
            </p>
          )}
          {!compact && shift.shift_type && (
            <p className="mt-0.5 truncate text-[10px]" style={{ color: MUTED }}>
              {shift.shift_type.replace(/_/g, " ")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Drag overlay clone ────────────────────────────────────────────────────────
function ShiftDragClone({ shift }: { shift: CoordinatorShiftRecord }) {
  const clrs = statusColors(shift.status);
  const start = shift.scheduled_start ? parseISO(shift.scheduled_start) : null;
  const end   = shift.scheduled_end   ? parseISO(shift.scheduled_end)   : null;
  return (
    <div
      className="w-44 rounded-xl border-2 shadow-xl px-3 py-2"
      style={{ borderColor: clrs.border, background: clrs.bg, cursor: "grabbing" }}
    >
      <p className="text-[12px] font-black" style={{ color: clrs.color }}>
        {shift.participant_name || translate("common.participant")}
      </p>
      {start && (
        <p className="text-[11px]" style={{ color: MUTED }}>
          {format(start, "h:mm a")}{end ? ` – ${format(end, "h:mm a")}` : ""}
        </p>
      )}
    </div>
  );
}

// ── Droppable worker×hour cell ────────────────────────────────────────────────
function DroppableCell({
  workerId,
  hour,
  dayIso,
  children,
  availabilityStatus,
}: {
  workerId: string;
  hour: number;
  dayIso: string;
  children?: React.ReactNode;
  availabilityStatus?: "available" | "unavailable" | "blackout";
}) {
  const id = `${workerId}|${dayIso}|${hour}`;
  const { isOver, setNodeRef } = useDroppable({ id, data: { workerId, hour, dayIso } });
  
  // Determine background color based on availability
  let bgColor = "transparent";
  let borderColor = BORDER;
  let opacity = 1;
  
  if (availabilityStatus === "blackout") {
    bgColor = "#FEE2E2"; // Light red
    borderColor = "#FECACA";
    opacity = 0.6;
  } else if (availabilityStatus === "unavailable") {
    bgColor = "#FED7AA"; // Light orange
    borderColor = "#FDBA74";
    opacity = 0.7;
  } else if (availabilityStatus === "available") {
    bgColor = "#DCFCE7"; // Light green (subtle)
    borderColor = "#BBFBEE";
    opacity = 0.4;
  }
  
  // Highlight when dragging over
  if (isOver) {
    bgColor = "#EDE9FF"; // Plum highlight
    opacity = 1;
  }
  
  return (
    <div
      ref={setNodeRef}
      style={{
        minWidth: CELL_WIDTH,
        minHeight: ROW_HEIGHT,
        background: bgColor,
        borderLeft: `1px solid ${borderColor}`,
        opacity,
        transition: "background 0.1s, opacity 0.1s",
        position: "relative",
      }}
      title={availabilityStatus === "blackout" ? "Blackout date" : availabilityStatus === "unavailable" ? "Outside working hours" : ""}
    >
      {children}
    </div>
  );
}

// ── Conflict modal ────────────────────────────────────────────────────────────
interface PendingDrop {
  shift: CoordinatorShiftRecord;
  workerId: string;
  workerName: string;
  hour: number;
  dayIso: string;
  conflicts: ConflictItem[];
  skillWarnings: ConflictItem[];
}

function ConflictModal({
  pending,
  onConfirm,
  onCancel,
  confirming,
}: {
  pending: PendingDrop;
  onConfirm: () => void;
  onCancel: () => void;
  confirming: boolean;
}) {
  const { translate } = useAccessibility();
  const hard = pending.conflicts.filter((c) => c.severity === "error");
  const soft = [...pending.conflicts.filter((c) => c.severity !== "error"), ...pending.skillWarnings];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border bg-white shadow-2xl" style={{ borderColor: BORDER }}>
        <div className="px-6 pt-5 pb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50">
              <AlertTriangle size={18} className="text-amber-600" />
            </div>
            <div>
              <h2 className="text-[16px] font-black" style={{ color: TEXT }}>
                {hard.length > 0 ? translate("coordinator.dnd.schedulingConflict") : translate("coordinator.dnd.assignmentWarning")}
              </h2>
              <p className="text-[12px]" style={{ color: MUTED }}>{translateParams("coordinator.dnd.assignTo", { name: pending.workerName })}</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 space-y-3 max-h-64 overflow-y-auto">
          {hard.map((c, i) => (
            <div key={i} className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-600" />
              <p className="text-[12px] font-medium text-red-800">{c.message}</p>
            </div>
          ))}
          {soft.map((c, i) => (
            <div key={i} className="flex items-start gap-2.5 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
              <p className="text-[12px] font-medium text-amber-800">{c.message}</p>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2.5 px-6 py-4" style={{ borderTop: `1px solid ${BORDER}` }}>
          <button
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-[12px] font-bold"
            style={{ background: SOFT, color: MUTED }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={confirming}
            className="flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-bold text-white"
            style={{ background: hard.length > 0 ? CORAL : PLUM, opacity: confirming ? 0.65 : 1 }}
          >
            {confirming ? (
              <><Loader2 size={12} className="animate-spin" /> {translate("coordinator.dnd.assigning")}</>
            ) : (
              <><ChevronRight size={12} /> {translate("coordinator.dnd.assignAnyway")}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Unassign confirmation ─────────────────────────────────────────────────────
function UnassignModal({
  shift,
  workerName,
  onConfirm,
  onCancel,
  confirming,
  warning,
}: {
  shift: CoordinatorShiftRecord;
  workerName: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirming: boolean;
  warning?: string;
}) {
  const { translate, translateParams } = useAccessibility();
  const start = shift.scheduled_start ? parseISO(shift.scheduled_start) : null;
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
            Cancel
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

// ── Main DnD Schedule View ────────────────────────────────────────────────────
interface DndScheduleViewProps {
  weekStart: Date;
  shifts: CoordinatorShiftRecord[];
  workers: WorkerStats[];
  onRefresh: () => void;
}

export function DndScheduleView({ weekStart, shifts, workers, onRefresh }: DndScheduleViewProps) {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__";
  const qc = useQueryClient();

  const [activeShift,   setActiveShift]   = useState<CoordinatorShiftRecord | null>(null);
  const [pendingDrop,   setPendingDrop]   = useState<PendingDrop | null>(null);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [pendingUnassign, setPendingUnassign] = useState<{
    shift: CoordinatorShiftRecord; workerName: string; warning?: string;
  } | null>(null);
  const [workerAvailability, setWorkerAvailability] = useState<Record<string, WorkerAvailability & { blackout_dates?: Array<{ start_date: string; end_date: string }> }>>({});
  const [loadingAvailability, setLoadingAvailability] = useState(true);

  // Fetch availability for all workers
  useEffect(() => {
    const fetchAvailabilities = async () => {
      setLoadingAvailability(true);
      try {
        const availMap: typeof workerAvailability = {};
        for (const worker of workers) {
          try {
            const data = await getWorkerAvailability(worker.id);
            availMap[worker.id] = data;
          } catch (err) {
            console.warn(`Failed to fetch availability for worker ${worker.id}:`, err);
          }
        }
        setWorkerAvailability(availMap);
      } finally {
        setLoadingAvailability(false);
      }
    };
    
    if (workers.length > 0) {
      fetchAvailabilities();
    }
  }, [workers]);

  // Helper: Check if worker is available at a specific time slot
  const getAvailabilityStatus = (workerId: string, hour: number, dayIso: string): "available" | "unavailable" | "blackout" | undefined => {
    const avail = workerAvailability[workerId];
    if (!avail) return undefined;

    // Parse the date to get day of week (1=Monday, 7=Sunday in date-fns)
    try {
      const date = parseISO(dayIso);
      const dayOfWeek = getDay(date); // 0=Sunday, 1=Monday, ..., 6=Saturday
      const carecliqDay = dayOfWeek === 0 ? 7 : dayOfWeek; // Convert to 1=Mon, 7=Sun

      // Check blackout dates
      if (avail.blackout_dates) {
        for (const blackout of avail.blackout_dates) {
          if (dayIso >= blackout.start_date && dayIso <= blackout.end_date) {
            return "blackout";
          }
        }
      }

      // Check if worker works on this day
      if (!avail.available_days || !avail.available_days.includes(carecliqDay)) {
        return "unavailable";
      }

      // Check if time is within working hours
      if (avail.day_start_time && avail.day_end_time) {
        const timeStr = String(hour).padStart(2, "0") + ":00";
        const timeEnd = String(hour + 1).padStart(2, "0") + ":00";
        
        // Compare times as strings (HH:MM format)
        if (timeStr < avail.day_start_time || timeEnd > avail.day_end_time) {
          return "unavailable";
        }
      }

      return "available";
    } catch {
      return undefined;
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

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

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Categorise shifts
  const unassignedShifts = shifts.filter((s) => !s.worker_id || s.status === "unassigned");

  // Map assigned shifts to worker × day
  const assignedByWorkerDay = new Map<string, CoordinatorShiftRecord[]>();
  for (const s of shifts) {
    if (!s.worker_id || s.status === "unassigned") continue;
    const d = s.scheduled_start ? parseISO(s.scheduled_start) : null;
    if (!d) continue;
    const key = `${s.worker_id}|${format(d, "yyyy-MM-dd")}`;
    assignedByWorkerDay.set(key, [...(assignedByWorkerDay.get(key) ?? []), s]);
  }

  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    const shift = active.data.current?.shift as CoordinatorShiftRecord | undefined;
    if (shift) setActiveShift(shift);
  }, []);

  const handleDragEnd = useCallback(async ({ active, over }: DragEndEvent) => {
    setActiveShift(null);
    if (!over || !active.data.current?.shift) return;
    const shift = active.data.current.shift as CoordinatorShiftRecord;
    const { workerId, hour, dayIso } = over.data.current as {
      workerId: string; hour: number; dayIso: string;
    };
    if (!workerId || hour === undefined) return;
    if (shift.worker_id === workerId) return; // No change

    const worker = workers.find((w) => w.id === workerId);
    const workerName = worker?.full_name ?? translate("common.worker");

    // Determine shift times (use existing or build from drop cell)
    const shiftStart = shift.scheduled_start ?? `${dayIso}T${String(hour).padStart(2, "0")}:00:00Z`;
    const shiftEnd   = shift.scheduled_end   ?? `${dayIso}T${String(hour + 4).padStart(2, "0")}:00:00Z`;

    setCheckingConflicts(true);
    try {
      const result = await getWorkerConflicts(workerId, shiftStart, shiftEnd, {
        participantId: shift.participant_id,
        excludeShiftId: shift.id,
      });
      setCheckingConflicts(false);

      const allIssues = [...result.conflicts, ...result.skill_warnings];
      if (allIssues.length > 0) {
        setPendingDrop({
          shift, workerId, workerName, hour, dayIso,
          conflicts: result.conflicts,
          skillWarnings: result.skill_warnings,
        });
      } else {
        // No conflicts — assign directly
        assignMut.mutate({ shiftId: shift.id, workerId, confirm: false });
      }
    } catch {
      setCheckingConflicts(false);
      assignMut.mutate({ shiftId: shift.id, workerId, confirm: true });
    }
  }, [workers, assignMut]);

  const handleUnassignClick = (shift: CoordinatorShiftRecord) => {
    const worker = workers.find((w) => w.id === shift.worker_id);
    const workerName = worker?.full_name ?? translate("common.worker");
    const start = shift.scheduled_start ? parseISO(shift.scheduled_start) : null;
    const minsUntil = start ? differenceInMinutes(start, new Date()) : Infinity;
    const warning = minsUntil < 1440 && minsUntil > 0
      ? (minsUntil < 60 ? translateParams("coordinator.dnd.shiftStartsInMins", { mins: String(minsUntil) }) : translateParams("coordinator.dnd.shiftStartsInHours", { hours: String(Math.round(minsUntil / 60)) }))
      : undefined;
    setPendingUnassign({ shift, workerName, warning });
  };

  return (
    <>
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

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-4">
          {/* Unassigned shifts sidebar */}
          <div className="w-52 shrink-0">
            <div
              className="rounded-2xl border bg-white p-3"
              style={{ borderColor: BORDER }}
            >
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest" style={{ color: MUTED }}>
                {translateParams("coordinator.dnd.unassigned", { count: String(unassignedShifts.length) })}
              </p>
              {unassignedShifts.length === 0 ? (
                <div className="flex flex-col items-center py-6">
                  <CheckCircle2 size={20} style={{ color: "#16A34A" }} />
                  <p className="mt-1.5 text-[11px] font-bold" style={{ color: "#16A34A" }}>{translate("coordinator.dnd.allAssigned")}</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-0.5">
                  {unassignedShifts.map((s) => (
                    <DraggableShiftCard key={s.id} shift={s} />
                  ))}
                </div>
              )}
              <p className="mt-3 rounded-lg bg-[#F8F8FE] px-2 py-1.5 text-[10px] leading-relaxed" style={{ color: MUTED }}>
                Drag a shift card onto a worker row to assign.
              </p>
              
              {/* Availability Legend */}
              <div className="mt-4 space-y-1.5 border-t pt-3" style={{ borderColor: BORDER }}>
                <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: MUTED }}>Availability</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded" style={{ background: "#DCFCE7" }} />
                    <span className="text-[10px]" style={{ color: MUTED }}>Available</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded" style={{ background: "#FED7AA" }} />
                    <span className="text-[10px]" style={{ color: MUTED }}>Outside hours</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded" style={{ background: "#FEE2E2" }} />
                    <span className="text-[10px]" style={{ color: MUTED }}>Blackout date</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Worker × time grid */}
          <div className="flex-1 overflow-auto rounded-2xl border bg-white relative" style={{ borderColor: BORDER }}>
            {loadingAvailability && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/50">
                <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 shadow-lg">
                  <Loader2 size={14} className="animate-spin" style={{ color: PLUM }} />
                  <span className="text-[12px] font-bold" style={{ color: TEXT }}>Loading availability...</span>
                </div>
              </div>
            )}
            <table className="border-separate border-spacing-0">
              <thead>
                <tr>
                  <th
                    className="sticky left-0 z-20 bg-white px-3 py-2.5 text-left min-w-[160px]"
                    style={{ borderBottom: `1px solid ${BORDER}`, borderRight: `1px solid ${BORDER}` }}
                  >
                    <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: MUTED }}>
                      Worker
                    </span>
                  </th>
                  {weekDays.map((day) => (
                    <th
                      key={day.toISOString()}
                      colSpan={HOURS.length}
                      className="px-2 py-2 text-center"
                      style={{
                        borderBottom: `1px solid ${BORDER}`,
                        borderLeft: `1px solid ${BORDER}`,
                        background: isToday(day) ? SOFT : "var(--cc-bg)",
                        minWidth: CELL_WIDTH * HOURS.length,
                      }}
                    >
                      <span
                        className="text-[11px] font-black"
                        style={{ color: isToday(day) ? PLUM : TEXT }}
                      >
                        {format(day, "EEE d")}
                      </span>
                    </th>
                  ))}
                </tr>
                <tr>
                  <th
                    className="sticky left-0 z-20 bg-white"
                    style={{ borderBottom: `1px solid ${BORDER}`, borderRight: `1px solid ${BORDER}` }}
                  />
                  {weekDays.map((day) =>
                    HOURS.map((h) => (
                      <th
                        key={`${day.toISOString()}-${h}`}
                        className="px-0 py-1"
                        style={{
                          borderBottom: `1px solid ${BORDER}`,
                          borderLeft: `1px solid ${BORDER}`,
                          minWidth: CELL_WIDTH,
                          background: isToday(day) ? SOFT : "var(--cc-bg)",
                        }}
                      >
                        <span className="block text-center text-[9px] font-medium" style={{ color: MUTED }}>
                          {h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`}
                        </span>
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {workers.slice(0, 20).map((worker) => (
                  <tr key={worker.id}>
                    <td
                      className="sticky left-0 z-10 bg-white px-3 py-2"
                      style={{ borderBottom: `1px solid ${BORDER}`, borderRight: `1px solid ${BORDER}` }}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black text-white"
                          style={{ background: PLUM }}
                        >
                          {initials(worker.full_name)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-bold max-w-[100px]" style={{ color: TEXT }}>
                            {worker.full_name.split(" ")[0]}
                          </p>
                          {worker.avg_compliance != null && (
                            <p className="text-[10px]" style={{
                              color: worker.avg_compliance >= 85 ? "#16A34A" : worker.avg_compliance >= 60 ? "#D97706" : "#DC2626",
                            }}>
                              {worker.avg_compliance.toFixed(0)}%
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    {weekDays.map((day) => {
                      const dayIso = format(day, "yyyy-MM-dd");
                      const workerDayKey = `${worker.id}|${dayIso}`;
                      const dayAssigned = assignedByWorkerDay.get(workerDayKey) ?? [];
                      return HOURS.map((h) => {
                        const cellShift = dayAssigned.find((s) => {
                          const sd = s.scheduled_start ? parseISO(s.scheduled_start) : null;
                          return sd ? sd.getHours() === h : false;
                        });
                        const availStatus = getAvailabilityStatus(worker.id, h, dayIso);
                        return (
                          <DroppableCell key={`${worker.id}-${dayIso}-${h}`} workerId={worker.id} hour={h} dayIso={dayIso} availabilityStatus={availStatus}>
                            {cellShift && (
                              <div
                                className="absolute inset-0.5 flex items-center rounded-md overflow-hidden group"
                                style={{
                                  background: statusColors(cellShift.status).bg,
                                  borderLeft: `3px solid ${statusColors(cellShift.status).border}`,
                                }}
                              >
                                <div className="flex-1 overflow-hidden px-1.5 py-1">
                                  <p className="truncate text-[9px] font-black leading-none" style={{ color: statusColors(cellShift.status).color }}>
                                    {cellShift.participant_name?.split(" ")[0] || "—"}
                                  </p>
                                </div>
                                <button
                                  onClick={() => handleUnassignClick(cellShift)}
                                  className="mr-1 hidden h-4 w-4 shrink-0 items-center justify-center rounded group-hover:flex"
                                  style={{ background: "var(--cc-bg)", color: MUTED }}
                                  title="Remove assignment"
                                  aria-label="Remove shift assignment"
                                >
                                  <Minus size={8} />
                                </button>
                              </div>
                            )}
                          </DroppableCell>
                        );
                      });
                    })}
                  </tr>
                ))}
                {workers.length === 0 && (
                  <tr>
                    <td
                      colSpan={1 + weekDays.length * HOURS.length}
                      className="py-20 text-center text-[13px]"
                      style={{ color: MUTED }}
                    >
                      No workers to display.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeShift ? <ShiftDragClone shift={activeShift} /> : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}
