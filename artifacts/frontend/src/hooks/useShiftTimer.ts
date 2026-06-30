import { useEffect, useMemo, useState } from "react";
import { formatElapsedTimer } from "@/lib/shift-utils";

function timerStorageKey(sessionId: string) {
  return `timer_${sessionId}`;
}

export function persistSessionTimerStart(sessionId: string, startedAt: string) {
  try {
    localStorage.setItem(timerStorageKey(sessionId), startedAt);
  } catch {
    /* noop */
  }
}

export function loadSessionTimerStart(sessionId: string): string | null {
  try {
    return localStorage.getItem(timerStorageKey(sessionId));
  } catch {
    return null;
  }
}

export function clearSessionTimerStart(sessionId: string) {
  try {
    localStorage.removeItem(timerStorageKey(sessionId));
  } catch {
    /* noop */
  }
}

type Options = {
  /** ISO timestamp from server (session_started_at or clocked_in_at). */
  serverStartIso?: string | null;
  /** When true, tick every second and show elapsed time. */
  active?: boolean;
};

/**
 * Client-side session/shift timer with localStorage recovery (CARECLIQV2-247).
 */
export function useShiftTimer(sessionId: string | null | undefined, options: Options = {}) {
  const { serverStartIso, active = false } = options;
  const [now, setNow] = useState(Date.now());

  const anchorIso = useMemo(() => {
    if (sessionId) {
      const stored = loadSessionTimerStart(sessionId);
      if (stored) return stored;
    }
    return serverStartIso ?? null;
  }, [sessionId, serverStartIso]);

  useEffect(() => {
    if (sessionId && serverStartIso) {
      persistSessionTimerStart(sessionId, serverStartIso);
    }
  }, [sessionId, serverStartIso]);

  useEffect(() => {
    if (!active || !anchorIso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active, anchorIso]);

  const elapsed = anchorIso ? formatElapsedTimer(anchorIso, now) : "00:00:00";

  return { elapsed, anchorIso, now };
}
