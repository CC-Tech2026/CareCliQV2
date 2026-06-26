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

const CHECKBOXES = [
  { key: "tasks" as const, label: "I confirm all tasks have been documented accurately." },
  { key: "safety" as const, label: "I confirm participant safety protocols were followed throughout this shift." },
  { key: "incidents" as const, label: "I confirm no incidents occurred that have not been reported." },
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
  const { toast } = useToast();
  const [checks, setChecks] = useState({ tasks: false, safety: false, incidents: false });
  const [submitting, setSubmitting] = useState(false);
  const { signatureSvg, signaturePng, hasStroke, onCanvasChange } = useSignatureCanvasState();

  const allChecked = checks.tasks && checks.safety && checks.incidents;
  const canSign = allChecked && hasStroke && !submitting && !busy;

  async function handleConfirm() {
    if (!canSign) return;
    if (tutorialDemo) {
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
        title: "Could not save signature",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto gap-4" data-tutorial="shift-signature">
        <DialogHeader>
          <DialogTitle>Sign off shift</DialogTitle>
          <DialogDescription>
            {tutorialDemo
              ? "Tutorial preview — confirm each statement and sign to complete a shift in the real app."
              : "Confirm the statements below and sign to complete your shift certification."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {CHECKBOXES.map((item) => (
            <label
              key={item.key}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#E2DEF2] bg-white p-3"
            >
              <Checkbox
                checked={checks[item.key]}
                onCheckedChange={(v) => setChecks((c) => ({ ...c, [item.key]: v === true }))}
                className="mt-0.5"
              />
              <span className="text-sm font-semibold leading-snug" style={{ color: TEXT }}>
                {item.label}
              </span>
            </label>
          ))}
        </div>

        <div className={allChecked ? "" : "pointer-events-none opacity-40"}>
          <p className="mb-2 text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>
            Your signature
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
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm signature"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-10 w-full rounded-xl text-sm font-bold"
            style={{ color: MUTED }}
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
