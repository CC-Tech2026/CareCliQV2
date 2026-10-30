import { Link } from "wouter";
import { AlertTriangle, ArrowRight, CalendarCheck, CalendarDays, FileSignature, NotebookTabs } from "lucide-react";
import { ParticipantPortalShell } from "@/components/participant-portal/ParticipantPortalShell";
import { useViewingParticipant } from "@/components/participant-portal/ParticipantPortalContext";
import { usePortalOverview } from "@/components/participant-portal/usePortalOverview";
import type { ParticipantShift } from "@/services/participantPortalService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const SURFACE = "var(--cc-surface)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const GREEN = "var(--cc-green)";
const AMBER = "#9A5B0A";
const AMBER_SOFT = "#FBF2E6";

function formatDate(value?: string | null) {
  if (!value) return undefined;
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

/** "Today" / "Tomorrow" for the next two days, else "Sat, 31 Oct". */
function formatShiftDay(value: string) {
  const date = new Date(value);
  const days = Math.round((new Date(date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[16px] font-black" style={{ color: TEXT }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function ShiftLine({ shift, done }: { shift: ParticipantShift; done?: boolean }) {
  const Icon = done ? CalendarCheck : CalendarDays;
  return (
    <li className="flex items-center gap-3 px-4 py-3.5">
      <Icon size={18} style={{ color: done ? GREEN : PLUM }} className="shrink-0" />
      <span className="min-w-0 flex-1 text-[14px]" style={{ color: TEXT }}>
        <span className="block font-bold sm:inline">{formatShiftDay(shift.scheduled_start)}</span>
        <span className="hidden sm:inline" style={{ color: MUTED }}> · </span>
        <span style={{ color: MUTED }}>{formatTime(shift.scheduled_start)}–{formatTime(shift.scheduled_end)}</span>
      </span>
      {shift.worker_name && (
        <span className="max-w-[45%] shrink-0 truncate text-[13px] font-semibold" style={{ color: MUTED }}>{shift.worker_name}</span>
      )}
    </li>
  );
}

function ShiftList({ children }: { children: React.ReactNode }) {
  return (
    <ul className="divide-y divide-[var(--cc-border)] rounded-2xl border" style={{ background: SURFACE, borderColor: BORDER }}>
      {children}
    </ul>
  );
}

function PinnedCard({
  href,
  title,
  subtitle,
  icon: Icon,
  available,
}: {
  href: string;
  title: string;
  subtitle: string;
  icon: typeof FileSignature;
  available: boolean;
}) {
  const body = (
    <>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: available ? "var(--cc-plum-soft)" : SOFT }}>
        <Icon size={20} style={{ color: available ? PLUM : MUTED }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-black" style={{ color: TEXT }}>{title}</span>
        <span className="block text-[13px]" style={{ color: MUTED }}>{subtitle}</span>
      </span>
      {available && <ArrowRight size={16} className="shrink-0" style={{ color: PLUM }} />}
    </>
  );
  const className = "flex items-center gap-3 rounded-2xl border p-4";
  return available ? (
    <Link
      href={href}
      className={`${className} outline-none transition-colors hover:bg-[var(--cc-soft)] focus-visible:ring-2`}
      style={{ background: SURFACE, borderColor: BORDER }}
    >
      {body}
    </Link>
  ) : (
    <div aria-disabled="true" className={className} style={{ background: SURFACE, borderColor: BORDER }}>
      {body}
    </div>
  );
}

/**
 * Participants Portal home (Overview tab): upcoming support, pinned
 * documents and recent support. The profile itself is the shell's left
 * column (ProfilePanel), shown on every tab.
 */
export default function ParticipantOverviewPage() {
  const { participantId } = useViewingParticipant();
  const { data, error } = usePortalOverview(participantId);

  return (
    <ParticipantPortalShell>
      {error ? (
        <div className="flex items-center gap-2 rounded-2xl border p-4" style={{ borderColor: AMBER, background: AMBER_SOFT }}>
          <AlertTriangle size={15} style={{ color: AMBER }} className="shrink-0" />
          <p className="text-[13px] font-bold" style={{ color: AMBER }}>{error}</p>
        </div>
      ) : !data ? (
        <div className="h-96 animate-pulse rounded-2xl" style={{ background: SOFT }} />
      ) : (
        <div className="space-y-8">
          <Card
            title="Upcoming support"
            action={
              <Link href="/participant-portal/schedule" className="flex items-center gap-1 text-[13px] font-bold" style={{ color: PLUM }}>
                Show all <ArrowRight size={14} />
              </Link>
            }
          >
            {data.upcoming_shifts.length === 0 ? (
              <p className="rounded-2xl border px-4 py-6 text-center text-[14px]" style={{ background: SURFACE, borderColor: BORDER, color: MUTED }}>
                No upcoming support scheduled yet.
              </p>
            ) : (
              <ShiftList>
                {data.upcoming_shifts.map((s) => <ShiftLine key={s.id} shift={s} />)}
              </ShiftList>
            )}
          </Card>

          <Card title="Pinned documents">
            <div className="grid gap-3 sm:grid-cols-2">
              <PinnedCard
                href="/participant-portal/documents"
                title="Service Agreement"
                subtitle={
                  data.pinned.service_agreement.available
                    ? `Signed ${formatDate(data.pinned.service_agreement.updated_at) ?? ""}`
                    : "Not available yet"
                }
                icon={FileSignature}
                available={data.pinned.service_agreement.available}
              />
              <PinnedCard
                href="/participant-portal/plan"
                title="NDIS Plan"
                subtitle={
                  data.pinned.ndis_plan.available
                    ? `${formatDate(data.pinned.ndis_plan.plan_start) ?? "N/A"} to ${formatDate(data.pinned.ndis_plan.plan_end) ?? "N/A"}`
                    : "Not available yet"
                }
                icon={NotebookTabs}
                available={data.pinned.ndis_plan.available}
              />
            </div>
          </Card>

          <Card title="Recent support">
            {data.recent_shifts.length === 0 ? (
              <p className="text-[14px]" style={{ color: MUTED }}>Completed support sessions will appear here.</p>
            ) : (
              <ShiftList>
                {data.recent_shifts.map((s) => <ShiftLine key={s.id} shift={s} done />)}
              </ShiftList>
            )}
          </Card>
        </div>
      )}
    </ParticipantPortalShell>
  );
}
