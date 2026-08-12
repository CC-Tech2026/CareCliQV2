import { X } from "lucide-react";
import { WM } from "@/lib/worker-mobile-tokens";
import { WorkerIncidentReportForm } from "@/components/shifts/WorkerIncidentReportForm";

type Props = {
  shiftId: string;
  participantId?: string;
  participantName?: string;
  sessionId?: string | null;
  shiftAddress?: string;
  sourceNoteId?: string;
  sourceNoteContent?: string;
  onFiled: (noteId?: string) => void;
  onClose: () => void;
};

export function WorkerMobileIncidentSheet({
  shiftId,
  participantId,
  participantName,
  sessionId,
  shiftAddress,
  sourceNoteId,
  sourceNoteContent,
  onFiled,
  onClose,
}: Props) {
  const rpPrefill = sourceNoteContent?.trim()
    ? `Restrictive practice noted during shift session.\n\nSession note:\n${sourceNoteContent.trim()}`
    : "Restrictive practice noted during shift session. ";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: WM.bg }}
      role="dialog"
      aria-modal
      aria-labelledby="wm-incident-title"
    >
      <header
        className="flex shrink-0 items-center gap-3 border-b px-3 py-3"
        style={{ borderColor: WM.border, background: WM.surface }}
      >
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-lg border"
          style={{ borderColor: WM.border }}
          aria-label="Back to session"
        >
          <X size={18} style={{ color: WM.text }} />
        </button>
        <div className="min-w-0 flex-1">
          <p id="wm-incident-title" className="text-[15px] font-semibold" style={{ color: WM.text }}>
            Incident report
          </p>
          <p className="truncate text-[12px]" style={{ color: WM.muted }}>
            Session stays open. Return when done
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
        <div
          className="mb-4 rounded-xl border p-3"
          style={{ borderColor: WM.alertBorder, background: WM.alertBg }}
        >
          <p className="text-[12px] font-semibold" style={{ color: WM.alertText }}>
            Restrictive practice detected
          </p>
          <p className="mt-1 text-[12px] leading-relaxed" style={{ color: WM.alertText }}>
            File this report within 24 hours. Your shift session will remain active.
          </p>
        </div>

        <WorkerIncidentReportForm
          shiftId={shiftId}
          participantId={participantId}
          participantName={participantName}
          sessionId={sessionId}
          shiftAddress={shiftAddress}
          initialReportType="participant_behaviour"
          initialBehaviourSubtype="physical"
          initialSeverity="high"
          initialDescription={rpPrefill}
          initialWorkerActions="Followed participant safety protocol and documented the incident."
          onSubmitted={() => onFiled(sourceNoteId)}
          onCancel={onClose}
          variant="mobile"
        />
      </div>
    </div>
  );
}
