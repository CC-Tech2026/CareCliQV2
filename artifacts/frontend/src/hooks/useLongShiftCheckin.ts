import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getCheckinStatus,
  getCheckinStatusByShift,
  type CheckinWindowStatus,
} from "@/services/longShiftService";

const INACTIVE_CHECKIN: CheckinWindowStatus = {
  applicable: false,
  can_submit_checkin: false,
  block_reason: null,
  cooldown_remaining_secs: 0,
  next_checkin_due_secs: 0,
  checkin_overdue: false,
  checkins_completed: 0,
  checkins_required: 0,
};

function normalizeCheckinStatus(data?: Partial<CheckinWindowStatus> | null): CheckinWindowStatus {
  if (!data) return INACTIVE_CHECKIN;
  return {
    ...INACTIVE_CHECKIN,
    ...data,
    can_submit_checkin: data.can_submit_checkin ?? false,
  };
}

function sameCheckinState(a: CheckinWindowStatus, b: CheckinWindowStatus) {
  return (
    a.applicable === b.applicable
    && a.can_submit_checkin === b.can_submit_checkin
    && a.block_reason === b.block_reason
    && a.cooldown_remaining_secs === b.cooldown_remaining_secs
    && a.next_checkin_due_secs === b.next_checkin_due_secs
    && a.checkin_overdue === b.checkin_overdue
    && a.checkins_completed === b.checkins_completed
    && a.checkins_required === b.checkins_required
  );
}

type Options = {
  shiftId?: string | null;
  initialStatus?: CheckinWindowStatus | null;
  onBreak?: boolean;
};

export function formatCheckinWaitLabel(secs: number): string {
  if (secs <= 0) return "now";
  const mins = Math.ceil(secs / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

/**
 * Tracks long-shift check-in eligibility with cooldown and 90-minute due windows.
 */
export function useLongShiftCheckin(
  sessionId: string | null | undefined,
  options: Options = {},
) {
  const { shiftId, initialStatus, onBreak = false } = options;
  const [state, setState] = useState<CheckinWindowStatus>(() =>
    normalizeCheckinStatus(initialStatus),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialStatus) {
      setState((prev) => {
        const next = normalizeCheckinStatus(initialStatus);
        return sameCheckinState(prev, next) ? prev : next;
      });
    }
  }, [initialStatus]);

  const applyState = useCallback((next: CheckinWindowStatus) => {
    setState((prev) => {
      const normalized = normalizeCheckinStatus(next);
      return sameCheckinState(prev, normalized) ? prev : normalized;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionId && !shiftId) {
      applyState(INACTIVE_CHECKIN);
      return;
    }
    try {
      if (sessionId) {
        const data = await getCheckinStatus(sessionId);
        applyState(data);
        return;
      }
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status !== 404 || !shiftId) {
        if (!shiftId) {
          applyState(INACTIVE_CHECKIN);
          return;
        }
      }
    }
    if (shiftId) {
      try {
        const data = await getCheckinStatusByShift(shiftId);
        applyState(data);
        return;
      } catch {
        applyState(INACTIVE_CHECKIN);
      }
    }
  }, [sessionId, shiftId, applyState]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!sessionId && !shiftId) return;
    const poll = setInterval(() => void refresh(), 15000);
    return () => clearInterval(poll);
  }, [sessionId, shiftId, refresh]);

  const effectiveOnBreak = onBreak || state.block_reason === "on_break";
  const canSubmitRoutine = Boolean(state.can_submit_checkin) && !effectiveOnBreak;
  const canSubmitEmergency = !effectiveOnBreak && Boolean(state.applicable);

  const cooldownRemainingSecs = Math.max(0, state.cooldown_remaining_secs ?? 0);
  const nextDueSecs = Math.max(0, state.next_checkin_due_secs ?? 0);

  const statusHint = useMemo(() => {
    if (!state.applicable) return null;
    if (effectiveOnBreak) {
      return "End your break before checking in.";
    }
    if (state.checkin_overdue && cooldownRemainingSecs === 0) {
      return "Check-in is due now.";
    }
    if (state.block_reason === "cooldown") {
      return `Next routine check-in available in ${formatCheckinWaitLabel(cooldownRemainingSecs)}.`;
    }
    if (state.block_reason === "not_due_yet") {
      return `Next check-in due in ${formatCheckinWaitLabel(nextDueSecs)}.`;
    }
    if (canSubmitRoutine) {
      const completed = state.checkins_completed ?? 0;
      const required = state.checkins_required ?? 0;
      if (required > 0) {
        return `${completed} of ${required} check-ins completed this shift.`;
      }
      return "You can submit a routine check-in now.";
    }
    return null;
  }, [
    state,
    effectiveOnBreak,
    cooldownRemainingSecs,
    nextDueSecs,
    canSubmitRoutine,
  ]);

  const markSubmitted = useCallback(() => {
    void refresh();
  }, [refresh]);

  return useMemo(
    () => ({
      applicable: Boolean(state.applicable),
      canSubmitRoutine,
      canSubmitEmergency,
      checkinOverdue: Boolean(state.checkin_overdue),
      checkinsCompleted: state.checkins_completed ?? 0,
      checkinsRequired: state.checkins_required ?? 0,
      cooldownRemainingSecs,
      nextDueSecs,
      blockReason: state.block_reason ?? null,
      statusHint,
      checkinBusy: busy,
      setCheckinBusy: setBusy,
      refresh,
      markSubmitted,
    }),
    [
      state,
      canSubmitRoutine,
      canSubmitEmergency,
      cooldownRemainingSecs,
      nextDueSecs,
      statusHint,
      busy,
      refresh,
      markSubmitted,
    ],
  );
}
