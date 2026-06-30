import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
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

      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 py-4">
        <ShiftSignatureForm
          shiftId={shiftId}
          busy={busy}
          tutorialDemo={tutorialDemo}
          variant="mobile"
          onSigned={onSigned}
          onBlockingChange={setBlocked}
        />
      </div>

      {(busy || blocked) && (
        <div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 px-6 text-center"
          style={{ background: "rgba(15, 18, 28, 0.88)" }}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: WM.pink }} aria-hidden />
          <p className="text-sm font-bold" style={{ color: WM.text }}>
            {translate("shift.signature.completing")}
          </p>
          <p className="max-w-xs text-xs font-medium leading-relaxed" style={{ color: WM.muted }}>
            {translate("shift.signature.completingDesc")}
          </p>
        </div>
      )}
    </div>
  );
}
