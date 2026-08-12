import { Users } from "lucide-react";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { ParticipantShiftContextEditor } from "@/components/participants/ParticipantShiftContextEditor";

interface ParticipantShiftContextTabProps {
  participantId: string;
}

/** "Shift Context" facet of the participant Detail archetype — coordinator only. */
export function ParticipantShiftContextTab({ participantId }: ParticipantShiftContextTabProps) {
  const { translate } = useAccessibility();

  return (
    <section className="space-y-3">
      <div className="rounded-2xl border border-violet-200/70 bg-violet-50/30 p-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-violet-700" />
            <p className="text-[12px] font-black uppercase tracking-[0.13em] text-violet-800">{translate("patients.shiftContext.title")}</p>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-violet-300 text-violet-700 font-semibold uppercase tracking-wide bg-violet-100">
            Coordinator Authoring
          </span>
        </div>
        <p className="text-[12px] leading-relaxed text-violet-700/80">
          This information appears in the Support Worker My Shift experience. Keep instructions concise, current, and action-oriented.
        </p>
      </div>

      <ParticipantShiftContextEditor participantId={participantId} />
    </section>
  );
}
