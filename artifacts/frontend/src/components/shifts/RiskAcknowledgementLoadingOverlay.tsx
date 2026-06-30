import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  open: boolean;
};

/** Blocks interaction while risk acknowledgement is saving and the UI updates. */
export function RiskAcknowledgementLoadingOverlay({ open }: Props) {
  const { translate } = useAccessibility();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-cc-bg/80 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={translate("shift.acknowledgeSaving")}
    >
      <Loader2 className="h-9 w-9 animate-spin text-cc-plum" aria-hidden />
      <p className="text-sm font-bold text-cc-text">{translate("shift.acknowledgeSaving")}</p>
    </div>
  );
}
