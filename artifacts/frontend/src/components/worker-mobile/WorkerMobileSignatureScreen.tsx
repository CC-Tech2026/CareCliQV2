import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { WM } from "@/lib/worker-mobile-tokens";
import { ShiftSignatureForm } from "@/components/shifts/ShiftSignatureForm";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  shiftId: string;
  participantName: string;
  busy?: boolean;
  tutorialDemo?: boolean;
  onSigned: () => void | Promise<void>;
  onBack: () => void;
};

export function WorkerMobileSignatureScreen({
  shiftId,
  participantName,
  busy,
  tutorialDemo,
  onSigned,
  onBack,
}: Props) {
  const { translate } = useAccessibility();
  const [blocked, setBlocked] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: WM.bg }}
      role="dialog"
      aria-modal
      aria-labelledby="wm-signature-title"
    >
      <header
        className="flex shrink-0 items-center gap-3 border-b px-3 py-3"
        style={{ borderColor: WM.border, background: WM.surface }}
      >
        <button
          type="button"
          onClick={onBack}
          disabled={blocked || busy}
          className="flex h-9 w-9 items-center justify-center rounded-full border disabled:opacity-40"
          style={{ borderColor: WM.border }}
          aria-label="Back to review"
        >
          <ArrowLeft size={17} style={{ color: WM.text }} />
        </button>
        <div className="min-w-0 flex-1">
          <p id="wm-signature-title" className="text-[15px] font-semibold" style={{ color: WM.text }}>
            {translate("shift.signature.title")}
          </p>
          <p className="truncate text-[12px]" style={{ color: WM.muted }}>
            {participantName}
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 py-4">
        <ShiftSignatureForm
          shiftId={shiftId}
          busy={busy}
          tutorialDemo={tutorialDemo}
          variant="mobile"
          onSigned={onSigned}
          onBlockingChange={setBlocked}
        />
      </div>
    </div>
  );
}
