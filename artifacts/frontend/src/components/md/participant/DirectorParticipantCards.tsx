import type { ReactNode } from "react";
import {
  ArrowRight,
  CalendarClock,
  CalendarPlus,
  Clock,
  FileText,
  HeartPulse,
  Upload,
  Wallet,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import { planManagementLabel } from "@/lib/directory-insights";
import {
  getDocumentLink,
  listParticipantDocuments,
  type DirectorOverview,
  type ParticipantDocument,
} from "@/services/directorParticipantService";
import { BAD, BORDER, GOOD, MUTED, PLUM, SOFT, TEXT, WARN, formatDate, money, relativeDays } from "./DirectorParticipantSections";

// The director's participant page, laid out as one record at a glance: a
// summary band, how support has gone lately, the care profile, the plan, the
// paperwork, and the latest shifts down the side.

const SKY = "var(--cc-sky)";

function ageFrom(dob?: string | null): number | null {
  if (!dob) return null;
  const born = new Date(dob);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  if (now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())) age -= 1;
  return age;
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function Card({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={`min-w-0 rounded-3xl border bg-cc-surface p-5 ${className}`} style={{ borderColor: BORDER }}>
      <div className="mb-3 flex min-h-10 flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold" style={{ color: TEXT }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SoftButton({ children, onClick, icon: Icon }: { children: ReactNode; onClick: () => void; icon: typeof Upload }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
      style={{ background: "var(--cc-plum-soft)", color: PLUM }}
    >
      <Icon size={15} aria-hidden /> {children}
    </button>
  );
}

function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "bad" }) {
  const style =
    tone === "bad"
      ? { background: "var(--cc-danger-bg, #FEF3F2)", color: BAD }
      : tone === "warn"
        ? { background: "var(--cc-amber-tint)", color: WARN }
        : { background: "var(--cc-coral-soft)", color: TEXT };
  return (
    <span className="inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-medium" style={style}>
      <span className="truncate">{children}</span>
    </span>
  );
}

// ── Summary band ─────────────────────────────────────────────────────────────

/** Who they are and the three things the director checks first: the plan,
 * the risk and how long they've been with the provider. */
export function SummaryBand({ overview }: { overview: DirectorOverview }) {
  const p = overview.participant;
  const age = ageFrom(p.date_of_birth);
  const days = relativeDays(p.plan_end_date);
  const openRisks = overview.risk.incidents_open.length + overview.risk.complaints_open.length;
  const risk = (p.risk_level ?? "").toLowerCase();
  const riskTone = risk === "high" || risk === "critical" ? BAD : risk === "medium" ? WARN : TEXT;
  const columns: { label: string; value: ReactNode; extra?: ReactNode }[] = [
    {
      label: "NDIS plan",
      value: p.plan_start_date && p.plan_end_date ? `${formatDate(p.plan_start_date, false)} to ${formatDate(p.plan_end_date)}` : "Dates not set",
      extra: [planManagementLabel(p.plan_management_type), days != null ? (days < 0 ? "ended" : `${days} days left`) : null]
        .filter(Boolean)
        .join(" · ") || null,
    },
    {
      label: "Risk",
      value: <span style={{ color: riskTone }}>{p.risk_level ? `${p.risk_level[0].toUpperCase()}${p.risk_level.slice(1)} risk` : "Not assessed"}</span>,
      extra: openRisks ? (
        <span className="inline-flex items-center rounded-full border px-2 text-xs font-semibold" style={{ borderColor: BORDER, color: BAD }}>
          +{openRisks} open
        </span>
      ) : null,
    },
    {
      label: "With you since",
      value: overview.intake?.activated_at ? formatDate(overview.intake.activated_at) : "Not active yet",
      extra: p.ndis_number ? `NDIS ${p.ndis_number}` : null,
    },
  ];
  return (
    <div
      className="grid gap-4 rounded-3xl border px-5 py-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] xl:items-center"
      style={{ background: "var(--cc-coral-soft)", borderColor: "var(--cc-coral-ring)" }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {p.profile_photo_url ? (
          <img src={p.profile_photo_url} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />
        ) : (
          <div aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-cc-surface text-lg font-semibold" style={{ color: TEXT }}>
            {initialsOf(p.full_name)}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>
            {p.full_name}
          </h1>
          <p className="truncate text-sm" style={{ color: MUTED }}>
            {[age != null ? `${age} y` : null, p.primary_disability, p.service_category === "aged_care" ? "Aged Care" : null].filter(Boolean).join(" | ") || "Details not recorded"}
          </p>
        </div>
      </div>
      {columns.map((c) => (
        <div key={c.label} className="min-w-0">
          <p className="text-xs font-semibold" style={{ color: TEXT }}>{c.label}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm" style={{ color: MUTED }}>
            <span className="min-w-0">{c.value}</span>
            {c.extra && (typeof c.extra === "string" ? <span className="text-xs">{c.extra}</span> : c.extra)}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── How support has gone ─────────────────────────────────────────────────────

function Donut({ parts, label }: { parts: { value: number; color: string }[]; label: string }) {
  const total = parts.reduce((t, p) => t + p.value, 0);
  const r = 26;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={label} className="h-11 w-11 shrink-0 sm:h-14 sm:w-14">
      <circle cx="32" cy="32" r={r} fill="none" stroke={SOFT} strokeWidth="12" />
      {total > 0 &&
        parts.map((p, i) => {
          const len = (p.value / total) * c;
          const el = (
            <circle
              key={i}
              cx="32"
              cy="32"
              r={r}
              fill="none"
              stroke={p.color}
              strokeWidth="12"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 32 32)"
            />
          );
          offset += len;
          return el;
        })}
    </svg>
  );
}

/** Delivered, cancelled and unfilled shifts: the design's consultations,
 * procedures and no-shows, in support terms. */
export function DeliveryBand({ overview }: { overview: DirectorOverview }) {
  const d = overview.delivery;
  const items = [
    { value: d.completed_30d, label: "Shifts delivered", hint: `${d.hours_30d} hours, last 30 days`, color: SKY },
    { value: d.cancelled_30d, label: "Cancelled", hint: "last 30 days", color: WARN },
    { value: d.unfilled_14d, label: "Unfilled", hint: `of ${d.upcoming_14d} in the next 14 days`, color: BAD },
  ];
  return (
    <section
      aria-label="How support has gone"
      className="flex items-center gap-4 rounded-3xl border bg-cc-surface px-4 py-3.5 sm:px-5"
      style={{ borderColor: BORDER }}
    >
      <Donut
        parts={items.map((i) => ({ value: i.value, color: i.color }))}
        label={`${d.completed_30d} delivered, ${d.cancelled_30d} cancelled, ${d.unfilled_14d} unfilled`}
      />
      <div className="grid min-w-0 flex-1 grid-cols-3 gap-3 sm:gap-4">
        {items.map((i) => (
          <div key={i.label} className="flex min-w-0 gap-2 sm:gap-3">
            <span aria-hidden className="w-1 shrink-0 rounded-full" style={{ background: i.color }} />
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-tight tabular-nums" style={{ color: TEXT }}>{i.value}</p>
              <p className="text-xs font-medium sm:text-sm" style={{ color: TEXT }}>{i.label}</p>
              <p className="hidden text-xs sm:block" style={{ color: MUTED }}>{i.hint}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Care profile ─────────────────────────────────────────────────────────────

function ProfileRow({ label, onOpen, children }: { label: string; onOpen: () => void; children: ReactNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 py-3.5 text-left transition hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium" style={{ color: MUTED }}>{label}</span>
          <span className="mt-1 block text-sm" style={{ color: TEXT }}>{children}</span>
        </span>
        <ArrowRight size={18} aria-hidden style={{ color: MUTED }} className="shrink-0" />
      </button>
    </li>
  );
}

/** The design's medical history: what a worker needs to know to support them
 * safely. Each row opens that part of the care record. */
export function CareProfileCard({
  overview,
  onOpenCare,
  onOpenMedication,
  onOpenRisks,
}: {
  overview: DirectorOverview;
  onOpenCare: () => void;
  onOpenMedication: () => void;
  onOpenRisks: () => void;
}) {
  const care = overview.care;
  const meds = care?.medications ?? [];
  const openRisks = overview.risk.incidents_open.length + overview.risk.complaints_open.length;
  const contact = care?.emergency_contact;
  const none = <span style={{ color: MUTED }}>None recorded</span>;
  return (
    <Card title="Care profile">
      <ul className="divide-y" style={{ borderColor: BORDER }}>
        <ProfileRow label="Disability and alerts" onOpen={onOpenCare}>
          {care?.primary_disability || overview.participant.primary_disability || <span style={{ color: MUTED }}>Primary disability not recorded</span>}
          {(care?.alerts.length ?? 0) > 0 && (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {care!.alerts.slice(0, 3).map((a) => <Chip key={a} tone="warn">{a}</Chip>)}
              {care!.alerts.length > 3 && <Chip>+{care!.alerts.length - 3}</Chip>}
            </span>
          )}
        </ProfileRow>
        <ProfileRow label="Allergies" onOpen={onOpenCare}>
          {care?.allergies.length ? (
            <span className="flex flex-wrap gap-1.5">{care.allergies.map((a) => <Chip key={a}>{a}</Chip>)}</span>
          ) : none}
        </ProfileRow>
        <ProfileRow label="Medication" onOpen={onOpenMedication}>
          {meds.length ? (
            <>
              {meds.slice(0, 3).map((m) => m.name).join(", ")}
              {meds.length > 3 && <span style={{ color: MUTED }}> +{meds.length - 3}</span>}
              {(overview.medication.high_risk > 0 || overview.medication.pending_verification > 0) && (
                <span className="mt-1 block text-xs" style={{ color: WARN }}>
                  {[
                    overview.medication.high_risk ? `${overview.medication.high_risk} high-risk` : null,
                    overview.medication.pending_verification ? `${overview.medication.pending_verification} to check` : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              )}
            </>
          ) : none}
        </ProfileRow>
        <ProfileRow label="Communication" onOpen={onOpenCare}>
          {care?.communication || none}
        </ProfileRow>
        <ProfileRow label="Emergency contact" onOpen={onOpenCare}>
          {contact ? [contact.name, contact.relationship, contact.phone].filter(Boolean).join(" · ") : none}
        </ProfileRow>
        <ProfileRow label="Incidents and complaints" onOpen={onOpenRisks}>
          {openRisks ? (
            <span style={{ color: BAD }}>{openRisks} open</span>
          ) : (
            <span style={{ color: GOOD }}>Nothing open</span>
          )}
          <span style={{ color: MUTED }}> · {overview.risk.incidents_total} incidents on record</span>
        </ProfileRow>
      </ul>
    </Card>
  );
}

// ── Plan at a glance ─────────────────────────────────────────────────────────

/** The design's vitals: the numbers that say whether the plan is on track. */
export function PlanGlanceCard({ overview, onReview }: { overview: DirectorOverview; onReview: () => void }) {
  const f = overview.funding;
  const score = overview.quality.average_score;
  const next = overview.delivery.next_shift;
  const used = f.percent_used == null ? null : Math.round(f.percent_used);
  const elapsed = f.percent_time_elapsed == null ? null : Math.round(f.percent_time_elapsed);
  const usedTone = f.ahead_by != null && f.ahead_by >= 25 ? BAD : f.ahead_by != null && f.ahead_by >= 10 ? WARN : SKY;
  const overspent = f.categories.filter((c) => c.overspent);
  const rows: { icon: typeof Wallet; value: ReactNode; label: string; tone?: string }[] = [
    {
      icon: Wallet,
      value: f.has_plan ? money(f.remaining) : "No plan",
      label: f.has_plan ? `left of ${money(f.total)}` : "funding not loaded",
    },
    {
      icon: Clock,
      value: `${overview.delivery.hours_30d} h`,
      label: "delivered, last 30 days",
    },
    {
      icon: HeartPulse,
      value: score == null ? "N/A" : `${Math.round(score)}%`,
      label: "note quality",
      tone: score == null ? MUTED : score >= 85 ? GOOD : score >= 60 ? WARN : BAD,
    },
    {
      icon: CalendarClock,
      value: next?.start ? formatDate(next.start, false) : "None",
      label: next?.start ? `next shift${next.worker ? `, ${next.worker.name}` : ", unfilled"}` : "booked in 14 days",
      tone: next && !next.worker ? WARN : undefined,
    },
  ];
  return (
    <Card title="Plan at a glance" action={<button type="button" onClick={onReview} className="inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-sm font-medium hover:bg-cc-soft" style={{ color: PLUM }}>Review plan <ArrowRight size={14} aria-hidden /></button>}>
      {used != null && (
        <div className="mb-4">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span style={{ color: TEXT }}><span className="font-semibold tabular-nums" style={{ color: usedTone }}>{used}%</span> of funding used</span>
            {elapsed != null && <span className="text-xs" style={{ color: MUTED }}>{elapsed}% of the plan's time gone</span>}
          </div>
          <div className="relative mt-2 h-2 rounded-full" style={{ background: SOFT }} role="img" aria-label={`${used}% of funding used, ${elapsed ?? "unknown"}% of time gone`}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(used, 100)}%`, background: usedTone }} />
            {elapsed != null && <span aria-hidden className="absolute -top-1 h-4 w-0.5 rounded-full" style={{ left: `${Math.min(elapsed, 100)}%`, background: TEXT }} />}
          </div>
        </div>
      )}
      <ul className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.label} className="flex min-w-0 items-start gap-2.5">
            <r.icon size={18} aria-hidden className="mt-0.5 shrink-0" style={{ color: MUTED }} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold tabular-nums" style={{ color: r.tone ?? TEXT }}>{r.value}</span>
              <span className="block text-xs" style={{ color: MUTED }}>{r.label}</span>
            </span>
          </li>
        ))}
      </ul>
      {overspent.length > 0 && (
        <p className="mt-4 text-xs" style={{ color: BAD }}>
          Overspent: {overspent.map((c) => c.label).join(", ")}
        </p>
      )}
    </Card>
  );
}

// ── Files ────────────────────────────────────────────────────────────────────

export function FilesCard({
  participantId,
  onUpload,
  onManage,
}: {
  participantId: string;
  onUpload: () => void;
  onManage: () => void;
}) {
  const { toast } = useToast();
  const docs = useOrgQuery(["director-participant", participantId, "documents"], {
    queryFn: () => listParticipantDocuments(participantId),
  });
  const list = docs.data?.documents ?? [];

  async function open(doc: ParticipantDocument) {
    try {
      const { url } = await getDocumentLink(participantId, doc);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast({ title: "Couldn't open the document", description: (err as Error).message, variant: "destructive" });
    }
  }

  return (
    <Card title="Files and documents" action={<SoftButton onClick={onUpload} icon={Upload}>Upload</SoftButton>}>
      {docs.isLoading ? (
        <Skeleton className="h-20 w-full rounded-2xl" />
      ) : list.length === 0 ? (
        <p className="text-sm" style={{ color: MUTED }}>Nothing on file yet.</p>
      ) : (
        <ul className="space-y-1">
          {list.slice(0, 4).map((doc) => (
            <li key={`${doc.source}-${doc.id}`}>
              <button
                type="button"
                onClick={() => void open(doc)}
                className="flex min-h-10 w-full items-center gap-2.5 rounded-xl px-1 text-left text-sm transition hover:bg-cc-soft"
              >
                <FileText size={16} aria-hidden className="shrink-0" style={{ color: MUTED }} />
                <span className="min-w-0 flex-1 truncate underline underline-offset-2" style={{ color: TEXT }}>{doc.title || doc.file_name}</span>
                <span className="shrink-0 text-xs" style={{ color: MUTED }}>{doc.category_label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && (
        <button type="button" onClick={onManage} className="mt-2 inline-flex min-h-10 items-center gap-1 rounded-full px-1 text-sm font-medium hover:underline" style={{ color: PLUM }}>
          {list.length > 4 ? `All ${list.length} documents` : "Manage documents"} <ArrowRight size={14} aria-hidden />
        </button>
      )}
    </Card>
  );
}

// ── Recent shifts ────────────────────────────────────────────────────────────

const REVIEW_CHIP: Record<string, { label: string; tone: "neutral" | "warn" | "bad" }> = {
  verified: { label: "Verified", tone: "neutral" },
  changes_requested: { label: "Changes requested", tone: "warn" },
  sent_back: { label: "Changes made", tone: "neutral" },
  awaiting_review: { label: "Waiting for review", tone: "neutral" },
};

function shiftTimes(start?: string | null, end?: string | null) {
  if (!start) return null;
  const fmt = (v: string) => new Date(v).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }).toLowerCase();
  return end ? `${fmt(start)} - ${fmt(end)}` : fmt(start);
}

/** The design's recent visits: who worked, when, and where each shift stands. */
export function RecentShiftsCard({
  overview,
  onOpenShift,
  onNewShift,
}: {
  overview: DirectorOverview;
  onOpenShift: (shiftId: string, review: string | null) => void;
  onNewShift: () => void;
}) {
  const shifts = overview.recent_shifts ?? [];
  return (
    <Card title="Recent shifts" action={<SoftButton onClick={onNewShift} icon={CalendarPlus}>New shift</SoftButton>}>
      {shifts.length === 0 ? (
        <p className="text-sm" style={{ color: MUTED }}>No shifts yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {shifts.map((s) => {
            const chip = s.status === "cancelled"
              ? { label: "Cancelled", tone: "bad" as const }
              : s.review
                ? REVIEW_CHIP[s.review]
                : { label: s.status === "in_progress" ? "On now" : "Not finished", tone: "neutral" as const };
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpenShift(s.id, s.review)}
                  className="w-full rounded-2xl border p-3.5 text-left transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
                  style={{ borderColor: BORDER }}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold" style={{ color: TEXT }}>{s.worker?.name ?? "Unassigned"}</span>
                    </span>
                    <Chip tone={chip.tone}>{chip.label}</Chip>
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: MUTED }}>
                    <span className="inline-flex items-center gap-1.5"><CalendarClock size={13} aria-hidden />{formatDate(s.start)}</span>
                    {shiftTimes(s.start, s.end) && <span className="inline-flex items-center gap-1.5"><Clock size={13} aria-hidden />{shiftTimes(s.start, s.end)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ── Agreements and forms ─────────────────────────────────────────────────────

/** The design's forms table: the paperwork behind the support. */
export function AgreementsCard({
  overview,
  onOpenAgreement,
  onOpenIntake,
  onManagePortal,
}: {
  overview: DirectorOverview;
  onOpenAgreement: () => void;
  onOpenIntake: () => void;
  onManagePortal: () => void;
}) {
  const a = overview.agreement;
  const days = relativeDays(a?.end_date);
  const portal = overview.portal;
  const rows: { title: string; date: string; status: string; tone: string; action: string; onClick: () => void }[] = [
    {
      title: `Service agreement${a?.number ? ` ${a.number}` : ""}`,
      date: a?.signed_date ? `Signed ${formatDate(a.signed_date)}` : a?.start_date ? `From ${formatDate(a.start_date)}` : "",
      status: !a ? "None on file" : a.status === "active" || a.status === "signed" ? (days != null && days < 0 ? "Ended" : `Active to ${formatDate(a.end_date, false)}`) : `${a.status[0].toUpperCase()}${a.status.slice(1)}`,
      tone: !a ? BAD : (a.status === "active" || a.status === "signed") && !(days != null && days <= 30) ? GOOD : WARN,
      action: a ? "Open" : "Add",
      onClick: onOpenAgreement,
    },
    {
      title: "Intake form",
      date: overview.intake?.activated_at ? `Activated ${formatDate(overview.intake.activated_at)}` : "",
      status: overview.intake ? "On file" : "Missing",
      tone: overview.intake ? GOOD : WARN,
      action: "Open",
      onClick: onOpenIntake,
    },
    {
      title: "Participant portal",
      date: portal.people.length ? `${portal.people.length} ${portal.people.length === 1 ? "person" : "people"}` : "",
      status: portal.people.some((p) => p.status === "active") ? "In use" : portal.status === "not_using" ? "Not using" : portal.people.length ? "Invited" : "No access yet",
      tone: portal.people.some((p) => p.status === "active") ? GOOD : MUTED,
      action: "Manage",
      onClick: onManagePortal,
    },
  ];
  return (
    <Card title="Agreements and forms">
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide" style={{ color: MUTED }}>
              <th className="px-1 pb-2 font-semibold">Title</th>
              <th className="px-1 pb-2 font-semibold">Date</th>
              <th className="px-1 pb-2 font-semibold">Status</th>
              <th className="px-1 pb-2 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: BORDER }}>
            {rows.map((r) => (
              <tr key={r.title}>
                <td className="px-1 py-3 font-medium" style={{ color: TEXT }}>{r.title}</td>
                <td className="px-1 py-3" style={{ color: MUTED }}>{r.date || "-"}</td>
                <td className="px-1 py-3 font-medium" style={{ color: r.tone }}>{r.status}</td>
                <td className="px-1 py-3 text-right">
                  <button type="button" onClick={r.onClick} className="inline-flex min-h-10 items-center rounded-full px-3 text-sm font-semibold hover:bg-cc-soft" style={{ color: PLUM }}>
                    {r.action}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
