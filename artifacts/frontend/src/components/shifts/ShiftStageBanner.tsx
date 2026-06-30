import { Loader2, MapPin, PlayCircle, CheckCircle2, Square } from "lucide-react";
import type { ShiftVisualState } from "@/services/shiftService";
import { cn } from "@/lib/utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  visualState: ShiftVisualState;
  participantName?: string;
  elapsed?: string;
  className?: string;
  onEndShift?: () => void;
  endShiftBusy?: boolean;
};

const BANNER_STYLES: Record<string, string> = {
  clocked_in: "bg-amber-500 text-white",
  session_active: "bg-emerald-600 text-white",
  completed: "bg-slate-500 text-white",
};

const BANNER_ICONS: Record<string, typeof MapPin> = {
  clocked_in: MapPin,
  session_active: PlayCircle,
  completed: CheckCircle2,
};

const BANNER_TEXT_KEYS: Record<string, string> = {
  clocked_in: "shift.banner.arrived",
  session_active: "shift.banner.sessionActive",
  completed: "shift.banner.completed",
};

const BANNER_SHORT_KEYS: Record<string, string> = {
  clocked_in: "shift.banner.arrivedShort",
  session_active: "shift.banner.activeShort",
  completed: "shift.banner.doneShort",
};

export function ShiftStageBanner({
  visualState,
  participantName,
  elapsed,
  className,
  onEndShift,
  endShiftBusy,
}: Props) {
  const { translate, translateParams } = useAccessibility();
  const textKey = BANNER_TEXT_KEYS[visualState];
  const shortKey = BANNER_SHORT_KEYS[visualState];
  if (!textKey || !shortKey) return null;

  const name = participantName || translate("common.participant");
  const text = translateParams(textKey, { name });
  const shortText = translate(shortKey);
  const Icon = BANNER_ICONS[visualState];
  const showTimer = (visualState === "clocked_in" || visualState === "session_active") && elapsed;

  const showEndShift = visualState === "session_active" && Boolean(onEndShift);

  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex min-h-[56px] items-center px-4 text-xs font-black uppercase tracking-wide shadow-sm transition-colors duration-300 sm:text-sm",
        showEndShift ? "justify-between gap-3" : "justify-center gap-2 text-center",
        BANNER_STYLES[visualState],
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className={cn("flex min-w-0 items-center gap-2", !showEndShift && "justify-center")}>
        {Icon && <Icon size={16} className="shrink-0" aria-hidden />}
        <span className="hidden truncate sm:inline">{text}</span>
        <span className="truncate sm:hidden">{shortText}</span>
      </div>

      {(showTimer || showEndShift) && (
        <div className="flex shrink-0 items-center gap-2">
          {/* {showTimer && (
            <span
              className="rounded-md bg-black/15 px-2 py-0.5 font-mono text-[11px] tracking-normal sm:text-xs"
              aria-label={translateParams("shift.banner.elapsedTime", { elapsed: elapsed ?? "" })}
            >
              {elapsed}
            </span>
          )} */}
          {/* {showEndShift && (
            <button
              type="button"
              data-tutorial="end-shift"
              disabled={endShiftBusy}
              onClick={(event) => {
                event.stopPropagation();
                onEndShift?.();
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/15 px-3 text-[11px] font-black uppercase tracking-wide text-white transition hover:bg-white/25 disabled:opacity-60 sm:text-xs"
            >
              {endShiftBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square size={12} />
              )}
              {translate("shift.endShiftButton")}
            </button>
          )} */}
        </div>
      )}
    </div>
  );
}
