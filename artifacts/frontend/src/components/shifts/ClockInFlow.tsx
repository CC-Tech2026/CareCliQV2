import { useEffect, useMemo, useState } from "react";
import { Loader2, MapPin, QrCode, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClockInQrScanner } from "@/components/shifts/ClockInQrScanner";
import type { ClockInRequest, WorkerShift } from "@/services/shiftService";
import { reverseGeocode } from "@/lib/reverse-geocode";
import { cn } from "@/lib/utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  open: boolean;
  shift: WorkerShift;
  busy?: boolean;
  tutorialDemo?: boolean;
  onClose: () => void;
  onConfirm: (payload: ClockInRequest) => Promise<void>;
};

type Step = "choose" | "capturing" | "confirm";

async function cameraPermissionState(): Promise<PermissionState | "unsupported"> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "unsupported";
  }
  try {
    const status = await navigator.permissions.query({ name: "camera" as PermissionName });
    return status.state;
  } catch {
    return "prompt";
  }
}

export function ClockInFlow({ open, shift, busy, tutorialDemo, onClose, onConfirm }: Props) {
  const { translate, translateParams } = useAccessibility();
  const [step, setStep] = useState<Step>("choose");
  const [method, setMethod] = useState<"gps" | "qr" | null>(null);
  const [location, setLocation] = useState<ClockInRequest["location"]>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [manualQrOpen, setManualQrOpen] = useState(false);
  const [manualQrValue, setManualQrValue] = useState("");
  const [locationAddress, setLocationAddress] = useState<string | null>(null);
  const [resolvingAddress, setResolvingAddress] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep("choose");
      setMethod(null);
      setLocation(null);
      setLocationAddress(null);
      setResolvingAddress(false);
      setQrToken(null);
      setCaptureError(null);
      setScannerOpen(false);
      setManualQrOpen(false);
      setManualQrValue("");
    }
  }, [open]);

  const nowLabel = useMemo(() => new Date().toLocaleString(), [step, open]);

  const yourLocationLabel = useMemo(() => {
    if (method === "qr") return translate("clockin.qrVerified");
    if (location) {
      return `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}${
        location.accuracy ? ` (±${Math.round(location.accuracy)}m)` : ""
      }`;
    }
    return null;
  }, [location, method, translate]);

  const startGps = async () => {
    setMethod("gps");
    setStep("capturing");
    setCaptureError(null);
    setManualQrOpen(false);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setCaptureError(translate("clockin.geoUnsupported"));
      setStep("choose");
      return;
    }
    const coords = await new Promise<ClockInRequest["location"]>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        (err) => {
          setCaptureError(
            err.code === err.PERMISSION_DENIED
              ? translate("clockin.geoDenied")
              : translate("clockin.geoFailed"),
          );
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });
    if (!coords) {
      setStep("choose");
      return;
    }
    setLocation(coords);
    setLocationAddress(null);
    setResolvingAddress(true);
    setStep("confirm");
    void reverseGeocode(coords.lat, coords.lng).then((address) => {
      setLocationAddress(address);
      setResolvingAddress(false);
    });
  };

  const startQr = async () => {
    setMethod("qr");
    setCaptureError(null);
    setManualQrOpen(false);

    const permission = await cameraPermissionState();
    if (permission === "denied") {
      setCaptureError(translate("clockin.cameraDenied"));
      setManualQrOpen(true);
      return;
    }
    if (permission === "unsupported") {
      setCaptureError(translate("clockin.cameraUnsupported"));
      setManualQrOpen(true);
      return;
    }

    setScannerOpen(true);
  };

  const handleQrScan = (token: string) => {
    setQrToken(token.trim());
    setScannerOpen(false);
    setStep("confirm");
    setCaptureError(null);
  };

  const handleScannerError = (message: string) => {
    setScannerOpen(false);
    setCaptureError(`${message} ${translate("clockin.scannerErrorHint")}`);
    setManualQrOpen(true);
  };

  const submitManualQr = () => {
    const token = manualQrValue.trim();
    if (!token) {
      setCaptureError(translate("clockin.manualQrRequired"));
      return;
    }
    setMethod("qr");
    setQrToken(token);
    setCaptureError(null);
    setStep("confirm");
  };

  const handleConfirm = async () => {
    if (!method) return;
    const payload: ClockInRequest = {
      method,
      client_timestamp: new Date().toISOString(),
    };
    if (method === "gps" && location) payload.location = location;
    if (method === "qr" && qrToken) payload.qr_token = qrToken;
    await onConfirm(payload);
  };

  const participantName = shift.participant_name ?? translate("common.participant");

  return (
    <>
      <Dialog open={open && !scannerOpen} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="max-w-md rounded-2xl" data-tutorial="clock-in-modal">
          <DialogHeader>
            <DialogTitle className="text-[#1A1A2E]">{translate("clockin.title")}</DialogTitle>
            <DialogDescription>
              {tutorialDemo
                ? translate("clockin.tutorial")
                : translateParams("clockin.verify", { name: participantName })}
            </DialogDescription>
          </DialogHeader>

          {step === "choose" && (
            <div className="grid gap-3 py-2">
              <button
                type="button"
                className="flex items-center gap-3 rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-left transition hover:border-amber-300"
                onClick={() => void startGps()}
              >
                <MapPin className="h-6 w-6 shrink-0 text-amber-600" />
                <div>
                  <p className="font-black text-[#1A1A2E]">{translate("clockin.useGps")}</p>
                  <p className="text-xs text-muted-foreground">{translate("clockin.gpsHint")}</p>
                </div>
              </button>
              <button
                type="button"
                className="flex items-center gap-3 rounded-xl border-2 border-violet-200 bg-violet-50 p-4 text-left transition hover:border-violet-300"
                onClick={() => void startQr()}
              >
                <QrCode className="h-6 w-6 shrink-0 text-violet-600" />
                <div>
                  <p className="font-black text-[#1A1A2E]">{translate("clockin.scanQr")}</p>
                  <p className="text-xs text-muted-foreground">{translate("clockin.qrHint")}</p>
                </div>
              </button>

              {captureError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {captureError}
                </div>
              )}

              {(manualQrOpen || captureError) && (
                <div className="space-y-2 rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-violet-700">
                    {translate("clockin.manualQr")}
                  </p>
                  <Input
                    value={manualQrValue}
                    onChange={(e) => setManualQrValue(e.target.value)}
                    placeholder={translate("clockin.manualQrPlaceholder")}
                    className="bg-white"
                  />
                  <Button type="button" variant="outline" className="w-full" onClick={submitManualQr}>
                    {translate("clockin.continueCode")}
                  </Button>
                </div>
              )}

              {!manualQrOpen && !captureError && (
                <button
                  type="button"
                  className="text-center text-xs font-semibold text-violet-700 underline-offset-2 hover:underline"
                  onClick={() => setManualQrOpen(true)}
                >
                  {translate("clockin.manualInstead")}
                </button>
              )}
            </div>
          )}

          {step === "capturing" && (
            <div className="grid place-items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
              <p className="text-sm font-semibold text-muted-foreground">{translate("clockin.capturing")}</p>
            </div>
          )}

          {step === "confirm" && method && (
            <div className="space-y-3 py-2">
              <div className="rounded-xl border bg-slate-50 p-4 text-sm">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div className="space-y-2">
                    <p>
                      <span className="font-bold text-[#1A1A2E]">{translate("clockin.dateTime")} </span>
                      {nowLabel}
                    </p>
                    <p>
                      <span className="font-bold text-[#1A1A2E]">{translate("clockin.method")} </span>
                      {method === "gps" ? translate("clockin.methodGps") : translate("clockin.methodQr")}
                    </p>
                    {(yourLocationLabel || resolvingAddress) && (
                      <div>
                        <p>
                          <span className="font-bold text-[#1A1A2E]">{translate("clockin.yourLocation")}: </span>
                          {method === "gps" && locationAddress
                            ? locationAddress
                            : yourLocationLabel ?? translate("clockin.lookingUpAddress")}
                        </p>
                        {method === "gps" && locationAddress && yourLocationLabel && (
                          <p className="text-xs text-muted-foreground">{yourLocationLabel}</p>
                        )}
                        {method === "gps" && resolvingAddress && !locationAddress && (
                          <p className="text-xs text-muted-foreground">{translate("clockin.lookingUpAddress")}</p>
                        )}
                      </div>
                    )}
                    {shift.participant_address && (
                      <p>
                        <span className="font-bold text-[#1A1A2E]">{translate("clockin.shiftAddress")} </span>
                        {shift.participant_address}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className={cn(step === "choose" && "hidden")}>
            {step === "confirm" && (
              <>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setStep("choose")}>
                  {translate("common.back")}
                </Button>
                <Button
                  type="button"
                  className="bg-gradient-to-r from-amber-500 to-orange-500 font-black text-white"
                  disabled={busy}
                  onClick={() => void handleConfirm()}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : translate("clockin.confirm")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClockInQrScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleQrScan}
        onError={handleScannerError}
      />
    </>
  );
}
