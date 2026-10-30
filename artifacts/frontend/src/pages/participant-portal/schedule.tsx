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

// Tints are translucent so the pills read on light and dark surfaces.
const STATUS: Record<ParticipantShift["status"], { label: string; color: string; tint: string }> = {
  scheduled: { label: "Scheduled", color: MUTED, tint: "var(--cc-soft)" },
  in_progress: { label: "Happening now", color: PLUM, tint: "var(--cc-plum-soft)" },
  completed: { label: "Completed", color: "var(--cc-green)", tint: "rgba(22, 101, 52, 0.10)" },
  cancelled: { label: "Cancelled", color: AMBER, tint: "rgba(154, 91, 10, 0.10)" },
};

function formatDay(value: string) {
  return new Date(value).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

const startOf = (s: ParticipantShift) => new Date(s.scheduled_start).getTime();

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
  // A visit stays "upcoming" until it ends, so one that's under way isn't
  // filed as past. Soonest first for what's coming up; most recent first for what's done.
  const isAhead = (s: ParticipantShift) => s.status === "in_progress" || new Date(s.scheduled_end).getTime() >= now;
  const upcoming = (shifts ?? []).filter(isAhead).sort((a, b) => startOf(a) - startOf(b));
  const past = (shifts ?? []).filter((s) => !isAhead(s)).sort((a, b) => startOf(b) - startOf(a));

  return (
    <ParticipantPortalShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>Support Schedule</h1>
          <p className="mt-1 text-[14px]" style={{ color: MUTED }}>When your support team is coming, and the visits that have already happened.</p>
        </div>

        {loadError && (
          <div className="flex items-center gap-2 rounded-2xl border p-4" style={{ borderColor: AMBER, background: AMBER_SOFT }}>
            <AlertTriangle size={15} style={{ color: AMBER }} className="shrink-0" />
            <p className="text-[13px] font-bold" style={{ color: AMBER }}>Couldn't load your schedule: {loadError}</p>
          </div>
        )}

        <ShiftSection title="Upcoming" shifts={upcoming} loading={shifts === null} emptyLabel="No upcoming support scheduled yet." />
        <ShiftSection title="Past" shifts={past} loading={shifts === null} emptyLabel="Completed support sessions will appear here." />
      </div>
    </ParticipantPortalShell>
  );
}

function ShiftSection({ title, shifts, loading, emptyLabel }: { title: string; shifts: ParticipantShift[]; loading: boolean; emptyLabel: string }) {
  return (
    <section className="rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
      <h2 className="flex items-center gap-2 border-b px-5 py-3.5 text-[15px] font-black" style={{ borderColor: BORDER, color: TEXT }}>
        <CalendarDays size={16} style={{ color: MUTED }} />
        {title}
        {!loading && shifts.length > 0 && <span className="text-[13px] font-semibold" style={{ color: MUTED }}>{shifts.length}</span>}
      </h2>
      <ul className="divide-y divide-[var(--cc-border)]">
        {loading ? (
          <li className="p-5">
            <div className="h-10 animate-pulse rounded-lg" style={{ background: "var(--cc-soft)" }} />
          </li>
        ) : shifts.length === 0 ? (
          <li className="p-6 text-center text-[14px]" style={{ color: MUTED }}>{emptyLabel}</li>
        ) : (
          shifts.map((shift) => {
            const status = STATUS[shift.status];
            const cancelled = shift.status === "cancelled";
            const ahead = shift.status === "scheduled" || shift.status === "in_progress";
            return (
              <li key={shift.id} className="flex items-center justify-between gap-3 px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                  <Clock size={18} className="mt-0.5 shrink-0" style={{ color: ahead ? PLUM : MUTED }} />
                  <div className="min-w-0">
                    <p className={`text-[15px] font-bold ${cancelled ? "line-through" : ""}`} style={{ color: TEXT }}>
                      {formatDay(shift.scheduled_start)}
                    </p>
                    <p className="text-[14px]" style={{ color: MUTED }}>
                      {formatTime(shift.scheduled_start)} to {formatTime(shift.scheduled_end)}
                    </p>
                    {shift.worker_name && (
                      <p className="mt-0.5 flex items-center gap-1.5 text-[13px]" style={{ color: MUTED }}>
                        <User size={14} /> {shift.worker_name}
                      </p>
                    )}
                  </div>
                </div>
                <span className="shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-bold" style={{ background: status.tint, color: status.color }}>
                  {status.label}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
