import { useState, useEffect } from "react";
import { Activity, Coffee, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { BreakStatusBanner } from "@/components/shifts/BreakStatusBanner";
import {
  formatCheckinWaitLabel,
  useLongShiftCheckin,
} from "@/hooks/useLongShiftCheckin";
import type { useLongShiftBreak } from "@/hooks/useLongShiftBreak";
import {
  submitLongShiftCheckin,
  type CheckinStatus,
  type CheckinWindowStatus,
} from "@/services/longShiftService";

const PLUM = "var(--cc-plum)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

type BreakControl = ReturnType<typeof useLongShiftBreak>;

type Props = {
  sessionId: string;
  shiftId?: string;
  clockedInAt?: string | null;
  sessionElapsed?: string;
  breakControl: BreakControl;
  initialCheckinStatus?: CheckinWindowStatus | null;
};

export function LongShiftEngagementPanel({
  sessionId,
  shiftId,
  clockedInAt,
  sessionElapsed,
  breakControl,
  initialCheckinStatus,
}: Props) {
  const { toast } = useToast();
  const {
    onBreak,
    breakElapsed,
    breakBusy,
    canStartBreak,
    breakLimitReached,
    completedBreaks,
    totalBreakMinutes,
    startBreak,
    endBreak,
  } = breakControl;

  const checkinControl = useLongShiftCheckin(sessionId, {
    shiftId,
    initialStatus: initialCheckinStatus,
    onBreak,
  });

  const [checkinOpen, setCheckinOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);

  const {
    canSubmitRoutine,
    canSubmitEmergency,
    checkinOverdue,
    checkinsCompleted,
    checkinsRequired,
    statusHint,
    markSubmitted,
    refresh: refreshCheckin,
  } = checkinControl;

  useEffect(() => {
    if (!clockedInAt) return;
    const tick = () => {
      const start = new Date(clockedInAt).getTime();
      if (!Number.isFinite(start)) return;
      setElapsedMinutes(Math.max(0, Math.floor((Date.now() - start) / 60000)));
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [clockedInAt]);

  if (elapsedMinutes < 240) return null;

  const submitCheckin = async (status: CheckinStatus) => {
    const isEmergency = status !== "GOING_WELL";
    if (!isEmergency && !canSubmitRoutine) {
      toast({
        variant: "destructive",
        title: "Check-in not available yet",
        description: statusHint ?? "Please wait for the next check-in window.",
      });
      return;
    }

    setBusy(true);
    try {
      await submitLongShiftCheckin(sessionId, {
        status,
        note: note.trim() || undefined,
        prompt_triggered_at: new Date().toISOString(),
      });
      toast({ title: "Check-in recorded" });
      setCheckinOpen(false);
      setNote("");
      markSubmitted();
      await refreshCheckin();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Check-in failed";
      toast({ variant: "destructive", title: msg });
      await refreshCheckin();
    } finally {
      setBusy(false);
    }
  };

  const toggleBreak = async () => {
    try {
      if (onBreak) {
        await endBreak();
        toast({ title: "Break ended" });
      } else {
        await startBreak();
        toast({ title: "Break started — billing paused" });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Break action failed";
      if (msg.toLowerCase().includes("already in progress")) {
        await breakControl.refresh();
        toast({
          title: "Break already in progress",
          description: "Tap End break when you return to the participant.",
        });
        return;
      }
      toast({ variant: "destructive", title: msg });
    }
  };

  const actionBusy = busy || breakBusy;
  const canOpenCheckin = canSubmitEmergency;

  const checkinButtonTitle = onBreak
    ? "End your break before checking in"
    : !canSubmitRoutine && checkinOverdue
      ? "Routine check-in is due"
      : !canSubmitRoutine
        ? statusHint ?? "Check-in not available yet"
        : undefined;

  return (
    <section
      className="rounded-2xl border bg-cc-surface p-4 shadow-sm"
      style={{ borderColor: BORDER }}
    >
      {onBreak && (
        <div className="mb-3">
          <BreakStatusBanner
            variant="card"
            breakElapsed={breakElapsed}
            sessionElapsed={sessionElapsed}
          />
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <Activity size={16} style={{ color: PLUM }} />
        <h3 className="text-sm font-black" style={{ color: PLUM }}>
          Long shift activity
        </h3>
      </div>
      <p className="mb-3 text-xs" style={{ color: MUTED }}>
        Shifts over 4 hours need check-ins about every 90 minutes (opens 15 minutes before due).
        You may log <strong>one break per shift</strong> when you step away from the participant.
      </p>
      {checkinsRequired > 0 && (
        <p className="mb-3 text-xs font-medium" style={{ color: MUTED }}>
          Check-ins this shift:{" "}
          <strong style={{ color: PLUM }}>
            {checkinsCompleted} of {checkinsRequired}
          </strong>
          {checkinOverdue && !onBreak ? " · due now" : ""}
        </p>
      )}
      {breakLimitReached && !onBreak && (
        <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
          Break logged
          {totalBreakMinutes > 0 ? ` (${totalBreakMinutes} min)` : ""}
          {completedBreaks > 0 ? ` · ${completedBreaks} of 1 used` : ""}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={checkinOverdue && canSubmitRoutine ? "default" : "outline"}
          className="gap-1.5 rounded-full text-xs font-bold"
          disabled={actionBusy || !canOpenCheckin}
          title={checkinButtonTitle}
          onClick={() => setCheckinOpen((v) => !v)}
        >
          <MessageCircle size={14} />
          {checkinOverdue && canSubmitRoutine ? "Check in (due)" : "Check in"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={onBreak ? "default" : "outline"}
          className="gap-1.5 rounded-full text-xs font-bold"
          disabled={actionBusy || (!onBreak && !canStartBreak)}
          title={
            breakLimitReached && !onBreak
              ? "Only one break is allowed per shift"
              : onBreak
                ? "End your break to resume billing"
                : undefined
          }
          onClick={() => void toggleBreak()}
        >
          <Coffee size={14} />
          {onBreak ? "End break" : breakLimitReached ? "Break logged" : "Log break"}
        </Button>
      </div>
      {statusHint && (
        <p
          className={`mt-2 text-[11px] font-medium ${
            checkinOverdue && !onBreak ? "text-amber-700" : ""
          }`}
          style={checkinOverdue && !onBreak ? undefined : { color: MUTED }}
        >
          {statusHint}
        </p>
      )}
      {breakLimitReached && !onBreak && !statusHint && (
        <p className="mt-2 text-[11px] font-medium" style={{ color: MUTED }}>
          One break per shift is already recorded.
        </p>
      )}
      {onBreak && (
        <p className="mt-2 text-[11px] font-medium text-amber-700">
          Break timer: <span className="font-mono font-bold">{breakElapsed}</span>
          {" · "}Billing clock paused until you end break.
        </p>
      )}
      {checkinOpen && (
        <div className="mt-3 space-y-2 rounded-xl border p-3" style={{ borderColor: BORDER }}>
          {!canSubmitRoutine && (
            <p className="text-[11px] font-medium text-amber-700">
              Routine check-in unavailable
              {checkinControl.cooldownRemainingSecs > 0
                ? ` — wait ${formatCheckinWaitLabel(checkinControl.cooldownRemainingSecs)}`
                : checkinControl.nextDueSecs > 0
                  ? ` — due in ${formatCheckinWaitLabel(checkinControl.nextDueSecs)}`
                  : ""}
              . Needs attention and incident reports are always available.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["GOING_WELL", "Going well"],
                ["NEEDS_ATTENTION", "Needs attention"],
                ["INCIDENT_REPORTED", "Report incident"],
              ] as const
            ).map(([status, label]) => {
              const isRoutine = status === "GOING_WELL";
              const disabled = actionBusy || (isRoutine && !canSubmitRoutine);
              return (
                <Button
                  key={status}
                  type="button"
                  size="sm"
                  variant={status === "INCIDENT_REPORTED" ? "destructive" : "outline"}
                  className="rounded-full text-xs"
                  disabled={disabled}
                  title={
                    isRoutine && !canSubmitRoutine
                      ? statusHint ?? "Not due yet"
                      : undefined
                  }
                  onClick={() => void submitCheckin(status)}
                >
                  {label}
                </Button>
              );
            })}
          </div>
          <textarea
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: BORDER }}
            placeholder="Optional note (max 500 chars)"
            maxLength={500}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      )}
    </section>
  );
}
