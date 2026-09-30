import { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, Clock, User } from "lucide-react";
import { ParticipantPortalShell } from "@/components/participant-portal/ParticipantPortalShell";
import { useViewingParticipant } from "@/components/participant-portal/ParticipantPortalContext";
import { listMyShifts, type ParticipantShift } from "@/services/participantPortalService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";
const AMBER = "#9A5B0A";
const AMBER_SOFT = "#FBF2E6";

const STATUS_LABEL: Record<ParticipantShift["status"], string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ParticipantSchedulePage() {
  const { participantId } = useViewingParticipant();
  const [shifts, setShifts] = useState<ParticipantShift[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!participantId) return;
    let cancelled = false;
    setShifts(null);
    setLoadError(null);
    listMyShifts(participantId)
      .then((data) => { if (!cancelled) setShifts(data); })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Could not load your schedule.");
        setShifts([]);
      });
    return () => { cancelled = true; };
  }, [participantId]);

  const now = Date.now();
  const upcoming = (shifts ?? []).filter((s) => new Date(s.scheduled_start).getTime() >= now);
  const past = (shifts ?? []).filter((s) => new Date(s.scheduled_start).getTime() < now);

  return (
    <ParticipantPortalShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black" style={{ color: TEXT }}>Support Schedule</h1>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>Upcoming and past support sessions with your support team.</p>
        </div>

        {loadError && (
          <div className="flex items-center gap-2 rounded-2xl border p-4" style={{ borderColor: AMBER, background: AMBER_SOFT }}>
            <AlertTriangle size={15} style={{ color: AMBER }} className="shrink-0" />
            <p className="text-[12px] font-bold" style={{ color: AMBER }}>Couldn't load your schedule: {loadError}</p>
          </div>
        )}

        <ShiftSection title="Upcoming" shifts={upcoming} loading={shifts === null} emptyLabel="No upcoming shifts scheduled yet." />
        <ShiftSection title="Past" shifts={past} loading={shifts === null} emptyLabel="No past shifts yet." />
      </div>
    </ParticipantPortalShell>
  );
}

function ShiftSection({ title, shifts, loading, emptyLabel }: { title: string; shifts: ParticipantShift[]; loading: boolean; emptyLabel: string }) {
  return (
    <div className="rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
      <div className="flex items-center gap-1.5 border-b px-5 py-3.5" style={{ borderColor: BORDER }}>
        <CalendarDays size={13} style={{ color: MUTED }} />
        <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>{title}</p>
      </div>
      <div className="divide-y" style={{ borderColor: BORDER }}>
        {loading ? (
          <div className="p-5">
            <div className="h-10 animate-pulse rounded-lg" style={{ background: "var(--cc-soft)" }} />
          </div>
        ) : shifts.length === 0 ? (
          <p className="p-5 text-center text-[12px] font-medium" style={{ color: MUTED }}>{emptyLabel}</p>
        ) : (
          shifts.map((shift) => (
            <div key={shift.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--cc-plum-soft)" }}>
                  <Clock size={13} style={{ color: PLUM }} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-bold" style={{ color: TEXT }}>{formatDateTime(shift.scheduled_start)}</p>
                  {shift.worker_name && (
                    <p className="flex items-center gap-1 text-[10px]" style={{ color: MUTED }}>
                      <User size={10} /> {shift.worker_name}
                    </p>
                  )}
                </div>
              </div>
              <span className="shrink-0 text-[11px] font-semibold" style={{ color: MUTED }}>{STATUS_LABEL[shift.status]}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
