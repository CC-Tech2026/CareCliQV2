import { ChevronDown, UserRound } from "lucide-react";
import { WM } from "@/lib/worker-mobile-tokens";

type Props = {
  participantName: string;
  planLabel?: string;
};

export function WorkerMobileParticipantStrip({ participantName, planLabel = "Plan · review" }: Props) {
  return (
    <div
      className="flex items-center gap-2.5 border-b px-3 py-2.5"
      style={{ borderColor: WM.border, background: WM.surface }}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: WM.infoBg, color: WM.purple }}
      >
        <UserRound size={16} />
      </span>
      <p className="min-w-0 flex-1 truncate text-[14px] font-semibold" style={{ color: WM.text }}>
        {participantName}
      </p>
      <button
        type="button"
        className="flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
        style={{ borderColor: WM.infoBorder, background: WM.infoBg, color: WM.infoTitle }}
      >
        {planLabel}
        <ChevronDown size={12} />
      </button>
    </div>
  );
}
