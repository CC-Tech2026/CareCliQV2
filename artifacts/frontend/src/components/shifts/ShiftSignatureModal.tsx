import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { ShiftSignatureForm } from "@/components/shifts/ShiftSignatureForm";
import { unlockPageInteraction } from "@/lib/unlock-page-interaction";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shiftId: string;
  busy?: boolean;
  tutorialDemo?: boolean;
  onSigned: () => void | Promise<void>;
};

export function ShiftSignatureModal({ open, onOpenChange, shiftId, busy, tutorialDemo, onSigned }: Props) {
  const { translate } = useAccessibility();
  const [blocked, setBlocked] = useState(false);
  const interactionLocked = blocked || busy;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !tutorialDemo && !interactionLocked) onOpenChange(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
      unlockPageInteraction();
    };
  }, [open, onOpenChange, tutorialDemo, interactionLocked]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shift-signature-title"
      data-tutorial="shift-signature"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/80"
        aria-label="Close"
        onClick={() => {
          if (!tutorialDemo && !interactionLocked) onOpenChange(false);
        }}
      />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-xl flex-col gap-4 overflow-hidden rounded-lg border border-cc-border bg-card p-6 text-cc-text shadow-lg">
        {!tutorialDemo && (
          <button
            type="button"
            className="absolute right-4 top-4 z-10 rounded-sm opacity-70 transition hover:opacity-100 disabled:pointer-events-none disabled:opacity-30"
            onClick={() => onOpenChange(false)}
            disabled={interactionLocked}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <div className="space-y-1.5 text-center sm:text-left">
          <h2 id="shift-signature-title" className="text-lg font-semibold leading-none tracking-tight">
            {translate("shift.signature.title")}
          </h2>
          <p className="sr-only">{translate("shift.signature.desc")}</p>
        </div>

        <ShiftSignatureForm
          shiftId={shiftId}
          busy={busy}
          tutorialDemo={tutorialDemo}
          variant="modal"
          onSigned={onSigned}
          onBlockingChange={setBlocked}
          onCancel={() => onOpenChange(false)}
        />
      </div>
    </div>,
    document.body,
  );
}
