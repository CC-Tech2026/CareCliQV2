import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onClose: () => void;
  onScan: (token: string) => void;
  onError?: (message: string) => void;
};

const SCANNER_ID = "clock-in-qr-scanner";

function friendlyCameraError(err: unknown): string {
  const message = (err as Error)?.message?.toLowerCase() ?? "";
  if (
    message.includes("notallowed") ||
    message.includes("permission") ||
    message.includes("denied")
  ) {
    return "Camera permission denied.";
  }
  if (message.includes("notfound") || message.includes("no camera")) {
    return "No camera found on this device.";
  }
  return "Could not start the camera.";
}

export function ClockInQrScanner({ open, onClose, onScan, onError }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [starting, setStarting] = useState(false);

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
  }, [open, onClose, onScan, onError]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black p-4">
      <div className="mb-3 flex items-center justify-between text-white">
        <h2 className="text-sm font-black uppercase tracking-wide">Scan location QR</h2>
        <Button type="button" variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={onClose}>
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
        Point your camera at the QR code posted at the participant&apos;s location.
      </p>
    </div>
  );
}
