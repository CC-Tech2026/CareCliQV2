import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SignatureCanvas, useSignatureCanvasState } from "@/components/shifts/SignatureCanvas";
import { submitShiftSignature } from "@/services/complianceService";
import { useToast } from "@/hooks/use-toast";
import { CORAL, MUTED, TEXT } from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const CHECKBOX_KEYS = [
  { key: "tasks" as const, labelKey: "shift.signature.confirmTasks" },
  { key: "safety" as const, labelKey: "shift.signature.confirmSafety" },
  { key: "incidents" as const, labelKey: "shift.signature.confirmIncidents" },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shiftId: string;
  busy?: boolean;
  tutorialDemo?: boolean;
  onSigned: () => void;
};

export function ShiftSignatureModal({ open, onOpenChange, shiftId, busy, tutorialDemo, onSigned }: Props) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const [checks, setChecks] = useState({ tasks: false, safety: false, incidents: false });
  const [submitting, setSubmitting] = useState(false);
  const { signatureSvg, signaturePng, hasStroke, onCanvasChange } = useSignatureCanvasState();

  const allChecked = checks.tasks && checks.safety && checks.incidents;
  const canSign = allChecked && hasStroke && !submitting && !busy;

  async function handleConfirm() {
    if (!canSign) return;
    if (tutorialDemo) {
      const marker = document.createElement("div");
      marker.setAttribute("data-tutorial", "shift-signature-complete");
      marker.className = "pointer-events-none absolute h-[2px] w-[2px] overflow-hidden opacity-0";
      marker.setAttribute("aria-hidden", "true");
      document.body.appendChild(marker);
      onOpenChange(false);
      onSigned();
      return;
    }
    setSubmitting(true);
    try {
      await submitShiftSignature(shiftId, {
        confirm_tasks_accurate: checks.tasks,
        confirm_safety_followed: checks.safety,
        confirm_no_unreported_incidents: checks.incidents,
        signature_svg: signatureSvg,
        signature_png_data_url: signaturePng,
      });
      onSigned();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: translate("shift.signature.saveFailed"),
        description: err instanceof Error ? err.message : translate("shift.signature.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-xl overflow-y-auto gap-4"
        data-tutorial="shift-signature"
        hideCloseButton={tutorialDemo}
        onInteractOutside={(event) => {
          if (tutorialDemo) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (tutorialDemo) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{translate("shift.signature.title")}</DialogTitle>
          <DialogDescription>
            {tutorialDemo
              ? translate("shift.signature.tutorialDesc")
              : translate("shift.signature.desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {CHECKBOX_KEYS.map((item) => (
            <label
              key={item.key}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-cc-border bg-cc-surface p-3"
            >
              <Checkbox
                checked={checks[item.key]}
                onCheckedChange={(v) => setChecks((c) => ({ ...c, [item.key]: v === true }))}
                className="mt-0.5"
              />
              <span className="text-sm font-semibold leading-snug" style={{ color: TEXT }}>
                {translate(item.labelKey)}
              </span>
            </label>
          ))}
        </div>

        <div className={allChecked ? "" : "pointer-events-none opacity-40"}>
          <p className="mb-2 text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>
            {translate("shift.signature.yourSignature")}
          </p>
          <SignatureCanvas minWidth={150} minHeight={60} onChange={onCanvasChange} />
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            type="button"
            className="h-11 w-full rounded-xl font-bold text-white"
            style={{ background: CORAL }}
            disabled={!canSign}
            onClick={() => void handleConfirm()}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : translate("shift.signature.confirm")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-10 w-full rounded-xl text-sm font-bold"
            style={{ color: MUTED }}
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            {translate("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
