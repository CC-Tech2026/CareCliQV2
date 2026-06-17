import { Link } from "wouter";
import { ChevronRight, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { ShiftStatusBadge } from "@/components/shifts/ShiftStatusBadge";
import type { WorkerShift } from "@/services/shiftService";
import {
  shiftInitials,
  shiftDurationMinutes,
  formatDurationLabel,
  formatShiftTimeRange,
  TEXT,
  MUTED,
  PLUM,
  STATE_STYLES,
  avatarShouldPulse,
} from "@/lib/shift-utils";

const SERVICE_TAG_STYLES: Record<string, string> = {
  CORE: "bg-blue-50 text-blue-700 border-blue-200",
  "CAPACITY BUILDING": "bg-emerald-50 text-emerald-700 border-emerald-200",
};

type Props = { shift: WorkerShift };

export function ShiftListCard({ shift }: Props) {
  const duration = shiftDurationMinutes(shift.scheduled_start, shift.scheduled_end, shift.duration_minutes);
  const durationLabel = formatDurationLabel(duration);
  const serviceTag = (shift.service_category || "CORE").toUpperCase();
  const tagStyle = SERVICE_TAG_STYLES[serviceTag] ?? SERVICE_TAG_STYLES.CORE;
  const stateStyle = STATE_STYLES[shift.visual_state] ?? STATE_STYLES.scheduled;
  const pulse = avatarShouldPulse(shift.visual_state);

  return (
    <article
      className="rounded-2xl border-2 bg-white p-4 shadow-sm transition-[border-color] duration-300"
      style={{ borderColor: stateStyle.border }}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "grid h-11 w-11 shrink-0 place-items-center rounded-full text-xs font-black text-white",
            pulse && "animate-pulse",
          )}
          style={{ background: stateStyle.avatar }}
        >
          {shiftInitials(shift.participant_name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-black" style={{ color: TEXT }}>
              {shift.participant_name || "Participant"}
            </h3>
            <span className={cn("rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase", tagStyle)}>
              {serviceTag}
            </span>
          </div>

          <p className="mt-1 text-xs font-semibold" style={{ color: MUTED }}>
            {formatShiftTimeRange(shift.scheduled_start, shift.scheduled_end)}
            {durationLabel ? ` · ${durationLabel} scheduled` : ""}
          </p>

          {shift.participant_address && (
            <p className="mt-0.5 flex items-start gap-1 text-xs font-medium" style={{ color: MUTED }}>
              <MapPin size={12} className="mt-0.5 shrink-0" />
              <span className="line-clamp-2">{shift.participant_address}</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <ShiftStatusBadge visualState={shift.visual_state} />
          <Link href={`/my-shifts/${shift.id}`}>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full px-4 py-2 text-xs font-black text-white transition hover:opacity-90"
              style={{ background: PLUM }}
            >
              Open Shift
              <ChevronRight size={14} strokeWidth={3} />
            </button>
          </Link>
        </div>
      </div>
    </article>
  );
}
