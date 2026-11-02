import { useEffect, useState } from "react";
import { AlertTriangle, CalendarCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ParticipantPortalShell } from "@/components/participant-portal/ParticipantPortalShell";
import { useViewingParticipant } from "@/components/participant-portal/ParticipantPortalContext";
import { usePortalOverview } from "@/components/participant-portal/usePortalOverview";
import { displayName } from "@/components/participant-portal/ProfileAvatar";
import {
  AttentionRow,
  NextVisitCard,
  PlanAndPaperwork,
  PortalGreeting,
  SupportTeam,
  WeekStrip,
} from "@/components/participant-portal/PortalOverviewSections";
import {
  listMyInvoices,
  listMyShifts,
  type ParticipantInvoice,
  type ParticipantShift,
} from "@/services/participantPortalService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const SURFACE = "var(--cc-surface)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const GREEN = "var(--cc-green)";
const AMBER = "#9A5B0A";
const AMBER_SOFT = "#FBF2E6";

function formatShiftDay(value: string) {
  return new Date(value).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

const startOf = (s: ParticipantShift) => new Date(s.scheduled_start).getTime();

/**
 * Participants Portal home (Overview tab): a greeting, the next visit, this
 * week at a glance, the support team, plan and paperwork, and recent visits.
 * The profile itself is the shell's left column (ProfilePanel).
 */
export default function ParticipantOverviewPage() {
  const { user } = useAuth();
  const { participantId, current } = useViewingParticipant();
  const { data, error } = usePortalOverview(participantId);
  // The overview only carries the next three visits; the week view and the
  // overdue-invoice reminder need the full lists.
  const [shifts, setShifts] = useState<ParticipantShift[] | null>(null);
  const [invoices, setInvoices] = useState<ParticipantInvoice[] | null>(null);

  useEffect(() => {
    if (!participantId) return;
    let cancelled = false;
    setShifts(null);
    setInvoices(null);
    listMyShifts(participantId)
      .then((d) => { if (!cancelled) setShifts(d); })
      .catch(() => { if (!cancelled) setShifts([]); });
    listMyInvoices(participantId)
      .then((d) => { if (!cancelled) setInvoices(d); })
      .catch(() => { if (!cancelled) setInvoices([]); });
    return () => { cancelled = true; };
  }, [participantId]);

  if (error) {
    return (
      <ParticipantPortalShell>
        <div className="flex items-center gap-2 rounded-2xl border p-4" style={{ borderColor: AMBER, background: AMBER_SOFT }}>
          <AlertTriangle size={15} style={{ color: AMBER }} className="shrink-0" />
          <p className="text-[14px] font-bold" style={{ color: AMBER }}>{error}</p>
        </div>
      </ParticipantPortalShell>
    );
  }
  if (!data) {
    return (
      <ParticipantPortalShell>
        <div className="space-y-6">
          <div className="h-16 w-2/3 animate-pulse rounded-2xl" style={{ background: SOFT }} />
          <div className="h-48 animate-pulse rounded-2xl" style={{ background: SOFT }} />
          <div className="h-32 animate-pulse rounded-2xl" style={{ background: SOFT }} />
        </div>
      </ParticipantPortalShell>
    );
  }

  const now = Date.now();
  const upcoming = (shifts && shifts.length ? shifts : data.upcoming_shifts)
    .filter((s) => s.status === "in_progress" || (s.status === "scheduled" && new Date(s.scheduled_end).getTime() >= now))
    .sort((a, b) => startOf(a) - startOf(b));
  const next = upcoming[0];
  const isSelf = current?.relationship === "self";
  const participantName = current ? displayName(current) : data.profile.preferred_name || data.profile.full_name;
  const viewerName = isSelf ? participantName : user?.full_name || "";
  // Until the full list arrives, the week view works from the overview's own visits.
  const weekShifts = shifts && shifts.length ? shifts : shifts === null ? null : [...data.upcoming_shifts, ...data.recent_shifts];

  return (
    <ParticipantPortalShell>
      <div className="space-y-7 sm:space-y-8">
        <PortalGreeting viewerName={viewerName} participantName={participantName} isSelf={isSelf} next={next} />
        <AttentionRow invoices={invoices} />
        <NextVisitCard next={next} moreCount={Math.max(0, upcoming.length - 1)} team={data.support_team} />
        <WeekStrip shifts={weekShifts} />

        <div className="grid gap-7 sm:gap-8 xl:grid-cols-2">
          <SupportTeam team={data.support_team} upcoming={upcoming} />
          <PlanAndPaperwork pinned={data.pinned} />
        </div>

        <section>
          <h2 className="mb-3 text-[17px] font-black" style={{ color: TEXT }}>Recent visits</h2>
          {data.recent_shifts.length === 0 ? (
            <p className="rounded-2xl border p-5 text-[14px]" style={{ background: SURFACE, borderColor: BORDER, color: MUTED }}>
              Completed visits will appear here.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--cc-border)] rounded-2xl border" style={{ background: SURFACE, borderColor: BORDER }}>
              {data.recent_shifts.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                  <CalendarCheck size={18} style={{ color: GREEN }} className="shrink-0" />
                  <span className="min-w-0 flex-1 text-[14px]" style={{ color: TEXT }}>
                    <span className="block font-bold sm:inline">{formatShiftDay(s.scheduled_start)}</span>
                    <span className="hidden sm:inline" style={{ color: MUTED }}> · </span>
                    <span style={{ color: MUTED }}>{formatTime(s.scheduled_start)}–{formatTime(s.scheduled_end)}</span>
                  </span>
                  {s.worker_name && (
                    <span className="max-w-[45%] shrink-0 truncate text-[13px] font-semibold" style={{ color: MUTED }}>{s.worker_name}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </ParticipantPortalShell>
  );
}
