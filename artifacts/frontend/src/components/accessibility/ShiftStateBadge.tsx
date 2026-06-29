import { Calendar, CheckCircle2, Clock, PlayCircle } from "lucide-react";
import type { ShiftVisualState } from "@/services/shiftService";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { AccessibleStatusBadge } from "@/components/accessibility/AccessibleStatusBadge";

const SHIFT_STATE_KEYS: Record<
  ShiftVisualState,
  { tone: "info" | "warning" | "success" | "neutral"; icon: typeof Calendar; labelKey: string }
> = {
  scheduled: { tone: "info", icon: Calendar, labelKey: "shift.state.scheduled" },
  clocked_in: { tone: "warning", icon: Clock, labelKey: "shift.state.clockedIn" },
  session_active: { tone: "success", icon: PlayCircle, labelKey: "shift.state.sessionActive" },
  completed: { tone: "neutral", icon: CheckCircle2, labelKey: "shift.state.completed" },
};

type Props = {
  state: ShiftVisualState;
  className?: string;
  /** Fallback when state is unknown */
  fallbackLabel?: string;
};

/** Shift status badge — always icon + colour (colour-blind safe). */
export function ShiftStateBadge({ state, className, fallbackLabel }: Props) {
  const { translate } = useAccessibility();
  const meta = SHIFT_STATE_KEYS[state];
  if (!meta) {
    return (
      <AccessibleStatusBadge
        label={fallbackLabel ?? state}
        icon={Calendar}
        tone="neutral"
        className={className}
      />
    );
  }
  return (
    <AccessibleStatusBadge
      label={translate(meta.labelKey)}
      icon={meta.icon}
      tone={meta.tone}
      className={className}
    />
  );
}
