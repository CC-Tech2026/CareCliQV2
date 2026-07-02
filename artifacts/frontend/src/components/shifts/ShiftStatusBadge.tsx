import { CalendarClock, CheckCircle2, Coffee, MapPin, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATE_STYLES } from "@/lib/shift-utils";
import type { ShiftVisualState } from "@/services/shiftService";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const STATUS_ICONS: Record<ShiftVisualState, typeof CalendarClock> = {
  scheduled: CalendarClock,
  clocked_in: MapPin,
  session_active: Zap,
  completed: CheckCircle2,
};

const STATE_LABEL_KEYS: Record<ShiftVisualState, string> = {
  scheduled: "shift.state.scheduled",
  clocked_in: "shift.state.clockedIn",
  session_active: "shift.state.sessionActive",
  completed: "shift.state.completed",
};

type Props = {
  visualState: ShiftVisualState;
  className?: string;
  onBreak?: boolean;
};

export function ShiftStatusBadge({ visualState, className, onBreak = false }: Props) {
  const { translate } = useAccessibility();

  if (onBreak) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-800",
          className,
        )}
      >
        <Coffee size={12} className="shrink-0 animate-pulse" strokeWidth={2.5} />
        On break
      </span>
    );
  }

  const state = STATE_STYLES[visualState] ?? STATE_STYLES.scheduled;
  const Icon = STATUS_ICONS[visualState] ?? CalendarClock;
  const label = translate(STATE_LABEL_KEYS[visualState] ?? STATE_LABEL_KEYS.scheduled);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide",
        state.badge,
        className,
      )}
    >
      <Icon size={12} className="shrink-0" strokeWidth={2.5} />
      {label}
    </span>
  );
}
