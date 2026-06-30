import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SignatureCanvas, useSignatureCanvasState } from "@/components/shifts/SignatureCanvas";
import { submitShiftSignature } from "@/services/complianceService";
import { useToast } from "@/hooks/use-toast";
import { CORAL, MUTED, TEXT } from "@/lib/shift-utils";
import { WM } from "@/lib/worker-mobile-tokens";
import { cn } from "@/lib/utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const CHECKBOX_KEYS = [
  { key: "tasks" as const, labelKey: "shift.signature.confirmTasks" },
  { key: "safety" as const, labelKey: "shift.signature.confirmSafety" },
  { key: "incidents" as const, labelKey: "shift.signature.confirmIncidents" },
];

type Props = {
  shiftId: string;
  busy?: boolean;
  tutorialDemo?: boolean;
  variant?: "modal" | "mobile";
  onSigned: () => void | Promise<void>;
  onCancel?: () => void;
  onBlockingChange?: (blocked: boolean) => void;
};

export function ShiftSignatureForm({
  shiftId,
  busy,
  tutorialDemo,
  variant = "modal",
  onSigned,
  onCancel,
  onBlockingChange,
}: Props) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const [checks, setChecks] = useState({ tasks: false, safety: false, incidents: false });
  const [submitting, setSubmitting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const { signatureSvg, signaturePng, hasStroke, onCanvasChange } = useSignatureCanvasState();

  const isMobile = variant === "mobile";
  const allChecked = checks.tasks && checks.safety && checks.incidents;
  const isWaiting = submitting || completing;
  const canSign = allChecked && hasStroke && !isWaiting && !busy;

  useEffect(() => {
    onBlockingChange?.(isWaiting);
  }, [isWaiting, onBlockingChange]);

  async function handleConfirm() {
    if (!canSign) return;
    if (tutorialDemo) {
      const marker = document.createElement("div");
      marker.setAttribute("data-tutorial", "shift-signature-complete");
      marker.className = "pointer-events-none absolute h-[2px] w-[2px] overflow-hidden opacity-0";
      marker.setAttribute("aria-hidden", "true");
      document.body.appendChild(marker);
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
      setSubmitting(false);
      setCompleting(true);
      await Promise.resolve(onSigned());
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (/already signed/i.test(message)) {
        setSubmitting(false);
        setCompleting(true);
        await Promise.resolve(onSigned());
        return;
      }
      toast({
        title: translate("shift.signature.saveFailed"),
        description: err instanceof Error ? err.message : translate("shift.signature.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
      setCompleting(false);
    }
  }

  const labelColor = isMobile ? WM.text : TEXT;
  const mutedColor = isMobile ? WM.muted : MUTED;
  const cardBorder = isMobile ? WM.border : undefined;
  const cardBg = isMobile ? WM.surface : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-tutorial="shift-signature">
      {isWaiting && (
        <div
          className={cn(
            "absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-xl px-6 text-center backdrop-blur-sm",
            isMobile ? "" : "bg-cc-surface/95",
          )}
          style={isMobile ? { background: "rgba(15, 18, 28, 0.88)" } : undefined}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <Loader2
            className="h-8 w-8 animate-spin"
            style={{ color: isMobile ? WM.pink : CORAL }}
            aria-hidden
          />
          <p className="text-sm font-bold" style={{ color: labelColor }}>
            {completing ? translate("shift.signature.completing") : translate("shift.signature.confirm")}
          </p>
          {completing && (
            <p className="max-w-xs text-xs font-medium leading-relaxed" style={{ color: mutedColor }}>
              {translate("shift.signature.completingDesc")}
            </p>
          )}
        </div>
      )}
      <p className="text-[13px] leading-relaxed" style={{ color: mutedColor }}>
        {tutorialDemo
          ? translate("shift.signature.tutorialDesc")
          : translate("shift.signature.desc")}
      </p>

      <div className="mt-4 space-y-3">
        {CHECKBOX_KEYS.map((item) => (
          <label
            key={item.key}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border p-3",
              !isMobile && "border-cc-border bg-cc-surface",
            )}
            style={isMobile ? { borderColor: cardBorder, background: cardBg } : undefined}
          >
            <Checkbox
              checked={checks[item.key]}
              onCheckedChange={(v) => setChecks((c) => ({ ...c, [item.key]: v === true }))}
              className="mt-0.5"
            />
            <span className="text-sm font-semibold leading-snug" style={{ color: labelColor }}>
              {translate(item.labelKey)}
            </span>
          </label>
        ))}
      </div>

      <div className={`mt-4 flex min-h-0 flex-1 flex-col ${allChecked ? "" : "pointer-events-none opacity-40"}`}>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: mutedColor }}>
          {translate("shift.signature.yourSignature")}
        </p>
        <SignatureCanvas
          minWidth={isMobile ? 280 : 150}
          minHeight={isMobile ? 120 : 60}
          className={isMobile ? "min-h-[160px]" : undefined}
          onChange={onCanvasChange}
        />
      </div>

      <div className={`mt-4 shrink-0 space-y-2 ${isMobile ? "border-t pt-3" : ""}`} style={isMobile ? { borderColor: WM.border } : undefined}>
        <Button
          type="button"
          className="h-[50px] w-full rounded-xl text-[15px] font-semibold text-white"
          style={{ background: isMobile ? WM.pink : CORAL }}
          disabled={!canSign}
          onClick={() => void handleConfirm()}
        >
          {isWaiting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {completing ? translate("shift.signature.completing") : translate("shift.signature.confirm")}
            </>
          ) : (
            translate("shift.signature.confirm")
          )}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            className="h-10 w-full rounded-xl text-sm font-semibold"
            style={{ color: mutedColor }}
            disabled={isWaiting}
            onClick={onCancel}
          >
            {translate("common.cancel")}
          </Button>
        )}
      </div>
    </div>
  );
}
