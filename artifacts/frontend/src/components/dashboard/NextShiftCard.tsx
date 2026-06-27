import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { MapPin, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BORDER, MUTED, PLUM, SOFT, TEXT, formatShiftTimeRange, shiftInitials } from "@/lib/shift-utils";
import {
  getWorkerLandingTravelTime,
  type DashboardShiftSummary,
  type TravelTimeEstimate,
} from "@/services/dashboardService";

type Props = {
  shift: DashboardShiftSummary | null;
};

const TRAVEL_REFRESH_MS = 60_000;

export function NextShiftCard({ shift }: Props) {
  const [travel, setTravel] = useState<TravelTimeEstimate | null>(null);
  const [geoDenied, setGeoDenied] = useState(false);
  const [loadingTravel, setLoadingTravel] = useState(false);
  const originRef = useRef<{ lat: number; lng: number } | undefined>(undefined);

  useEffect(() => {
    if (!shift?.id || !shift.participant_address) {
      setTravel(null);
      return;
    }

    let cancelled = false;

    const loadTravel = (origin?: { lat: number; lng: number }, showSpinner = true) => {
      if (origin) originRef.current = origin;
      if (showSpinner) setLoadingTravel(true);
      void getWorkerLandingTravelTime(shift.id, origin ?? originRef.current)
        .then((result) => {
          if (!cancelled) setTravel(result);
        })
        .catch(() => {
          if (!cancelled) setTravel(null);
        })
        .finally(() => {
          if (!cancelled) setLoadingTravel(false);
        });
    };

    const refreshTravel = () => loadTravel(undefined, false);

    if (!navigator.geolocation) {
      loadTravel();
      const interval = window.setInterval(refreshTravel, TRAVEL_REFRESH_MS);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => loadTravel({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        setGeoDenied(true);
        loadTravel();
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120_000 },
    );

    const interval = window.setInterval(refreshTravel, TRAVEL_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [shift?.id, shift?.participant_address]);

  if (!shift) {
    return (
      <section className="rounded-2xl border border-cc-border bg-cc-surface p-5 shadow-sm">
        <h2 className="text-lg font-black" style={{ color: TEXT }}>
          Next Shift
        </h2>
        <p className="mt-3 rounded-xl bg-cc-bg px-4 py-3 text-sm font-medium" style={{ color: MUTED }}>
          No upcoming shifts scheduled.
        </p>
      </section>
    );
  }

  const navigationUrl =
    travel?.navigation_url ||
    (shift.participant_address
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(shift.participant_address)}&travelmode=driving`
      : null);

  return (
    <section className="overflow-hidden rounded-2xl border border-cc-border bg-cc-surface shadow-sm">
      <div className="border-b border-cc-border px-5 py-4" style={{ background: SOFT }}>
        <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: PLUM }}>
          Next Shift
        </p>
        <div className="mt-3 flex items-center gap-3">
          <div
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-black text-white"
            style={{ background: PLUM }}
          >
            {shiftInitials(shift.participant_name)}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-black" style={{ color: TEXT }}>
              {shift.participant_name}
            </h2>
            <p className="text-sm font-semibold" style={{ color: MUTED }}>
              {formatShiftTimeRange(shift.scheduled_start, shift.scheduled_end)}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {shift.participant_address && (
          <div className="flex items-start gap-2 text-sm">
            <MapPin size={16} className="mt-0.5 shrink-0" style={{ color: PLUM }} />
            <p className="font-medium leading-snug" style={{ color: TEXT }}>
              {shift.participant_address}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {loadingTravel && (
            <span className="text-xs font-bold" style={{ color: MUTED }}>
              Calculating travel time...
            </span>
          )}
          {!loadingTravel && travel?.available && travel.duration_text && (
            <span className="rounded-full bg-cc-active px-3 py-1 text-xs font-black" style={{ color: PLUM }}>
              {travel.duration_text} drive
              {travel.distance_text ? ` · ${travel.distance_text}` : ""}
            </span>
          )}
          {!loadingTravel && !travel?.available && geoDenied && (
            <span className="text-xs font-medium" style={{ color: MUTED }}>
              Enable location for travel time estimates.
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {navigationUrl && (
            <a href={navigationUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
              <Button className="w-full gap-2 font-black" style={{ background: PLUM }}>
                <Navigation size={16} />
                Start Navigation
              </Button>
            </a>
          )}
          <Link href={`/my-shifts/${shift.id}?focus=safety`} className="flex-1">
            <Button variant="outline" className="w-full border-cc-border font-black">
              Open Shift
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
