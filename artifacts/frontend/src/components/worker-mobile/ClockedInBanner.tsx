import { CheckCircle2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { WM } from "@/lib/worker-mobile-tokens";

type Props = {
  clockedInAt: string;
};

export function ClockedInBanner({ clockedInAt }: Props) {
  let timeLabel = clockedInAt;
  try {
    timeLabel = format(parseISO(clockedInAt), "h:mm a");
  } catch {
    /* keep raw */
  }

  return (
    <div
      className="mx-3 mt-3 flex items-start gap-2.5 rounded-xl border px-3 py-2.5"
      style={{
        background: WM.clockedInBg,
        borderColor: WM.clockedInBorder,
      }}
    >
      <CheckCircle2 size={20} style={{ color: WM.clockedInIcon, flexShrink: 0 }} />
      <div>
        <p className="text-[13px] font-semibold" style={{ color: WM.clockedInText }}>
          Clocked in at {timeLabel}
        </p>
        <p className="text-[12px] font-medium leading-snug" style={{ color: WM.clockedInText }}>
          Tap any task to begin documenting
        </p>
      </div>
    </div>
  );
}
