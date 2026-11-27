import { appZone } from "@/lib/datetime";
import { PersonLabels } from "@/components/labels/labels";
import { CopyButton } from "@/components/ui/copy-button";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { planManagementLabel } from "@/lib/directory-insights";
import type { DirectorOverview } from "@/services/directorParticipantService";
import { BAD, BORDER, GOOD, LinkButton, MUTED, PLUM, Section, TEXT, WARN, formatDate, relativeDays } from "./DirectorParticipantSections";

// The director's participant profile, as plain sections inside one surface:
// a header that says who this is and where their NDIS plan stands, then
// titled sections of rows. No boxes inside boxes, no charts for decoration.

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

const STATUS: Record<string, { label: string; color: string; background: string }> = {
  active: { label: "Receiving supports", color: "var(--cc-status-success, #15803D)", background: "var(--cc-status-success-bg, #DCFCE7)" },
  inactive: { label: "Services suspended", color: WARN, background: "var(--cc-amber-tint)" },
  exited: { label: "Services ended", color: MUTED, background: "var(--cc-soft)" },
};

// ── Header ───────────────────────────────────────────────────────────────────

/** Who they are and the NDIS facts the director checks first: plan dates and
 * management, risk, and how long your organisation has supported them. */
export function ProfileHeader({ overview, actions }: { overview: DirectorOverview; actions?: ReactNode }) {
  const p = overview.participant;
  const age = ageFrom(p.date_of_birth);
  const daysLeft = relativeDays(p.plan_end_date);
  const status = STATUS[overview.intake?.status ?? "active"] ?? STATUS.active;
  const openRisks = overview.risk.incidents_open.length + overview.risk.complaints_open.length;
  const risk = (p.risk_level ?? "").toLowerCase();
  const riskTone = risk === "high" || risk === "critical" ? BAD : risk === "medium" ? WARN : TEXT;

  const who = [
    age != null ? `${age} years` : null,
    p.primary_disability,
    p.service_category === "aged_care" ? "Aged care" : null,
  ].filter(Boolean);

  const plan =
    p.plan_start_date && p.plan_end_date
      ? `NDIS plan ${formatDate(p.plan_start_date)} to ${formatDate(p.plan_end_date)}`
      : "NDIS plan dates not recorded";
  const planLeft = daysLeft == null ? null : daysLeft < 0 ? "plan ended" : `${daysLeft} days left`;

  return (
    <header className="flex flex-wrap items-start gap-x-6 gap-y-4">
      <div className="flex min-w-0 flex-1 basis-[28rem] items-start gap-4">
        {p.profile_photo_url ? (
          <img src={p.profile_photo_url} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />
        ) : (
          <div
            aria-hidden
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
            style={{ background: "var(--cc-soft)", color: TEXT }}
          >
            {initialsOf(p.full_name)}
          </div>
        )}
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>
              {p.full_name}
            </h1>
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ color: status.color, background: status.background }}>
              {status.label}
            </span>
          </div>
          {p.preferred_name && p.preferred_name !== p.full_name && (
            <p className="text-sm" style={{ color: MUTED }}>Prefers to be called {p.preferred_name}</p>
          )}
          <p className="flex flex-wrap items-center text-sm" style={{ color: TEXT }}>
            {who.length > 0 && <span>{who.join(" · ")}&nbsp;·&nbsp;</span>}
            {p.ndis_number ? (
              <span className="inline-flex items-center gap-0.5">
                NDIS {p.ndis_number}
                <CopyButton value={p.ndis_number} label="NDIS number" />
              </span>
            ) : (
              <span>NDIS number not recorded</span>
            )}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" style={{ color: MUTED }}>
            <span>{plan}</span>
            {planLeft && <span style={{ color: daysLeft != null && daysLeft <= 30 ? BAD : daysLeft != null && daysLeft <= 90 ? WARN : MUTED }}>· {planLeft}</span>}
            {planManagementLabel(p.plan_management_type) && <span>· {planManagementLabel(p.plan_management_type)}</span>}
            <span>
              · <span style={{ color: riskTone }}>{p.risk_level ? `${p.risk_level[0].toUpperCase()}${p.risk_level.slice(1)} risk` : "Risk not assessed"}</span>
              {openRisks > 0 && <span style={{ color: BAD }}> ({openRisks} open)</span>}
            </span>
            <span>
              · {overview.intake?.activated_at ? `Supported since ${formatDate(overview.intake.activated_at)}` : "Not receiving supports yet"}
            </span>
          </p>
          <div className="pt-1">
            <PersonLabels target="participants" personId={p.id} personName={p.full_name} compact />
          </div>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// ── Support needs ────────────────────────────────────────────────────────────

function NeedRow({ label, onOpen, children }: { label: string; onOpen: () => void; children: ReactNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 py-3 text-left transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
      >
        <span className="grid min-w-0 flex-1 gap-0.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
          <span className="text-sm" style={{ color: MUTED }}>{label}</span>
          <span className="min-w-0 text-sm" style={{ color: TEXT }}>{children}</span>
        </span>
        <ArrowRight size={16} aria-hidden className="mt-0.5 shrink-0" style={{ color: MUTED }} />
      </button>
    </li>
  );
}

function Tag({ children, tone }: { children: ReactNode; tone?: "warn" }) {
  return (
    <span
      className="inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={tone === "warn" ? { background: "var(--cc-amber-tint)", color: WARN } : { background: "var(--cc-soft)", color: TEXT }}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

/** What a worker needs to know to support them safely. Each row opens the
 * part of Support needs it comes from. */
export function SupportNeedsSection({
  overview,
  onOpenNeeds,
  onOpenMedication,
}: {
  overview: DirectorOverview;
  onOpenNeeds: () => void;
  onOpenMedication: () => void;
}) {
  const care = overview.care;
  const meds = care?.medications ?? [];
  const contact = care?.emergency_contact;
  const none = <span style={{ color: MUTED }}>None recorded</span>;
  return (
    <Section title="Support needs" action={<LinkButton onClick={onOpenNeeds}>All support needs</LinkButton>}>
      <ul className="divide-y" style={{ borderColor: BORDER }}>
        <NeedRow label="Disability and alerts" onOpen={onOpenNeeds}>
          {care?.primary_disability || overview.participant.primary_disability || <span style={{ color: MUTED }}>Primary disability not recorded</span>}
          {(care?.alerts.length ?? 0) > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {care!.alerts.slice(0, 3).map((a) => <Tag key={a} tone="warn">{a}</Tag>)}
              {care!.alerts.length > 3 && <Tag>+{care!.alerts.length - 3} more</Tag>}
            </span>
          )}
        </NeedRow>
        <NeedRow label="Allergies" onOpen={onOpenNeeds}>
          {care?.allergies.length ? (
            <span className="flex flex-wrap gap-1.5">{care.allergies.map((a) => <Tag key={a}>{a}</Tag>)}</span>
          ) : none}
        </NeedRow>
        <NeedRow label="Medication" onOpen={onOpenMedication}>
          {meds.length ? (
            <>
              {meds.slice(0, 3).map((m) => m.name).join(", ")}
              {meds.length > 3 && <span style={{ color: MUTED }}> and {meds.length - 3} more</span>}
              {(overview.medication.high_risk > 0 || overview.medication.pending_verification > 0) && (
                <span className="mt-1 block text-xs" style={{ color: WARN }}>
                  {[
                    overview.medication.high_risk ? `${overview.medication.high_risk} high-risk` : null,
                    overview.medication.pending_verification ? `${overview.medication.pending_verification} waiting to be verified` : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              )}
            </>
          ) : none}
        </NeedRow>
        <NeedRow label="Communication" onOpen={onOpenNeeds}>
          {care?.communication || none}
        </NeedRow>
        <NeedRow label="Emergency contact" onOpen={onOpenNeeds}>
          {contact ? [contact.name, contact.relationship, contact.phone].filter(Boolean).join(" · ") : none}
        </NeedRow>
      </ul>
    </Section>
  );
}

// ── Recent shifts ────────────────────────────────────────────────────────────

const REVIEW: Record<string, { label: string; color: string }> = {
  verified: { label: "Verified", color: GOOD },
  changes_requested: { label: "Changes requested", color: WARN },
  sent_back: { label: "Changes made", color: MUTED },
  awaiting_review: { label: "Waiting for review", color: MUTED },
};

function shiftTimes(start?: string | null, end?: string | null) {
  if (!start) return null;
  const fmt = (v: string) => new Date(v).toLocaleTimeString("en-AU", { timeZone: appZone(), hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase();
  return end ? `${fmt(start)} to ${fmt(end)}` : fmt(start);
}

/** The latest shifts: when, who worked, and where each stands with the office
 * (its progress note reviewed and verified, or not yet). */
export function RecentShiftsSection({
  overview,
  onOpenShift,
  onSeeAll,
}: {
  overview: DirectorOverview;
  onOpenShift: (shiftId: string, review: string | null) => void;
  onSeeAll: () => void;
}) {
  const shifts = overview.recent_shifts ?? [];
  return (
    <Section title="Recent shifts" action={<LinkButton onClick={onSeeAll}>Open the schedule</LinkButton>}>
      {shifts.length === 0 ? (
        <p className="py-3 text-sm" style={{ color: MUTED }}>No shifts yet.</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: BORDER }}>
          {shifts.map((s) => {
            const state =
              s.status === "cancelled"
                ? { label: "Cancelled", color: BAD }
                : s.review
                  ? REVIEW[s.review] ?? { label: s.review, color: MUTED }
                  : { label: s.status === "in_progress" ? "On shift now" : "Progress note not written", color: s.status === "in_progress" ? GOOD : WARN };
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpenShift(s.id, s.review)}
                  aria-label={`${s.worker?.name ?? "No worker"}, ${formatDate(s.start)}, ${state.label}`}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-3 text-left transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium" style={{ color: TEXT }}>{s.worker?.name ?? "No worker"}</span>
                    <span className="block text-xs tabular-nums" style={{ color: MUTED }}>
                      {formatDate(s.start)}{shiftTimes(s.start, s.end) ? `, ${shiftTimes(s.start, s.end)}` : ""}
                    </span>
                  </span>
                  <span className="text-right text-xs font-medium" style={{ color: state.color }}>{state.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ── Agreements, intake and portal ────────────────────────────────────────────

/** The paperwork behind the supports: the service agreement, the intake form
 * and who can see their record in the participant portal. */
export function AgreementsSection({
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
  const active = !!a && (a.status === "active" || a.status === "signed");
  const rows: { title: string; detail: string; status: string; tone: string; action: string; onClick: () => void }[] = [
    {
      title: `Service agreement${a?.number ? ` ${a.number}` : ""}`,
      detail: a?.signed_date ? `Signed ${formatDate(a.signed_date)}` : a?.start_date ? `From ${formatDate(a.start_date)}` : "Needed before supports are delivered or claimed",
      status: !a ? "None on file" : active ? (days != null && days < 0 ? "Ended" : `Current until ${formatDate(a.end_date)}`) : `${a.status[0].toUpperCase()}${a.status.slice(1).replace(/_/g, " ")}`,
      tone: !a ? BAD : active && !(days != null && days <= 30) ? GOOD : WARN,
      action: a ? "Open" : "Set up",
      onClick: onOpenAgreement,
    },
    {
      title: "Intake form",
      detail: overview.intake?.activated_at ? `Supports began ${formatDate(overview.intake.activated_at)}` : "What was captured at referral",
      status: overview.intake ? "On file" : "Missing",
      tone: overview.intake ? GOOD : WARN,
      action: "Open",
      onClick: onOpenIntake,
    },
    {
      title: "Participant portal",
      detail: portal.people.length ? `${portal.people.length} ${portal.people.length === 1 ? "person has" : "people have"} access` : "The participant or their nominee can see their schedule, plan and documents",
      status: portal.people.some((p) => p.status === "active") ? "In use" : portal.status === "not_using" ? "Not using" : portal.people.length ? "Invited" : "No access yet",
      tone: portal.people.some((p) => p.status === "active") ? GOOD : MUTED,
      action: "Manage",
      onClick: onManagePortal,
    },
  ];
  return (
    <Section title="Agreements and consent">
      <ul className="divide-y" style={{ borderColor: BORDER }}>
        {rows.map((r) => (
          <li key={r.title} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
            <div className="min-w-0 flex-1 basis-56">
              <p className="text-sm font-medium" style={{ color: TEXT }}>{r.title}</p>
              <p className="text-xs" style={{ color: MUTED }}>{r.detail}</p>
            </div>
            <p className="text-sm font-medium" style={{ color: r.tone }}>{r.status}</p>
            <button
              type="button"
              onClick={r.onClick}
              aria-label={`${r.action} ${r.title.toLowerCase()}`}
              className="inline-flex min-h-10 md:min-h-8 items-center rounded-full px-3 text-sm font-medium hover:bg-cc-soft"
              style={{ color: PLUM }}
            >
              {r.action}
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
