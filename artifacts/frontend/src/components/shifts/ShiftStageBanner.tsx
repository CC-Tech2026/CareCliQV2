import { Coffee, Loader2, MapPin, PlayCircle, CheckCircle2, Square } from "lucide-react";
import type { ShiftVisualState } from "@/services/shiftService";
import { cn } from "@/lib/utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  visualState: ShiftVisualState;
  participantName?: string;
  elapsed?: string;
  onBreak?: boolean;
  breakElapsed?: string;
  className?: string;
  onEndShift?: () => void;
  endShiftBusy?: boolean;
};

const BANNER_STYLES: Record<string, string> = {
  clocked_in: "bg-amber-500 text-white",
  session_active: "bg-emerald-600 text-white",
  on_break: "bg-amber-600 text-white",
  completed: "bg-slate-500 text-white",
};

const BANNER_ICONS: Record<string, typeof MapPin> = {
  clocked_in: MapPin,
  session_active: PlayCircle,
  on_break: Coffee,
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
  onBreak = false,
  breakElapsed,
  className,
  onEndShift,
  endShiftBusy,
}: Props) {
  const { translate, translateParams } = useAccessibility();
  const bannerKey = onBreak ? "on_break" : visualState;
  const textKey = onBreak ? null : BANNER_TEXT_KEYS[visualState];
  const shortKey = onBreak ? null : BANNER_SHORT_KEYS[visualState];
  if (!onBreak && (!textKey || !shortKey)) return null;

  const name = participantName || translate("common.participant");
  const text = onBreak
    ? `On break: billing paused · ${name}`
    : translateParams(textKey!, { name });
  const shortText = onBreak ? "On break" : translate(shortKey!);
  const Icon = BANNER_ICONS[bannerKey] ?? PlayCircle;
  const showTimer = !onBreak && (visualState === "clocked_in" || visualState === "session_active") && elapsed;
  const showBreakTimer = onBreak && breakElapsed;
  const showEndShift = visualState === "session_active" && Boolean(onEndShift) && !onBreak;

  return (
    <div
      className={cn(
        "sticky top-0 z-20 flex min-h-[56px] items-center px-4 text-xs font-black uppercase tracking-wide shadow-sm transition-colors duration-300 sm:text-sm",
        showEndShift || showBreakTimer ? "justify-between gap-3" : "justify-center gap-2 text-center",
        BANNER_STYLES[bannerKey],
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className={cn("flex min-w-0 items-center gap-2", !showEndShift && !showBreakTimer && "justify-center")}>
        {Icon && <Icon size={16} className="shrink-0" aria-hidden />}
        <span className="hidden truncate sm:inline">{text}</span>
        <span className="truncate sm:hidden">{shortText}</span>
      </div>

      {(showTimer || showBreakTimer || showEndShift) && (
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          {showBreakTimer && (
            <>
              <span className="rounded-md bg-black/15 px-2 py-0.5 font-mono text-[12px] tracking-normal sm:text-sm">
                {breakElapsed}
              </span>
              {elapsed && (
                <span className="text-[10px] font-semibold normal-case tracking-normal opacity-90">
                  Session {elapsed}
                </span>
              )}
            </>
          )}
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
