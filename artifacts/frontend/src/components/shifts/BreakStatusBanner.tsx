import { Coffee } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "inline" | "card" | "mobile";

type Props = {
  breakElapsed: string;
  sessionElapsed?: string;
  variant?: Variant;
  className?: string;
};

export function BreakStatusBanner({
  breakElapsed,
  sessionElapsed,
  variant = "inline",
  className,
}: Props) {
  if (variant === "card") {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5",
          className,
        )}
        style={{
          background: "var(--cc-status-warning-bg)",
          borderColor: "rgba(217, 119, 6, 0.35)",
        }}
        role="status"
        aria-live="polite"
      >
        <span className="flex min-w-0 items-center gap-2 text-xs font-bold text-amber-800">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
          <Coffee size={14} className="shrink-0" aria-hidden />
          On break — billing paused
        </span>
        <div className="shrink-0 text-right">
          <span className="font-mono text-sm font-black text-amber-700">{breakElapsed}</span>
          {sessionElapsed && (
            <p className="text-[10px] font-semibold text-amber-700/80">
              Session {sessionElapsed}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (variant === "mobile") {
    return (
      <div
        className={cn(
          "mx-3 mt-2 flex items-center justify-between gap-2 rounded-xl border px-3 py-2",
          className,
        )}
        style={{
          background: "rgba(217, 119, 6, 0.12)",
          borderColor: "rgba(217, 119, 6, 0.35)",
        }}
        role="status"
        aria-live="polite"
      >
        <span className="flex items-center gap-2 text-[12px] font-semibold text-amber-800">
          <Coffee size={14} aria-hidden />
          On break
        </span>
        <span className="font-mono text-[13px] font-bold tabular-nums text-amber-700">
          {breakElapsed}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-end gap-0.5", className)} role="status" aria-live="polite">
      <span className="font-mono text-sm font-black text-amber-700">{breakElapsed}</span>
      {sessionElapsed && (
        <span className="text-[10px] font-semibold text-amber-700/75">
          Session {sessionElapsed}
        </span>
      )}
    </div>
  );
}
