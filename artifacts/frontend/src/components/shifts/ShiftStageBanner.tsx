import type { ShiftVisualState } from "@/services/shiftService";
import { stageBannerText } from "@/lib/shift-utils";
import { cn } from "@/lib/utils";

type Props = {
  visualState: ShiftVisualState;
  participantName?: string;
  className?: string;
};

const BANNER_STYLES: Record<string, string> = {
  clocked_in: "bg-amber-500 text-white",
  session_active: "bg-emerald-600 text-white",
  completed: "bg-slate-500 text-white",
};

export function ShiftStageBanner({ visualState, participantName, className }: Props) {
  const text = stageBannerText(visualState, participantName);
  if (!text) return null;

  return (
    <div
      className={cn(
        "sticky top-0 z-10 -mx-4 px-4 py-2 text-center text-xs font-black uppercase tracking-wide shadow-sm sm:-mx-0 sm:rounded-xl",
        BANNER_STYLES[visualState],
        className,
      )}
    >
      {text}
    </div>
  );
}
