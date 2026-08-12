import { useCallback, useEffect, useMemo, useState } from "react";
import { formatElapsedTimer } from "@/lib/shift-utils";
import {
  endLongShiftBreak,
  getActiveBreak,
  getBreakStatusByShift,
  startLongShiftBreak,
  type ActiveBreakStatus,
} from "@/services/longShiftService";

const INACTIVE_BREAK: ActiveBreakStatus = {
  active: false,
  completed_breaks: 0,
  total_break_secs: 0,
  can_start_break: true,
  block_reason: null,
};

function normalizeBreakStatus(data?: Partial<ActiveBreakStatus> | null): ActiveBreakStatus {
  if (!data) return INACTIVE_BREAK;
  return {
    ...INACTIVE_BREAK,
    ...data,
    can_start_break: data.can_start_break ?? !data.active,
  };
}

function sameBreakState(a: ActiveBreakStatus, b: ActiveBreakStatus) {
  return (
    a.active === b.active
    && a.break_start_at === b.break_start_at
    && a.id === b.id
    && a.completed_breaks === b.completed_breaks
    && a.total_break_secs === b.total_break_secs
    && a.can_start_break === b.can_start_break
    && a.block_reason === b.block_reason
  );
}

type Options = {
  shiftId?: string | null;
  initialStatus?: ActiveBreakStatus | null;
};

/**
 * Tracks active long-shift break state from the server with a live elapsed timer.
 */
export function useLongShiftBreak(
  sessionId: string | null | undefined,
  options: Options = {},
) {
  const { shiftId, initialStatus } = options;
  const [breakState, setBreakState] = useState<ActiveBreakStatus>(() =>
    normalizeBreakStatus(initialStatus),
  );
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialStatus) {
      setBreakState((prev) => {
        const next = normalizeBreakStatus(initialStatus);
        return sameBreakState(prev, next) ? prev : next;
      });
    }
  }, [initialStatus]);

  const applyBreakState = useCallback((next: ActiveBreakStatus) => {
    setBreakState((prev) => {
      const normalized = normalizeBreakStatus(next);
      return sameBreakState(prev, normalized) ? prev : normalized;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionId && !shiftId) {
      applyBreakState(INACTIVE_BREAK);
      return;
    }
    try {
      if (sessionId) {
        const data = await getActiveBreak(sessionId);
        applyBreakState(data);
        return;
      }
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status !== 404 || !shiftId) {
        if (!shiftId) {
          applyBreakState(INACTIVE_BREAK);
          return;
        }
      }
    }
    if (shiftId) {
      try {
        const data = await getBreakStatusByShift(shiftId);
        applyBreakState(data);
        return;
      } catch {
        applyBreakState(INACTIVE_BREAK);
      }
    }
  }, [sessionId, shiftId, applyBreakState]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!sessionId && !shiftId) return;
    const poll = setInterval(() => void refresh(), 15000);
    return () => clearInterval(poll);
  }, [sessionId, shiftId, refresh]);

  useEffect(() => {
    if (!breakState.active || !breakState.break_start_at) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [breakState.active, breakState.break_start_at]);

  const breakElapsed = breakState.active && breakState.break_start_at
    ? formatElapsedTimer(breakState.break_start_at, now)
    : "00:00:00";

  const onBreak = Boolean(breakState.active);
  const canStartBreak = breakState.can_start_break ?? (!onBreak && (breakState.completed_breaks ?? 0) === 0);
  const breakLimitReached = breakState.block_reason === "break_limit_reached"
    || ((breakState.max_breaks_per_shift ?? 1) <= (breakState.completed_breaks ?? 0) && !onBreak);

  const startBreak = useCallback(async () => {
    if (!sessionId) throw new Error("No active session");
    if (!canStartBreak) {
      throw new Error("Only one break is allowed per shift.");
    }
    setBusy(true);
    const optimisticStart = new Date().toISOString();
    applyBreakState({
      ...breakState,
      active: true,
      break_start_at: optimisticStart,
      can_start_break: false,
      block_reason: "break_in_progress",
    });
    try {
      const result = await startLongShiftBreak(sessionId);
      if (result?.break_start_at) {
        applyBreakState({
          active: true,
          id: result.id,
          break_start_at: result.break_start_at,
          can_start_break: false,
          block_reason: "break_in_progress",
          completed_breaks: breakState.completed_breaks,
          total_break_secs: breakState.total_break_secs,
        });
      }
      await refresh();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (msg.toLowerCase().includes("already in progress")) {
        await refresh();
      } else {
        await refresh();
        throw error;
      }
    } finally {
      setBusy(false);
    }
  }, [sessionId, applyBreakState, refresh, canStartBreak, breakState]);

  const endBreak = useCallback(async () => {
    if (!sessionId) throw new Error("No active session");
    setBusy(true);
    const previous = breakState;
    applyBreakState({
      ...INACTIVE_BREAK,
      completed_breaks: (breakState.completed_breaks ?? 0) + 1,
      can_start_break: false,
      block_reason: "break_limit_reached",
      max_breaks_per_shift: breakState.max_breaks_per_shift ?? 1,
    });
    try {
      await endLongShiftBreak(sessionId);
      await refresh();
    } catch (error) {
      applyBreakState(previous);
      throw error;
    } finally {
      setBusy(false);
    }
  }, [sessionId, applyBreakState, refresh, breakState]);

  const totalBreakMinutes = Math.floor((breakState.total_break_secs ?? 0) / 60);

  return useMemo(
    () => ({
      onBreak,
      breakStartAt: breakState.break_start_at ?? null,
      breakElapsed,
      breakBusy: busy,
      completedBreaks: breakState.completed_breaks ?? 0,
      totalBreakSecs: breakState.total_break_secs ?? 0,
      totalBreakMinutes,
      canStartBreak,
      breakLimitReached,
      blockReason: breakState.block_reason ?? null,
      refresh,
      startBreak,
      endBreak,
    }),
    [
      onBreak,
      breakState.break_start_at,
      breakState.completed_breaks,
      breakState.total_break_secs,
      breakState.block_reason,
      breakElapsed,
      busy,
      totalBreakMinutes,
      canStartBreak,
      breakLimitReached,
      refresh,
      startBreak,
      endBreak,
    ],
  );
}
