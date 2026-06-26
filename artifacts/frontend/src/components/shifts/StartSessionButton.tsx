import { useCallback, useRef } from "react";
import { Loader2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 500;
const GRADIENT = "#3730A3";

type Props = {
  shiftId: string;
  participantName?: string;
  onStartSession: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
};

export function StartSessionButton({
  shiftId,
  participantName,
  onStartSession,
  isLoading = false,
  disabled = false,
  className,
}: Props) {
  const lastTapRef = useRef(0);

  const handleClick = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < DEBOUNCE_MS) return;
    lastTapRef.current = now;
    onStartSession();
  }, [onStartSession]);

  const name = participantName || "participant";
  const isDisabled = disabled || isLoading;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      aria-label={`Start session for ${name}`}
      aria-busy={isLoading}
      data-shift-id={shiftId}
      className={cn(
        "flex h-14 min-h-[50px] w-full items-center justify-center rounded-2xl border-0 text-base font-semibold text-white",
        "transition-[filter,transform] duration-200 ease-in-out",
        "hover:enabled:brightness-95 active:enabled:scale-[0.98] active:enabled:brightness-90",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8b5cf6]",
        "disabled:cursor-not-allowed disabled:bg-[#d1d5db] disabled:opacity-50 disabled:[background:#d1d5db]",
        className,
      )}
      style={!isDisabled ? { background: GRADIENT } : undefined}
    >
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
          Starting...
        </>
      ) : (
        <>
          <Zap size={18} className="mr-2" aria-hidden="true" />
          Start Session
        </>
      )}
    </button>
  );
}
