import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  open: boolean;
  onClose: () => void;
  onScan: (token: string) => void;
  onError?: (message: string) => void;
};

const SCANNER_ID = "clock-in-qr-scanner";

export function ClockInQrScanner({ open, onClose, onScan, onError }: Props) {
  const { translate } = useAccessibility();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [starting, setStarting] = useState(false);

  const friendlyCameraError = (err: unknown): string => {
    const message = (err as Error)?.message?.toLowerCase() ?? "";
    if (
      message.includes("notallowed") ||
      message.includes("permission") ||
      message.includes("denied")
    ) {
      return translate("shift.qr.cameraDenied");
    }
    if (message.includes("notfound") || message.includes("no camera")) {
      return translate("shift.qr.noCamera");
    }
    return translate("shift.qr.startFailed");
  };

  useEffect(() => {
    if (!open) {
      void scannerRef.current?.stop().catch(() => undefined);
      scannerRef.current = null;
      return;
    }

    let cancelled = false;
    setStarting(true);

    const start = async () => {
      try {
        const scanner = new Html5Qrcode(SCANNER_ID);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            onScan(decoded);
            void scanner.stop().catch(() => undefined);
            scannerRef.current = null;
            onClose();
          },
          () => undefined,
        );
        if (!cancelled) setStarting(false);
      } catch (err) {
        if (!cancelled) {
          const message = friendlyCameraError(err);
          onError?.(message);
          onClose();
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      void scannerRef.current?.stop().catch(() => undefined);
      scannerRef.current = null;
    };
  }, [open, onClose, onScan, onError, translate]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black p-4">
      <div className="mb-3 flex items-center justify-between text-white">
        <h2 className="text-sm font-black uppercase tracking-wide">{translate("shift.qr.title")}</h2>
        <Button type="button" variant="ghost" size="icon" className="text-white hover:bg-cc-bg/10" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>
      <div className="relative mx-auto w-full max-w-sm flex-1 overflow-hidden rounded-2xl bg-black">
        <div id={SCANNER_ID} className="h-full w-full min-h-[280px]" />
        {starting && (
          <div className="absolute inset-0 grid place-items-center bg-black/60">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
          </div>
        )}
      </div>
      <p className="mt-4 text-center text-sm text-white/80">
        {translate("shift.qr.hint")}
      </p>
    </div>
  );
}
