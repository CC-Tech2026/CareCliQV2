import type { ReactNode } from "react";
import {
  ArrowRight,
  CalendarClock,
  Download,
  ExternalLink,
  FileText,
  History,
  Pill,
  ShieldAlert,
  Upload,
  Users,
  Wallet,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import {
  getAuditTrail,
  getDocumentLink,
  listParticipantDocuments,
  type DirectorOverview,
  type ParticipantDocument,
} from "@/services/directorParticipantService";

// The sections of the managing director's participant profile, in the same
// visual language as the director's Participants list (onboard-participant.tsx):
// rounded-3xl surfaces, no card shadows, tabular figures, plain-word labels.

export const TEXT = "var(--cc-text)";
export const MUTED = "var(--cc-muted)";
export const BORDER = "var(--cc-border)";
export const SOFT = "var(--cc-soft)";
export const PLUM = "var(--cc-plum)";
export const GOOD = "var(--cc-green)";
export const WARN = "var(--cc-amber)";
export const BAD = "var(--cc-danger-text)";

export const money = (n: number | null | undefined) =>
  n == null ? "N/A" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);

export function formatDate(value?: string | null, withYear = true) {
  if (!value) return "N/A";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return "N/A";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}

export function formatDateTime(value?: string | null) {
  if (!value) return "N/A";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "N/A";
  return `${d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}, ${d
    .toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })
    .replace(" ", "")}`;
}

export function relativeDays(value?: string | null) {
  if (!value) return null;
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function timeAgo(value: string) {
  const mins = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(value);
}

export function Section({
  icon: Icon,
  title,
  action,
  children,
  id,
}: {
  icon: typeof Wallet;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-28 rounded-3xl bg-cc-surface p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold" style={{ color: TEXT }}>
          <Icon size={17} style={{ color: MUTED }} aria-hidden />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function LinkButton({ children, onClick, icon: Icon = ArrowRight }: { children: ReactNode; onClick: () => void; icon?: typeof ArrowRight }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
      style={{ color: PLUM }}
    >
      {children}
      <Icon size={14} aria-hidden />
    </button>
  );
}

function Figure({ value, label, tone }: { value: ReactNode; label: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xl font-semibold tabular-nums tracking-tight" style={{ color: tone ?? TEXT }}>{value}</p>
      <p className="mt-0.5 text-xs" style={{ color: MUTED }}>{label}</p>
    </div>
  );
}

function Bar({ percent, color, label }: { percent: number; color: string; label: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full" style={{ background: SOFT }} role="img" aria-label={label}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(percent, 100))}%`, background: color }} />
    </div>
  );
}

// ── Funding ──────────────────────────────────────────────────────────────────

export function FundingSection({ overview, onReview }: { overview: DirectorOverview; onReview: () => void }) {
  const f = overview.funding;
  if (!f.has_plan) {
    return (
      <Section icon={Wallet} title="Funding" action={<LinkButton onClick={onReview}>Set up the plan</LinkButton>}>
        <p className="text-sm" style={{ color: MUTED }}>No NDIS plan is recorded, so spending can't be tracked yet.</p>
      </Section>
    );
  }
  const ahead = f.ahead_by ?? 0;
  const paceTone = ahead >= 25 ? BAD : ahead >= 10 ? WARN : GOOD;
  const pace =
    f.percent_used == null || f.percent_time_elapsed == null
      ? null
      : ahead >= 10
        ? `Spending is ${Math.round(ahead)} points ahead of the plan's time.`
        : ahead <= -15
          ? `Spending is ${Math.round(-ahead)} points behind the plan's time. Supports may be under-delivered.`
          : "Spending is in step with the plan's time.";

  return (
    <Section icon={Wallet} title="Funding" action={<LinkButton onClick={onReview}>Plan and budgets</LinkButton>}>
      <div className="grid grid-cols-3 gap-4">
        <Figure value={money(f.total)} label="Plan total" />
        <Figure value={money(f.used)} label="Used" />
        <Figure value={money(f.remaining)} label="Remaining" tone={f.remaining <= 0 ? BAD : undefined} />
      </div>

      {f.percent_used != null && f.percent_time_elapsed != null && (
        <div className="mt-5 space-y-2.5">
          <div>
            <div className="mb-1 flex justify-between text-xs" style={{ color: MUTED }}>
              <span>Funding used</span>
              <span className="tabular-nums font-medium" style={{ color: TEXT }}>{Math.round(f.percent_used)}%</span>
            </div>
            <Bar percent={f.percent_used} color={paceTone} label={`${Math.round(f.percent_used)}% of funding used`} />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs" style={{ color: MUTED }}>
              <span>Plan time gone</span>
              <span className="tabular-nums font-medium" style={{ color: TEXT }}>{Math.round(f.percent_time_elapsed)}%</span>
            </div>
            <Bar percent={f.percent_time_elapsed} color="var(--cc-muted)" label={`${Math.round(f.percent_time_elapsed)}% of the plan's time gone`} />
          </div>
          {pace && <p className="pt-1 text-sm font-medium" style={{ color: paceTone }}>{pace}</p>}
        </div>
      )}

      {f.categories.length > 0 && (
        <ul className="mt-5 divide-y border-t" style={{ borderColor: BORDER }}>
          {f.categories.map((c) => {
            const pct = c.allocated ? (c.used / c.allocated) * 100 : 0;
            const tone = c.overspent ? BAD : pct >= 90 ? WARN : TEXT;
            return (
              <li key={c.category} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 py-3" style={{ borderColor: BORDER }}>
                <p className="truncate text-sm" style={{ color: TEXT }}>{c.label}</p>
                <p className="text-sm tabular-nums" style={{ color: tone }}>
                  {money(c.used)} <span style={{ color: MUTED }}>of {money(c.allocated)}</span>
                </p>
                <div className="col-span-2">
                  <Bar percent={pct} color={c.overspent ? BAD : pct >= 90 ? WARN : PLUM} label={`${c.label}: ${Math.round(pct)}% used`} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ── Service delivery ─────────────────────────────────────────────────────────

export function DeliverySection({ overview, onOpenSchedule, onOpenShifts }: { overview: DirectorOverview; onOpenSchedule: () => void; onOpenShifts: () => void }) {
  const d = overview.delivery;
  const q = overview.quality;
  const scoreTone = q.average_score == null ? MUTED : q.average_score >= 90 ? GOOD : q.average_score >= 75 ? WARN : BAD;
  return (
    <Section icon={CalendarClock} title="Service delivery" action={<LinkButton onClick={onOpenShifts}>Shift history</LinkButton>}>
      <p className="mb-3 text-xs font-medium" style={{ color: MUTED }}>Last 30 days</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure value={d.completed_30d} label="shifts delivered" />
        <Figure value={`${d.hours_30d}h`} label="of support" />
        <Figure value={d.cancelled_30d} label="cancelled" tone={d.cancelled_30d ? WARN : undefined} />
        <Figure value={q.average_score == null ? "N/A" : `${Math.round(q.average_score)}%`} label="note quality" tone={scoreTone} />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4" style={{ background: SOFT }}>
        <div className="min-w-0">
          <p className="text-xs font-medium" style={{ color: MUTED }}>Next shift</p>
          {d.next_shift ? (
            <p className="mt-0.5 text-sm font-semibold" style={{ color: TEXT }}>
              {formatDateTime(d.next_shift.start)}
              <span className="font-normal" style={{ color: MUTED }}> · {d.next_shift.worker?.name ?? "No worker yet"}</span>
            </p>
          ) : (
            <p className="mt-0.5 text-sm font-semibold" style={{ color: WARN }}>Nothing rostered in the next 14 days</p>
          )}
          <p className="mt-1 text-xs" style={{ color: d.unfilled_14d ? BAD : MUTED }}>
            {d.upcoming_14d} rostered in the next 14 days
            {d.unfilled_14d ? ` · ${d.unfilled_14d} without a worker` : ""}
          </p>
        </div>
        <LinkButton onClick={onOpenSchedule}>Open the schedule</LinkButton>
      </div>
    </Section>
  );
}

// ── Quality and risk ─────────────────────────────────────────────────────────

export function RiskSection({
  overview,
  onOpenIncident,
  onOpenComplaints,
  onOpenMedication,
}: {
  overview: DirectorOverview;
  onOpenIncident: (id?: string) => void;
  onOpenComplaints: () => void;
  onOpenMedication: () => void;
}) {
  const r = overview.risk;
  const m = overview.medication;
  const rows: { label: string; value: ReactNode; detail?: ReactNode; tone?: string; onClick?: () => void }[] = [
    {
      label: "Incidents",
      value: r.incidents_open.length ? `${r.incidents_open.length} open` : "None open",
      tone: r.incidents_open.length ? BAD : GOOD,
      detail: r.incidents_open.length
        ? r.incidents_open.map((i) => `${i.title}${i.ndis_reportable ? " (NDIS reportable)" : ""}`).join(" · ")
        : r.latest_incident
          ? `Last: ${r.latest_incident.title}, ${formatDate(r.latest_incident.date)} (${r.latest_incident.status ?? "closed"})`
          : "No incidents on record.",
      onClick: () => onOpenIncident(r.incidents_open[0]?.id),
    },
    {
      label: "Complaints",
      value: r.complaints_open.length ? `${r.complaints_open.length} in progress` : "None open",
      tone: r.complaints_open.length ? WARN : GOOD,
      detail: r.complaints_open.length
        ? r.complaints_open.map((c) => c.subject).filter(Boolean).join(" · ")
        : `${r.complaints_total} on record.`,
      onClick: onOpenComplaints,
    },
    {
      label: "Medication",
      value: `${m.active} active`,
      tone: m.pending_verification ? WARN : TEXT,
      detail: [
        m.high_risk ? `${m.high_risk} high risk` : null,
        m.prn ? `${m.prn} as needed` : null,
        m.pending_verification ? `${m.pending_verification} waiting to be verified` : null,
      ].filter(Boolean).join(" · ") || "Nothing waiting on verification.",
      onClick: onOpenMedication,
    },
    {
      label: "Shift notes",
      value: overview.quality.needs_attention_30d ? `${overview.quality.needs_attention_30d} need attention` : "All in order",
      tone: overview.quality.needs_attention_30d ? WARN : GOOD,
      detail: `${overview.quality.notes_30d} written in the last 30 days.`,
    },
  ];
  return (
    <Section icon={ShieldAlert} title="Quality and risk">
      <ul className="divide-y" style={{ borderColor: BORDER }}>
        {rows.map((row) => {
          const content = (
            <>
              <p className="text-sm" style={{ color: MUTED }}>{row.label}</p>
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: row.tone ?? TEXT }}>{row.value}</p>
                {row.detail && <p className="mt-0.5 line-clamp-2 text-xs" style={{ color: MUTED }}>{row.detail}</p>}
              </div>
            </>
          );
          return (
            <li key={row.label} style={{ borderColor: BORDER }}>
              {row.onClick ? (
                <button
                  type="button"
                  onClick={row.onClick}
                  className="grid w-full grid-cols-[110px_1fr_auto] items-start gap-3 rounded-xl py-3 text-left transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum sm:grid-cols-[130px_1fr_auto]"
                >
                  {content}
                  <ArrowRight size={15} className="mt-0.5" style={{ color: MUTED }} aria-hidden />
                </button>
              ) : (
                <div className="grid grid-cols-[110px_1fr_auto] items-start gap-3 py-3 sm:grid-cols-[130px_1fr_auto]">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ── Documents and data ───────────────────────────────────────────────────────

function fileSize(bytes?: number | null) {
  if (!bytes) return "";
  return bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export function DocumentsSection({
  participantId,
  onUpload,
  onExport,
  onArchive,
}: {
  participantId: string;
  onUpload: () => void;
  onExport: () => void;
  onArchive: (doc: ParticipantDocument) => void;
}) {
  const { toast } = useToast();
  const docs = useOrgQuery(["director-participant", participantId, "documents"], {
    queryFn: () => listParticipantDocuments(participantId),
  });

  async function open(doc: ParticipantDocument) {
    try {
      const { url } = await getDocumentLink(participantId, doc);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast({ title: "Couldn't open the document", description: (err as Error).message, variant: "destructive" });
    }
  }

  const list = docs.data?.documents ?? [];
  return (
    <Section
      id="documents"
      icon={FileText}
      title="Documents and data"
      action={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onExport}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-cc-border px-4 text-sm font-medium transition hover:bg-cc-soft"
            style={{ color: TEXT }}
          >
            <Download size={14} aria-hidden /> Export
          </button>
          <button
            type="button"
            onClick={onUpload}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-white transition hover:opacity-90"
            style={{ background: PLUM }}
          >
            <Upload size={14} aria-hidden /> Import a document
          </button>
        </div>
      }
    >
      <p className="mb-3 text-sm" style={{ color: MUTED }}>
        GP letters, clinical assessments, therapy reports and medication paperwork. Medication paperwork is read into the
        medication chart so it can be checked before workers use it.
      </p>
      {docs.isLoading ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : docs.isError ? (
        <p className="text-sm" style={{ color: BAD }}>Documents couldn't be loaded.</p>
      ) : docs.data && !docs.data.available && list.length === 0 ? (
        <p className="rounded-2xl p-4 text-sm" style={{ background: SOFT, color: MUTED }}>
          Document storage is being set up for your organisation. Medication paperwork can still be added from the care record.
        </p>
      ) : list.length === 0 ? (
        <p className="rounded-2xl p-4 text-sm" style={{ background: SOFT, color: MUTED }}>
          Nothing filed yet. Import the GP summary and any clinical assessments so the record is complete for audit.
        </p>
      ) : (
        <ul className="divide-y border-t" style={{ borderColor: BORDER }}>
          {list.map((doc) => (
            <li key={`${doc.source}-${doc.id}`} className="flex items-center gap-3 py-3" style={{ borderColor: BORDER }}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: SOFT }}>
                {doc.source === "medication" ? <Pill size={15} style={{ color: MUTED }} /> : <FileText size={15} style={{ color: MUTED }} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" style={{ color: TEXT }}>{doc.title}</p>
                <p className="truncate text-xs" style={{ color: MUTED }}>
                  {[doc.category_label, doc.author, doc.document_date ? formatDate(doc.document_date) : null,
                    doc.uploaded_at ? `added ${formatDate(doc.uploaded_at)}${doc.uploaded_by ? ` by ${doc.uploaded_by}` : ""}` : null,
                    fileSize(doc.file_size)].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => open(doc)}
                aria-label={`Open ${doc.title}`}
                className="inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-sm font-medium transition hover:bg-cc-soft"
                style={{ color: PLUM }}
              >
                Open <ExternalLink size={13} aria-hidden />
              </button>
              {doc.source === "participant" && (
                <button
                  type="button"
                  onClick={() => onArchive(doc)}
                  className="hidden min-h-10 rounded-full px-3 text-sm transition hover:bg-cc-soft sm:inline-flex sm:items-center"
                  style={{ color: MUTED }}
                >
                  Archive
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ── Right column ─────────────────────────────────────────────────────────────

function PersonRow({ role, name, missing }: { role: string; name?: string | null; missing: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <p className="text-sm" style={{ color: MUTED }}>{role}</p>
      <p className="truncate text-right text-sm font-medium" style={{ color: name ? TEXT : WARN }}>{name ?? missing}</p>
    </div>
  );
}

export function CareTeamPanel({ overview, onChange }: { overview: DirectorOverview; onChange: () => void }) {
  const t = overview.team;
  return (
    <Section icon={Users} title="Care team" action={<LinkButton onClick={onChange}>Change</LinkButton>}>
      <div className="divide-y" style={{ borderColor: BORDER }}>
        <PersonRow role="Coordinator" name={t.coordinator?.name} missing="Not set" />
        <PersonRow role="Main worker" name={t.main_worker?.name} missing="Not set" />
        <PersonRow role="Backup" name={t.backups.map((b) => b.name).join(", ") || null} missing="None" />
      </div>
    </Section>
  );
}

export function AgreementPortalPanel({
  overview,
  onOpenAgreement,
  onManagePortal,
}: {
  overview: DirectorOverview;
  onOpenAgreement: () => void;
  onManagePortal: () => void;
}) {
  const a = overview.agreement;
  const days = relativeDays(a?.end_date);
  const agreementTone = !a ? BAD : a.status !== "active" && a.status !== "signed" ? WARN : days != null && days <= 30 ? WARN : GOOD;
  const portalPeople = overview.portal.people;
  return (
    <Section icon={FileText} title="Agreement and access">
      <button type="button" onClick={onOpenAgreement} className="w-full rounded-2xl p-4 text-left transition hover:opacity-90" style={{ background: SOFT }}>
        <p className="text-xs font-medium" style={{ color: MUTED }}>Service agreement{a?.number ? ` ${a.number}` : ""}</p>
        <p className="mt-0.5 text-sm font-semibold" style={{ color: agreementTone }}>
          {!a ? "None on file" : a.status === "active" || a.status === "signed" ? `Active until ${formatDate(a.end_date)}` : `${a.status[0].toUpperCase()}${a.status.slice(1)}`}
        </p>
        {a?.signed_date && <p className="mt-0.5 text-xs" style={{ color: MUTED }}>Signed {formatDate(a.signed_date)}</p>}
      </button>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium" style={{ color: TEXT }}>Portal access</p>
          <LinkButton onClick={onManagePortal}>Manage</LinkButton>
        </div>
        {portalPeople.length ? (
          <ul className="mt-1 space-y-1">
            {portalPeople.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate" style={{ color: TEXT }}>{p.name ?? "Unnamed"}{p.relationship ? <span style={{ color: MUTED }}> · {p.relationship}</span> : null}</span>
                <span className="shrink-0 text-xs" style={{ color: p.status === "active" ? GOOD : WARN }}>{p.status === "active" ? "Active" : "Invited"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm" style={{ color: MUTED }}>
            {overview.portal.status === "not_using" ? "Recorded as not using the portal." : "No one has portal access yet."}
          </p>
        )}
      </div>
    </Section>
  );
}

export function AuditPanel({ participantId, onSeeAll }: { participantId: string; onSeeAll: () => void }) {
  const trail = useOrgQuery(["director-participant", participantId, "audit"], { queryFn: () => getAuditTrail(participantId) });
  const entries = (trail.data?.entries ?? []).slice(0, 6);
  return (
    <Section icon={History} title="Audit trail" action={<LinkButton onClick={onSeeAll}>Full history</LinkButton>}>
      {trail.isLoading ? (
        <Skeleton className="h-28 w-full rounded-2xl" />
      ) : entries.length === 0 ? (
        <p className="text-sm" style={{ color: MUTED }}>No changes recorded yet.</p>
      ) : (
        <AuditList entries={entries} />
      )}
    </Section>
  );
}

export function AuditList({ entries }: { entries: { id: string; when: string; who: string; what: string; kind: string }[] }) {
  return (
    <ol className="space-y-3">
      {entries.map((e) => (
        <li key={e.id} className="flex gap-3">
          <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: e.kind === "view" ? "var(--cc-muted)" : PLUM }} />
          <div className="min-w-0">
            <p className="text-sm" style={{ color: TEXT }}>
              <span className="font-medium">{e.who}</span>{" "}
              <span style={{ color: MUTED }}>{/^[A-Z][a-z]/.test(e.what) ? e.what.charAt(0).toLowerCase() + e.what.slice(1) : e.what}</span>
            </p>
            <p className="text-xs" style={{ color: MUTED }} title={new Date(e.when).toLocaleString("en-AU")}>{timeAgo(e.when)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
