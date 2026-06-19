import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;

type Options = {
  enabled: boolean;
  onTimeout: () => void;
};

export function useIdleTimeout({ enabled, onTimeout }: Options) {
  const timeoutMinutes = Number(import.meta.env.VITE_IDLE_TIMEOUT_MINUTES || 30);
  const warningSeconds = Number(import.meta.env.VITE_IDLE_WARNING_SECONDS || 120);
  const timeoutMs = Math.max(1, timeoutMinutes) * 60 * 1000;
  const warningMs = Math.min(Math.max(10, warningSeconds) * 1000, timeoutMs);

  const [warningOpen, setWarningOpen] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(Math.ceil(warningMs / 1000));
  const warningTimerRef = useRef<number | null>(null);
  const logoutTimerRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const onTimeoutRef = useRef(onTimeout);

  onTimeoutRef.current = onTimeout;

  const clearTimers = useCallback(() => {
    [warningTimerRef, logoutTimerRef, countdownRef].forEach((ref) => {
      if (ref.current) window.clearTimeout(ref.current);
      ref.current = null;
    });
  }, []);

  const reset = useCallback(() => {
    if (!enabled) return;
    clearTimers();
    setWarningOpen(false);
    setRemainingSeconds(Math.ceil(warningMs / 1000));
    warningTimerRef.current = window.setTimeout(() => {
      setWarningOpen(true);
      const deadline = Date.now() + warningMs;
      const tick = () => {
        const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        setRemainingSeconds(seconds);
        if (seconds > 0) countdownRef.current = window.setTimeout(tick, 1000);
      };
      tick();
    }, timeoutMs - warningMs);
    logoutTimerRef.current = window.setTimeout(() => {
      clearTimers();
      setWarningOpen(false);
      onTimeoutRef.current();
    }, timeoutMs);
  }, [clearTimers, enabled, timeoutMs, warningMs]);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      setWarningOpen(false);
      return;
    }
    reset();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, reset));
      clearTimers();
    };
  }, [clearTimers, enabled, reset]);

  return useMemo(() => ({
    warningOpen,
    remainingSeconds,
    staySignedIn: reset,
  }), [remainingSeconds, reset, warningOpen]);
}
