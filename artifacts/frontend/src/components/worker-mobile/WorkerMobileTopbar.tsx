import { ArrowLeft } from "lucide-react";
import { WM } from "@/lib/worker-mobile-tokens";
import type { ShiftVisualState } from "@/services/shiftService";

type Phase = "session" | "review" | "completed";

type Props = {
  participantName: string;
  visualState: ShiftVisualState;
  phase?: Phase;
  elapsed?: string;
  onBreak?: boolean;
  breakElapsed?: string;
  showEnd?: boolean;
  onEnd?: () => void;
  endBusy?: boolean;
  onBack?: () => void;
};

export function WorkerMobileTopbar({
  participantName,
  visualState,
  phase = "session",
  elapsed,
  onBreak = false,
  breakElapsed,
  showEnd,
  onEnd,
  endBusy,
  onBack,
}: Props) {
  const isLive = visualState === "session_active" || visualState === "clocked_in";
  const subtitle =
    phase === "review"
      ? "Review & submit"
      : phase === "completed"
        ? "Notes submitted"
        : onBreak
          ? "On break · billing paused"
          : visualState === "session_active"
            ? "Session active · timer running"
            : visualState === "clocked_in"
              ? "Clocked in · timer running"
              : null;

  const timerDisplay = onBreak && breakElapsed ? breakElapsed : elapsed;
  const timerColor = onBreak ? "#B45309" : WM.amber;

  return (
    <header
      className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5"
      style={{ borderColor: WM.border, background: onBreak ? "rgba(217, 119, 6, 0.1)" : WM.surface }}
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border"
          style={{ borderColor: WM.border }}
          aria-label="Back"
        >
          <ArrowLeft size={17} style={{ color: WM.text }} />
        </button>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold" style={{ color: WM.text }}>
          {participantName}
        </p>
        {subtitle && (
          <p
            className="truncate text-[11px] font-medium"
            style={{ color: onBreak ? "#B45309" : WM.muted }}
          >
            {subtitle}
          </p>
        )}
      </div>

      {isLive && timerDisplay && phase === "session" && (
        <div className="shrink-0 text-right">
          <span
            className="font-mono text-[13px] font-semibold tabular-nums"
            style={{ color: timerColor }}
          >
            {timerDisplay}
          </span>
          {onBreak && elapsed && (
            <p className="text-[10px] font-medium tabular-nums" style={{ color: WM.muted }}>
              Session {elapsed}
            </p>
          )}
        </div>
      )}

      {phase === "review" && elapsed && (
        <span
          className="shrink-0 rounded-full px-2.5 py-1 font-mono text-[12px] font-semibold tabular-nums"
          style={{ background: WM.clockedInBg, color: WM.clockedInText }}
        >
          {elapsed}
        </span>
      )}

      {showEnd && onEnd && (
        <button
          type="button"
          onClick={onEnd}
          disabled={endBusy}
          className="h-8 shrink-0 rounded-lg px-3 text-[12px] font-semibold text-white disabled:opacity-60"
          style={{ background: WM.pink }}
        >
          End
        </button>
      )}
    </header>
  );
}
