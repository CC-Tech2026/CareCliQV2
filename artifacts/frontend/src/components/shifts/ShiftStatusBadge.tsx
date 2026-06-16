import { CalendarClock, CheckCircle2, MapPin, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATE_STYLES } from "@/lib/shift-utils";
import type { ShiftVisualState } from "@/services/shiftService";

const STATUS_ICONS: Record<ShiftVisualState, typeof CalendarClock> = {
  scheduled: CalendarClock,
  clocked_in: MapPin,
  session_active: Zap,
  completed: CheckCircle2,
};

type Props = {
  visualState: ShiftVisualState;
  className?: string;
};

export function ShiftStatusBadge({ visualState, className }: Props) {
  const state = STATE_STYLES[visualState] ?? STATE_STYLES.scheduled;
  const Icon = STATUS_ICONS[visualState] ?? CalendarClock;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide",
        state.badge,
        className,
      )}
    >
      <Icon size={12} className="shrink-0" strokeWidth={2.5} />
      {state.label}
    </span>
  );
}
