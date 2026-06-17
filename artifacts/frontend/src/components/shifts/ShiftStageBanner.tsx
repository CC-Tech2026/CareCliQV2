import { MapPin, PlayCircle, CheckCircle2 } from "lucide-react";
import type { ShiftVisualState } from "@/services/shiftService";
import { stageBannerShortText, stageBannerText } from "@/lib/shift-utils";
import { cn } from "@/lib/utils";

type Props = {
  visualState: ShiftVisualState;
  participantName?: string;
  elapsed?: string;
  className?: string;
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

export function ShiftStageBanner({ visualState, participantName, elapsed, className }: Props) {
  const text = stageBannerText(visualState, participantName);
  const shortText = stageBannerShortText(visualState);
  if (!text) return null;

  const Icon = BANNER_ICONS[visualState];
  const showTimer = (visualState === "clocked_in" || visualState === "session_active") && elapsed;

  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex min-h-[56px] items-center justify-center gap-2 px-4 text-center text-xs font-black uppercase tracking-wide shadow-sm transition-colors duration-300 sm:text-sm",
        BANNER_STYLES[visualState],
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {Icon && <Icon size={16} className="shrink-0" aria-hidden />}
      <span className="hidden sm:inline">{text}</span>
      <span className="sm:hidden">{shortText}</span>
      {showTimer && (
        <span
          className="ml-1 rounded-md bg-black/15 px-2 py-0.5 font-mono text-[11px] tracking-normal sm:text-xs"
          aria-label={`Elapsed time ${elapsed}`}
        >
          {elapsed}
        </span>
      )}
    </div>
  );
}
