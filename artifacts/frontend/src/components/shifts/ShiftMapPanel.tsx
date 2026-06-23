import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Copy, ExternalLink, Eye, EyeOff, MapPin, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { BORDER, MUTED, PLUM, TEXT, extractGateCode } from "@/lib/shift-utils";
import { getShiftLocation, type ShiftLocationDetails } from "@/services/shiftService";

type Props = {
  shiftId: string;
  address?: string | null;
  location?: ShiftLocationDetails | null;
  open?: boolean;
  onToggle?: () => void;
  className?: string;
};

function mapsSearchUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function mapsDirectionsUrl(address: string, origin?: { lat: number; lng: number }) {
  const dest = encodeURIComponent(address);
  if (origin) {
    return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${dest}&travelmode=driving`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}

function embedMapUrl(address: string) {
  return `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
}

export function ShiftMapPanel({
  shiftId,
  address,
  location: locationProp,
  open = false,
  onToggle,
  className,
}: Props) {
  const { toast } = useToast();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoDenied, setGeoDenied] = useState(false);
  const [gateVisible, setGateVisible] = useState(false);
  const [location, setLocation] = useState<ShiftLocationDetails | null | undefined>(locationProp);

  useEffect(() => {
    if (locationProp) {
      setLocation(locationProp);
      return;
    }
    if (!open) return;
    void getShiftLocation(shiftId)
      .then(setLocation)
      .catch(() => setLocation(null));
  }, [shiftId, locationProp, open]);

  const resolvedAddress = (address || location?.address || "").trim();
  const access = (location?.access_instructions || "").trim();
  const entry = (location?.entry_instructions || "").trim();
  const parking = (location?.visit_notes || "").trim();
  const gateCode = extractGateCode(access);

  const copyGateCode = async () => {
    if (!gateCode) return;
    try {
      await navigator.clipboard.writeText(gateCode);
      toast({ title: "Gate code copied" });
    } catch {
      toast({ title: "Could not copy code", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (!open || !resolvedAddress || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setGeoDenied(true),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120_000 },
    );
  }, [resolvedAddress, open]);

  const directionsUrl = useMemo(
    () => (resolvedAddress ? mapsDirectionsUrl(resolvedAddress, coords ?? undefined) : null),
    [resolvedAddress, coords],
  );

  return (
    <section
      className={cn("overflow-hidden rounded-2xl border bg-white shadow-sm", className)}
      style={{ borderColor: BORDER }}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
        onClick={onToggle}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
            <MapPin size={16} style={{ color: PLUM }} />
            Location
          </span>
          {!open && resolvedAddress && (
            <span className="mt-0.5 block truncate text-xs font-medium" style={{ color: MUTED }}>
              {resolvedAddress}
            </span>
          )}
        </span>
        <ChevronDown size={18} className={cn("shrink-0 transition", open && "rotate-180")} style={{ color: MUTED }} />
      </button>

      {open && (
        <div className="border-t" style={{ borderColor: BORDER }}>
          {!resolvedAddress ? (
            <p className="px-4 py-3 text-sm" style={{ color: MUTED }}>
              No address on file for this shift.
            </p>
          ) : (
            <>
              <div className="border-b px-4 py-3" style={{ borderColor: BORDER }}>
                <p className="text-sm font-bold leading-snug" style={{ color: TEXT }}>
                  {resolvedAddress}
                </p>
                {geoDenied && (
                  <p className="mt-1 text-xs" style={{ color: MUTED }}>
                    Location permission denied — directions use destination only.
                  </p>
                )}
              </div>

              <div className="relative aspect-[16/10] w-full bg-[#F5F3FC]">
                <iframe
                  title="Shift location map"
                  src={embedMapUrl(resolvedAddress)}
                  className="h-full w-full border-0"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>

              <div className="space-y-3 p-4">
                <div className="flex flex-wrap gap-2">
                  {directionsUrl && (
                    <a
                      href={directionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-[140px] flex-1"
                    >
                      <Button
                        type="button"
                        className="h-11 w-full rounded-xl font-bold text-white"
                        style={{ background: PLUM }}
                      >
                        <Navigation size={16} className="mr-2" />
                        Open in Google Maps
                      </Button>
                    </a>
                  )}
                  <a href={mapsSearchUrl(resolvedAddress)} target="_blank" rel="noopener noreferrer">
                    <Button type="button" variant="outline" className="h-11 rounded-xl font-bold">
                      <ExternalLink size={16} className="mr-2" />
                      View
                    </Button>
                  </a>
                </div>

                {access && (
                  <div className="rounded-xl border bg-[#FFFBEB] p-3" style={{ borderColor: "#FDE68A" }}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-black uppercase tracking-wider text-amber-800">Access / gate</p>
                      <div className="flex items-center gap-2">
                        {gateVisible && gateCode && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs font-bold text-amber-900"
                            onClick={() => void copyGateCode()}
                          >
                            <Copy size={14} />
                            Copy code
                          </button>
                        )}
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs font-bold text-amber-900"
                          onClick={() => setGateVisible((v) => !v)}
                        >
                          {gateVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                          {gateVisible ? "Hide" : "Reveal"}
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-amber-950">
                      {gateVisible ? access : "•••••••• (tap Reveal)"}
                    </p>
                  </div>
                )}

                {entry && (
                  <div className="rounded-xl border p-3" style={{ borderColor: BORDER }}>
                    <p className="mb-1 text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                      Entry instructions
                    </p>
                    <p className="whitespace-pre-wrap text-sm" style={{ color: TEXT }}>
                      {entry}
                    </p>
                  </div>
                )}

                {parking && (
                  <div className="rounded-xl border p-3" style={{ borderColor: BORDER }}>
                    <p className="mb-1 text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                      Parking / visit notes
                    </p>
                    <p className="whitespace-pre-wrap text-sm" style={{ color: TEXT }}>
                      {parking}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
