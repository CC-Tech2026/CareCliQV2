import type { ReactNode } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { formatAppDate, formatAppTime } from "@/lib/datetime";
import type { CoordinatorShiftRecord } from "@/services/coordinatorService";

const UNASSIGNED_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

export type ShiftLiveStatus = "on_shift" | "late" | "scheduled" | "completed" | "cancelled" | "unassigned";

const LIVE_STATUS: Record<ShiftLiveStatus, { label: string; fg: string; bg: string }> = {
  on_shift: { label: "On shift", fg: "var(--cc-status-success)", bg: "var(--cc-status-success-bg)" },
  late: { label: "Not clocked in", fg: "var(--cc-status-danger)", bg: "var(--cc-status-danger-bg)" },
  scheduled: { label: "Scheduled", fg: "var(--cc-plum)", bg: "var(--cc-soft)" },
  completed: { label: "Completed", fg: "var(--cc-status-info)", bg: "var(--cc-status-info-bg)" },
  cancelled: { label: "Cancelled", fg: "var(--cc-muted)", bg: "var(--cc-soft)" },
  unassigned: { label: "Unassigned", fg: "var(--cc-status-warning)", bg: "var(--cc-status-warning-bg)" },
};

/** What an MD watching the roster needs to know right now: is someone there? */
export function shiftLiveStatus(shift: CoordinatorShiftRecord, now: Date = new Date()): ShiftLiveStatus {
  if (!shift.worker_id || shift.worker_id === UNASSIGNED_PLACEHOLDER_ID || shift.status === "unassigned") return "unassigned";
  if (shift.status === "cancelled") return "cancelled";
  if (shift.status === "completed" || shift.clocked_out_at) return "completed";
  if (shift.status === "in_progress" || shift.status === "clocked_in" || shift.clocked_in_at) return "on_shift";
  if (shift.scheduled_start && new Date(shift.scheduled_start).getTime() < now.getTime()) return "late";
  return "scheduled";
}

export function ShiftStatusBadge({ status }: { status: ShiftLiveStatus }) {
  const s = LIVE_STATUS[status];
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ color: s.fg, background: s.bg }}
    >
      {s.label}
    </span>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium" style={{ color: "var(--cc-muted)" }}>{label}</p>
      <p className="text-[13px] font-bold" style={{ color: "var(--cc-text)" }}>{value}</p>
    </div>
  );
}

export function ShiftHoverDetails({ shift }: { shift: CoordinatorShiftRecord }) {
  const status = shiftLiveStatus(shift);
  const tz = shift.timezone;
  const time = (iso?: string | null) => (iso ? formatAppTime(iso, tz) : "—");
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold" style={{ color: "var(--cc-text)" }}>
            {status === "unassigned" ? "Unassigned" : shift.worker_name || "Worker"}
          </p>
          <p className="truncate text-[11px]" style={{ color: "var(--cc-muted)" }}>
            with {shift.participant_name || "participant"}
            {shift.scheduled_start
              ? ` · ${formatAppDate(shift.scheduled_start, tz, { weekday: "short", day: "numeric", month: "short" })}`
              : ""}
          </p>
        </div>
        <ShiftStatusBadge status={status} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Field label="Scheduled start" value={time(shift.scheduled_start)} />
        <Field label="Scheduled end" value={time(shift.scheduled_end)} />
        <Field label="Clocked in" value={time(shift.clocked_in_at)} />
        <Field label="Clocked out" value={time(shift.clocked_out_at)} />
      </div>
    </div>
  );
}

/** Hovering (or focusing) a shift shows scheduled vs actual times. */
export function ShiftHoverCard({ shift, children }: { shift: CoordinatorShiftRecord; children: ReactNode }) {
  return (
    <HoverCard openDelay={250} closeDelay={80}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="w-72 rounded-2xl p-4">
        <ShiftHoverDetails shift={shift} />
      </HoverCardContent>
    </HoverCard>
  );
}
