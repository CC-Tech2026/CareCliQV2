import { Link } from "wouter";
import { AlertTriangle, ArrowRight, CalendarCheck, CalendarDays, FileSignature, NotebookTabs } from "lucide-react";
import { ParticipantPortalShell } from "@/components/participant-portal/ParticipantPortalShell";
import { useViewingParticipant } from "@/components/participant-portal/ParticipantPortalContext";
import { usePortalOverview } from "@/components/participant-portal/usePortalOverview";
import type { ParticipantShift } from "@/services/participantPortalService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const SURFACE = "var(--cc-surface)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const AMBER = "#9A5B0A";
const AMBER_SOFT = "#FBF2E6";

function formatDate(value?: string | null) {
  if (!value) return undefined;
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function formatShiftDay(value: string) {
  return new Date(value).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
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
    <li className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: SURFACE }}>
      <Icon size={16} style={{ color: done ? "#1F7A4D" : PLUM }} className="shrink-0" />
      <span className="min-w-0 flex-1 text-[13px]" style={{ color: TEXT }}>
        <span className="font-bold">{formatShiftDay(shift.scheduled_start)}</span>
        <span style={{ color: MUTED }}> · {formatTime(shift.scheduled_start)}–{formatTime(shift.scheduled_end)}</span>
      </span>
      {shift.worker_name && (
        <span className="shrink-0 truncate text-[12px] font-semibold" style={{ color: MUTED }}>{shift.worker_name}</span>
      )}
    </li>
  );
}

function PinnedCard({
  href,
  title,
  subtitle,
  gradient,
  icon: Icon,
  available,
}: {
  href: string;
  title: string;
  subtitle: string;
  gradient: string;
  icon: typeof FileSignature;
  available: boolean;
}) {
  const body = (
    <div
      className="flex h-36 flex-col justify-between rounded-2xl p-4"
      style={{ background: available ? gradient : SOFT, opacity: available ? 1 : 0.7 }}
    >
      {/* Fixed dark ink: the gradients are light in both themes. */}
      <Icon size={18} style={{ color: available ? "#1E1640" : MUTED }} />
      <div>
        <p className="text-[15px] font-black" style={{ color: available ? "#1E1640" : TEXT }}>{title}</p>
        <p className="text-[12px]" style={{ color: available ? "#4B4560" : MUTED }}>{subtitle}</p>
      </div>
    </div>
  );
  return available ? (
    <Link href={href} className="block rounded-2xl outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2">
      {body}
    </Link>
  ) : (
    <div aria-disabled="true">{body}</div>
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
            <div className="rounded-2xl p-2" style={{ background: SOFT }}>
              {data.upcoming_shifts.length === 0 ? (
                <p className="px-4 py-5 text-center text-[13px]" style={{ color: MUTED }}>No upcoming support scheduled yet.</p>
              ) : (
                <ul className="space-y-2">
                  {data.upcoming_shifts.map((s) => <ShiftLine key={s.id} shift={s} />)}
                </ul>
              )}
            </div>
          </Card>

          <Card title="Pinned documents">
            <div className="grid gap-4 sm:grid-cols-2">
              <PinnedCard
                href="/participant-portal/documents"
                title="Service Agreement"
                subtitle={
                  data.pinned.service_agreement.available
                    ? `Signed ${formatDate(data.pinned.service_agreement.updated_at) ?? ""}`
                    : "Not available yet"
                }
                gradient="linear-gradient(135deg, #DCE8FF 0%, #F3E8FF 100%)"
                icon={FileSignature}
                available={data.pinned.service_agreement.available}
              />
              <PinnedCard
                href="/participant-portal/plan"
                title="NDIS Plan"
                subtitle={
                  data.pinned.ndis_plan.available
                    ? `${formatDate(data.pinned.ndis_plan.plan_start) ?? "—"} – ${formatDate(data.pinned.ndis_plan.plan_end) ?? "—"}`
                    : "Not available yet"
                }
                gradient="linear-gradient(135deg, #FFF1D6 0%, #FFE0E6 100%)"
                icon={NotebookTabs}
                available={data.pinned.ndis_plan.available}
              />
            </div>
          </Card>

          <Card title="Recent support">
            {data.recent_shifts.length === 0 ? (
              <p className="text-[13px]" style={{ color: MUTED }}>Completed support sessions will appear here.</p>
            ) : (
              <ul className="space-y-2 rounded-2xl p-2" style={{ background: SOFT }}>
                {data.recent_shifts.map((s) => <ShiftLine key={s.id} shift={s} done />)}
              </ul>
            )}
          </Card>
        </div>
      )}
    </ParticipantPortalShell>
  );
}
