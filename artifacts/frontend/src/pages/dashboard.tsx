import { Link } from "wouter";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useDashboardRealtime } from "@/hooks/useDashboardRealtime";
import { format, parseISO } from "date-fns";
import { useState, type ComponentType } from "react";
import { ComplianceDetailCard } from "@/components/compliance/ComplianceDetailCard";
import { ComplianceTrendChart } from "@/components/compliance/ComplianceTrendChart";
import { DashboardActionItems } from "@/components/dashboard/DashboardActionItems";
import { DashboardComplianceAlerts } from "@/components/dashboard/DashboardComplianceAlerts";
import { DashboardShiftsWidget } from "@/components/dashboard/DashboardShiftsWidget";
import { PlanMeetingsPendingBanner } from "@/components/dashboard/PlanMeetingsPendingBanner";
import { DayShiftTimeline } from "@/components/dashboard/DayShiftTimeline";
import { NextShiftCard } from "@/components/dashboard/NextShiftCard";
import { ActionQueue } from "@/components/dashboard/coordinator/ActionQueue";
import { StaffCompliancePanel } from "@/components/dashboard/coordinator/StaffCompliancePanel";
import { DESIGN_SYSTEM as DS, getStatusColor } from "@/lib/design-system";
import { PageHeader } from "@/components/healthcare/PageHeader";
import { Button } from "@/components/ui/button";
import { KpiCard, KpiGrid, type StatTone } from "@/components/ui/stat-card";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileText,
  ShieldCheck,
  Users,
  BadgeCheck,
  GraduationCap,
  LayoutDashboard,
  TrendingUp,
  HeartHandshake,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  getCoordinatorDashboard,
  getWorkerDashboard,
  getWorkerLandingDashboard,
  type CoordinatorDashboard,
  type DashboardClient,
  type DashboardSession,
  type WorkerDashboard,
  type WorkerLandingDashboard,
} from "@/services/dashboardService";
import { getWorkerComplianceDetail } from "@/services/workerService";
import {
  getCoordinatorFlaggedSessions,
  getCoordinatorCredentialAlerts,
  type FlaggedSession,
  type CredentialAlert,
} from "@/services/coordinatorService";

// Design system tokens (replaces hardcoded colors)
const TEXT = DS.TEXT.primary;
const MUTED = DS.TEXT.muted;
const BORDER = DS.BORDER.light;
const SOFT = DS.BACKGROUND.section;
const PLUM = DS.BRAND.primary;
const CORAL = DS.BRAND.secondary;

function safeDate(value?: string | null, fallback = "Not recorded") {
  if (!value) return fallback;
  try {
    return format(parseISO(value), "MMM d");
  } catch {
    return value;
  }
}

function statusTone(status?: string) {
  const tone =
    status === "compliant"
      ? "success"
      : status === "non_compliant"
        ? "critical"
        : status === "draft"
          ? "info"
          : "warning";
  return `border px-2.5 py-1 text-[11px] font-bold cc-status-${tone}`;
}

function DashboardStatCard({
  label,
  value,
  caption,
  icon: Icon,
  valueColor = TEXT,
  captionColor = MUTED,
}: {
  label: string;
  value: number | string;
  caption: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  valueColor?: string;
  captionColor?: string;
}) {
  return (
    <section 
      className="rounded-lg border bg-white p-4 transition-shadow hover:shadow-md"
      style={{ 
        borderColor: BORDER,
        boxShadow: DS.SHADOWS.card,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: MUTED }}>
            {label}
          </p>
          <p className="mt-1.5 text-2xl font-black tracking-tight" style={{ color: valueColor }}>
            {value}
          </p>
        </div>
        <div 
          className="flex h-11 w-11 items-center justify-center rounded-lg"
          style={{ 
            background: DS.STATUS_BG.info,
            color: DS.STATUS.info,
          }}
        >
          <Icon size={20} strokeWidth={2.5} />
        </div>
      </div>
      <p className="mt-3 text-sm font-medium" style={{ color: captionColor }}>
        {caption}
      </p>
    </section>
  );
}

function ClientListCard({ clients }: { clients: DashboardClient[] }) {
  const { translate, translateParams } = useAccessibility();

  return (
    <section
      className="rounded-lg border bg-white p-6"
      style={{
        borderColor: BORDER,
        boxShadow: DS.SHADOWS.card,
      }}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-black" style={{ color: TEXT }}>{translate("dashboard.todaysClients")}</h2>
        <Link href="/my-clients" className="text-sm font-bold hover:opacity-75 transition-opacity" style={{ color: PLUM }}>{translate("dashboard.myClients")}</Link>
      </div>
      <div className="max-h-72 overflow-y-auto overscroll-y-contain pr-1 space-y-3">
        {clients.length === 0 && (
          <p className="rounded-lg bg-[#F4EDE6] px-4 py-3 text-sm font-medium" style={{ color: MUTED }}>
            {translate("dashboard.noClientsToday")}
          </p>
        )}
        {clients.map((client) => (
          <Link key={client.id} href={`/my-clients/${client.id}`}>
            <div className="flex items-center gap-3 rounded-lg border border-transparent p-3 transition hover:border-[#FADAE4] hover:bg-[#F8F6FE]">
              <div className="grid h-10 w-10 place-items-center rounded-full text-sm font-black text-white" style={{ background: "var(--cc-text)" }}>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black" style={{ color: TEXT }}>{client.full_name}</p>
                <p className="truncate text-xs font-medium" style={{ color: MUTED }}>
                  {client.plan_management_type} ·{" "}
                  {client.last_seen
                    ? translateParams("clients.lastSeenOn", { date: safeDate(client.last_seen) })
                    : translate("clients.notSeenYet")}
                </p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusTone(client.compliance_status)}`}>
                {client.compliance_status?.replace("_", " ")}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function SessionListCard({ title, sessions }: { title: string; sessions: DashboardSession[] }) {
  return (
    <section
      className="rounded-lg border bg-white p-5"
      style={{
        borderColor: BORDER,
        boxShadow: DS.SHADOWS.card,
      }}
    >
      <h2 className="mb-3 text-sm font-black" style={{ color: TEXT }}>{title}</h2>
      <div className="max-h-72 overflow-y-auto overscroll-y-contain pr-1 space-y-2">
        {sessions.length === 0 && <p className="text-xs font-medium" style={{ color: MUTED }}>No records need attention.</p>}
        {sessions.map((session) => (
          <div key={session.id} className="rounded-lg border p-2.5" style={{ borderColor: "#EDE3FC" }}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-bold" style={{ color: TEXT }}>
                  {session.participant_name || "Participant"}
                </p>
                <p className="text-xs font-medium capitalize" style={{ color: MUTED }}>
                  {safeDate(session.session_date)} · {(session.session_type || "session").replace("_", " ")}
                </p>
              </div>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusTone(session.compliance_status)}`}>
                {session.compliance_score ?? "Draft"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function initials(name?: string | null) {
  return (name || "Participant")
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function sessionTime(value?: string | null) {
  if (!value) return "Time not recorded";
  try {
    return format(parseISO(value), "h:mm a");
  } catch {
    return safeDate(value);
  }
}

function statusLabel(session: DashboardSession) {
  if (session.status && session.status !== "completed") return session.status.replace("_", " ");
  if (session.compliance_status === "compliant") return "Done";
  if (session.compliance_status === "non_compliant") return "RP Flag";
  if (session.compliance_status === "at_risk") return "Note Due";
  return "Upcoming";
}

// -- Shared empty state --------------------------------------------------------
function TabEmptyState({
  icon: Icon,
  message,
  sub,
}: {
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  message: string;
  sub: string;
}) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <Icon size={28} className="mb-3" style={{ color: DS.STATUS.success }} />
      <p className="text-sm font-black" style={{ color: TEXT }}>{message}</p>
      <p className="mt-1 text-xs font-medium max-w-[260px]" style={{ color: MUTED }}>{sub}</p>
    </div>
  );
}

// -- Tab: Team Compliance ------------------------------------------------------
function ComplianceTabContent({ data }: { data: CoordinatorDashboard }) {
  const breakdown = data.team_compliance_breakdown ?? { compliant: 0, at_risk: 0, non_compliant: 0 };
  const score     = Math.max(0, Math.min(100, data.team_compliance_score || 0));
  const status    = score >= 85 ? "Compliant" : score >= 60 ? "At Risk" : "Non-Compliant";
  const total     = breakdown.compliant + breakdown.at_risk + breakdown.non_compliant;

  const bands = [
    { label: "Compliant",      value: breakdown.compliant,     color: "#059669", bg: "rgba(5,150,105,0.08)"  },
    { label: "At Risk",        value: breakdown.at_risk,       color: "#D97706", bg: "rgba(217,119,6,0.08)"  },
    { label: "Non-Compliant",  value: breakdown.non_compliant, color: "#DC2626", bg: "rgba(220,38,38,0.08)"  },
  ];

  return (
    <div className="grid md:grid-cols-2 gap-5 items-start">

      {/* LEFT — score ring + breakdown bars */}
      <div className="space-y-4">
        {/* Ring + numbers */}
        <div className="flex items-center gap-5">
          <div
            className="relative shrink-0 grid h-20 w-20 place-items-center rounded-full"
            style={{ background: `conic-gradient(${PLUM} ${score * 3.6}deg, #F2EBFD 0deg)` }}
          >
            <div className="grid h-13 w-13 place-items-center rounded-full bg-white" style={{ width: 52, height: 52 }}>
              <div className="text-center">
                <span className="block text-lg font-black leading-none" style={{ color: PLUM }}>{score}</span>
                <span className="block text-[8px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>score</span>
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-1.5">
            {bands.map(({ label, value, color }) => (
              <div key={label} className="flex items-center justify-between text-[13px]">
                <span className="font-medium" style={{ color: MUTED }}>{label}</span>
                <span className="font-black tabular-nums" style={{ color }}>{value}</span>
              </div>
            ))}
            <div className="pt-1">
              <span
                className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-black"
                style={{
                  background: DS.STATUS_BG[score >= 85 ? "success" : score >= 60 ? "warning" : "critical"],
                  color: getStatusColor(status),
                }}
              >
                {status} · {score}/100
              </span>
            </div>
          </div>
        </div>

        {/* Progress bars */}
        {total > 0 && (
          <div className="space-y-2">
            {bands.map(({ label, value, color, bg }) => {
              const pct = total > 0 ? Math.round((value / total) * 100) : 0;
              return (
                <div key={label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-medium" style={{ color: MUTED }}>{label}</span>
                    <span className="text-[11px] font-black tabular-nums" style={{ color }}>{pct}%</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: bg }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Link to full compliance page */}
        <Link href="/compliance">
          <span className="inline-flex items-center gap-1 text-[12px] font-black hover:opacity-75 transition" style={{ color: PLUM }}>
            View full compliance report <ArrowRight size={12} />
          </span>
        </Link>
      </div>

      {/* RIGHT — workers needing attention (fills the formerly empty half) */}
      <div>
        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>
          Workers needing attention
        </p>
        {data.workers_needing_attention.length === 0 ? (
          <div className="rounded-xl px-4 py-5 text-center" style={{ background: DS.BACKGROUND.section }}>
            <ShieldCheck size={22} className="mx-auto mb-1.5 opacity-30" style={{ color: PLUM }} />
            <p className="text-sm font-semibold" style={{ color: TEXT }}>All clear</p>
            <p className="text-xs mt-0.5" style={{ color: MUTED }}>No compliance issues open.</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {data.workers_needing_attention.slice(0, 7).map((worker) => (
              <Link key={worker.id} href="/team">
                <div className="flex items-center gap-3 py-2.5 hover:bg-[#F4EDE6] rounded-lg px-2 -mx-2 transition cursor-pointer">
                  <div
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-black text-white"
                    style={{ background: "var(--cc-text)" }}
                  >
                    {initials(worker.full_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black" style={{ color: TEXT }}>{worker.full_name}</p>
                    <p className="truncate text-xs font-medium" style={{ color: MUTED }}>{worker.reason || "Compliance review required"}</p>
                  </div>
                  <ArrowRight size={13} className="shrink-0" style={{ color: MUTED }} />
                </div>
              </Link>
            ))}
            {data.workers_needing_attention.length > 7 && (
              <Link href="/compliance">
                <p className="text-center text-xs font-black pt-3 pb-1 hover:opacity-75 transition" style={{ color: PLUM }}>
                  View all {data.workers_needing_attention.length} workers ?
                </p>
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// -- Tab: Flagged Sessions -----------------------------------------------------
function FlaggedTabContent({ sessions }: { sessions: FlaggedSession[] }) {
  if (sessions.length === 0) {
    return <TabEmptyState icon={CheckCircle2} message="All sessions reviewed" sub="No sessions are currently flagged for coordinator review." />;
  }

  const scored   = sessions.filter((s) => s.compliance_score != null);
  const avgScore = scored.length > 0
    ? Math.round(scored.reduce((sum, s) => sum + (s.compliance_score ?? 0), 0) / scored.length)
    : null;
  const critical = sessions.filter((s) => s.compliance_score != null && s.compliance_score < 60).length;

  return (
    <div className="grid md:grid-cols-2 gap-5 items-start">
      {/* LEFT — divide-y row list */}
      <div>
        <div className="divide-y" style={{ borderColor: BORDER }}>
          {sessions.slice(0, 7).map((s) => {
            const cs = s.compliance_score;
            const scoreBg    = cs == null ? "#F3F4F6" : cs >= 85 ? "rgba(16,185,129,0.10)" : cs >= 60 ? "rgba(245,158,11,0.10)" : "rgba(239,68,68,0.10)";
            const scoreColor = cs == null ? MUTED      : cs >= 85 ? "#059669"                : cs >= 60 ? "#D97706"                  : "#DC2626";
            return (
              <Link key={s.id} href="/session-review">
                <div className="flex items-center gap-3 py-2.5 hover:bg-[#F4EDE6] rounded-lg px-2 -mx-2 transition cursor-pointer">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-black text-white" style={{ background: "var(--cc-text)" }}>
                    {initials(s.participant_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black" style={{ color: TEXT }}>{s.participant_name || "Participant"}</p>
                    <p className="truncate text-xs font-medium" style={{ color: MUTED }}>
                      {safeDate(s.session_date)} · {(s.session_type || "session").replace(/_/g, " ")}
                      {s.review_note ? ` — "${s.review_note.slice(0, 30)}…"` : ""}
                    </p>
                  </div>
                  {cs != null && (
                    <span className="shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: scoreBg, color: scoreColor }}>
                      {cs}%
                    </span>
                  )}
                  <ArrowRight size={13} className="shrink-0" style={{ color: MUTED }} />
                </div>
              </Link>
            );
          })}
        </div>
        {sessions.length > 7 && (
          <Link href="/session-review">
            <p className="text-center text-xs font-black pt-3 pb-1 hover:opacity-75 transition" style={{ color: PLUM }}>
              View all {sessions.length} flagged sessions ?
            </p>
          </Link>
        )}
      </div>

      {/* RIGHT — summary panel */}
      <div className="space-y-3">
        <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>Overview</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl p-3 text-center" style={{ background: DS.BACKGROUND.section }}>
            <p className="text-2xl font-black" style={{ color: PLUM }}>{sessions.length}</p>
            <p className="text-[10px] font-medium mt-0.5" style={{ color: MUTED }}>Total flagged</p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: critical > 0 ? "rgba(239,68,68,0.06)" : DS.BACKGROUND.section }}>
            <p className="text-2xl font-black" style={{ color: critical > 0 ? "#DC2626" : MUTED }}>{critical}</p>
            <p className="text-[10px] font-medium mt-0.5" style={{ color: MUTED }}>Below 60%</p>
          </div>
        </div>
        {avgScore != null && (
          <div className="rounded-xl px-4 py-3" style={{ background: DS.BACKGROUND.section }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium" style={{ color: MUTED }}>Avg score</span>
              <span className="text-[11px] font-black" style={{ color: avgScore >= 85 ? "#059669" : avgScore >= 60 ? "#D97706" : "#DC2626" }}>{avgScore}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(55,48,163,0.08)" }}>
              <div className="h-full rounded-full" style={{ width: `${avgScore}%`, background: avgScore >= 85 ? "#059669" : avgScore >= 60 ? "#D97706" : "#DC2626" }} />
            </div>
          </div>
        )}
        <Link href="/session-review">
          <span className="inline-flex items-center gap-1 text-[12px] font-black hover:opacity-75 transition" style={{ color: PLUM }}>
            Open session review <ArrowRight size={12} />
          </span>
        </Link>
      </div>
    </div>
  );
}

// -- Tab: Incidents ------------------------------------------------------------
function IncidentsTabContent({ incidents }: { incidents: Array<Record<string, unknown>> }) {
  if (incidents.length === 0) {
    return <TabEmptyState icon={CheckCircle2} message="No pending incidents" sub="All incidents have been resolved or no new reports filed." />;
  }

  const openCount     = incidents.filter((i) => { const s = String(i.status ?? ""); return s === "open" || s === "pending"; }).length;
  const resolvedCount = incidents.length - openCount;

  return (
    <div className="grid md:grid-cols-2 gap-5 items-start">
      {/* LEFT — divide-y row list */}
      <div>
        <div className="divide-y" style={{ borderColor: BORDER }}>
          {incidents.slice(0, 7).map((inc, idx) => {
            const id          = String(inc.id ?? "");
            const title       = String(inc.title ?? inc.type ?? inc.incident_type ?? "Incident report");
            const dateVal     = String(inc.date ?? inc.incident_date ?? inc.created_at ?? "");
            const status      = String(inc.status ?? "pending");
            const participant = String(inc.participant_name ?? inc.participant ?? "");
            const open        = status === "open" || status === "pending";
            return (
              <Link key={id || idx} href={id ? `/incidents/${id}` : "/incidents"}>
                <div className="flex items-center gap-3 py-2.5 hover:bg-[#F4EDE6] rounded-lg px-2 -mx-2 transition cursor-pointer">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: "rgba(245,158,11,0.10)" }}>
                    <AlertTriangle size={13} style={{ color: DS.STATUS.warning }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black" style={{ color: TEXT }}>{title}</p>
                    <p className="truncate text-xs font-medium" style={{ color: MUTED }}>
                      {participant ? `${participant} · ` : ""}{safeDate(dateVal)}
                    </p>
                  </div>
                  <span
                    className="shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full capitalize"
                    style={{
                      background: open ? "rgba(245,158,11,0.10)" : "rgba(107,114,128,0.08)",
                      color: open ? DS.STATUS.warning : MUTED,
                    }}
                  >
                    {status}
                  </span>
                  <ArrowRight size={13} className="shrink-0" style={{ color: MUTED }} />
                </div>
              </Link>
            );
          })}
        </div>
        {incidents.length > 7 && (
          <Link href="/incidents">
            <p className="text-center text-xs font-black pt-3 pb-1 hover:opacity-75 transition" style={{ color: PLUM }}>
              View all {incidents.length} incidents ?
            </p>
          </Link>
        )}
      </div>

      {/* RIGHT — summary panel */}
      <div className="space-y-3">
        <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>Status breakdown</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl p-3 text-center" style={{ background: "rgba(245,158,11,0.06)" }}>
            <p className="text-2xl font-black" style={{ color: DS.STATUS.warning }}>{openCount}</p>
            <p className="text-[10px] font-medium mt-0.5" style={{ color: MUTED }}>Open / Pending</p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: DS.BACKGROUND.section }}>
            <p className="text-2xl font-black" style={{ color: resolvedCount > 0 ? "#059669" : MUTED }}>{resolvedCount}</p>
            <p className="text-[10px] font-medium mt-0.5" style={{ color: MUTED }}>Resolved</p>
          </div>
        </div>
        <div className="rounded-xl px-4 py-3" style={{ background: DS.BACKGROUND.section }}>
          <p className="text-[11px] font-black mb-1" style={{ color: TEXT }}>{incidents.length} total incident{incidents.length !== 1 ? "s" : ""}</p>
          <p className="text-[11px] font-medium leading-relaxed" style={{ color: MUTED }}>
            All open incidents require coordinator review and documentation before closure.
          </p>
        </div>
        <Link href="/incidents">
          <span className="inline-flex items-center gap-1 text-[12px] font-black hover:opacity-75 transition" style={{ color: PLUM }}>
            View all incidents <ArrowRight size={12} />
          </span>
        </Link>
      </div>
    </div>
  );
}

// -- Tab: Credentials ----------------------------------------------------------
function CredentialsTabContent({ alerts }: { alerts: CredentialAlert[] }) {
  if (alerts.length === 0) {
    return <TabEmptyState icon={CheckCircle2} message="All credentials up to date" sub="No team credentials are expiring within 30 days." />;
  }

  const expiredCount  = alerts.filter((a) => {
    const d = a.expiry_date ? Math.ceil((new Date(a.expiry_date).getTime() - Date.now()) / 86_400_000) : null;
    return d !== null && d <= 0;
  }).length;
  const urgentCount   = alerts.filter((a) => {
    const d = a.expiry_date ? Math.ceil((new Date(a.expiry_date).getTime() - Date.now()) / 86_400_000) : null;
    return d !== null && d > 0 && d <= 14;
  }).length;
  const upcomingCount = alerts.length - expiredCount - urgentCount;

  return (
    <div className="grid md:grid-cols-2 gap-5 items-start">
      {/* LEFT — divide-y row list */}
      <div>
        <div className="divide-y" style={{ borderColor: BORDER }}>
          {alerts.slice(0, 7).map((alert, idx) => {
            const daysLeft   = alert.expiry_date
              ? Math.ceil((new Date(alert.expiry_date).getTime() - Date.now()) / 86_400_000)
              : null;
            const expired    = daysLeft !== null && daysLeft <= 0;
            const alertBg    = expired ? "rgba(239,68,68,0.08)"  : "rgba(245,158,11,0.08)";
            const alertColor = expired ? DS.STATUS.critical       : DS.STATUS.warning;
            return (
              <Link key={alert.credential_id ?? idx} href={alert.user_id ? `/team?workerId=${alert.user_id}&tab=credentials` : "/team"}>
                <div className="flex items-center gap-3 py-2.5 hover:bg-[#F4EDE6] rounded-lg px-2 -mx-2 transition cursor-pointer">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: alertBg }}>
                    <BadgeCheck size={13} style={{ color: alertColor }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black" style={{ color: TEXT }}>{alert.full_name || "Team member"}</p>
                    <p className="truncate text-xs font-medium" style={{ color: MUTED }}>
                      {alert.credential_type || alert.title || "Credential"} · Expires {safeDate(alert.expiry_date)}
                    </p>
                  </div>
                  {daysLeft !== null && (
                    <span
                      className="shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full whitespace-nowrap"
                      style={{ background: alertBg, color: alertColor }}
                    >
                      {expired ? "Expired" : `${daysLeft}d left`}
                    </span>
                  )}
                  <ArrowRight size={13} className="shrink-0" style={{ color: MUTED }} />
                </div>
              </Link>
            );
          })}
        </div>
        {alerts.length > 7 && (
          <Link href="/team">
            <p className="text-center text-xs font-black pt-3 pb-1 hover:opacity-75 transition" style={{ color: PLUM }}>
              View all {alerts.length} expiring credentials ?
            </p>
          </Link>
        )}
      </div>

      {/* RIGHT — summary panel */}
      <div className="space-y-3">
        <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>Expiry breakdown</p>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl p-3 text-center" style={{ background: expiredCount > 0 ? "rgba(239,68,68,0.06)" : DS.BACKGROUND.section }}>
            <p className="text-xl font-black" style={{ color: expiredCount > 0 ? "#DC2626" : MUTED }}>{expiredCount}</p>
            <p className="text-[9px] font-bold uppercase mt-0.5" style={{ color: MUTED }}>Expired</p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: urgentCount > 0 ? "rgba(245,158,11,0.06)" : DS.BACKGROUND.section }}>
            <p className="text-xl font-black" style={{ color: urgentCount > 0 ? "#D97706" : MUTED }}>{urgentCount}</p>
            <p className="text-[9px] font-bold uppercase mt-0.5" style={{ color: MUTED }}>= 14 days</p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: DS.BACKGROUND.section }}>
            <p className="text-xl font-black" style={{ color: MUTED }}>{upcomingCount}</p>
            <p className="text-[9px] font-bold uppercase mt-0.5" style={{ color: MUTED }}>Upcoming</p>
          </div>
        </div>
        {expiredCount > 0 && (
          <div className="rounded-xl px-4 py-3" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)" }}>
            <p className="text-[11px] font-black" style={{ color: "#DC2626" }}>
              {expiredCount} credential{expiredCount !== 1 ? "s" : ""} already expired
            </p>
            <p className="text-[11px] font-medium mt-0.5" style={{ color: MUTED }}>
              Workers with expired credentials cannot legally deliver services.
            </p>
          </div>
        )}
        <Link href="/team">
          <span className="inline-flex items-center gap-1 text-[12px] font-black hover:opacity-75 transition" style={{ color: PLUM }}>
            Manage credentials <ArrowRight size={12} />
          </span>
        </Link>
      </div>
    </div>
  );
}

// -- Tab: Training -------------------------------------------------------------
function TrainingTabContent({
  count,
  alerts,
}: {
  count: number;
  alerts: CredentialAlert[];
}) {
  const trainingAlerts = alerts.filter(
    (a) =>
      (a.credential_type || a.title || "").toLowerCase().includes("train") ||
      (a.credential_type || a.title || "").toLowerCase().includes("cert") ||
      (a.credential_type || a.title || "").toLowerCase().includes("course"),
  );

  if (count === 0 && trainingAlerts.length === 0) {
    return <TabEmptyState icon={CheckCircle2} message="All training up to date" sub="No team members have overdue or upcoming training." />;
  }

  return (
    <div className="space-y-4">
      {/* Summary banner */}
      <div
        className="flex items-center gap-3 rounded-xl px-4 py-3"
        style={{ background: count > 0 ? "rgba(245,158,11,0.08)" : DS.BACKGROUND.section, borderColor: count > 0 ? "rgba(245,158,11,0.20)" : BORDER, border: "1px solid" }}
      >
        <GraduationCap size={18} style={{ color: count > 0 ? DS.STATUS.warning : DS.STATUS.success }} />
        <div className="flex-1">
          <p className="text-sm font-black" style={{ color: TEXT }}>
            {count > 0 ? `${count} team member${count !== 1 ? "s" : ""} with training due` : "Training is up to date"}
          </p>
          <p className="text-xs font-medium" style={{ color: MUTED }}>Manage training records and certifications in the Toolkit</p>
        </div>
        <Link href="/toolkit">
          <span className="text-xs font-black px-3 py-1.5 rounded-lg text-white transition hover:opacity-90" style={{ background: "var(--cc-cta)" }}>
            Open Toolkit
          </span>
        </Link>
      </div>

      {/* Training-type credential alerts */}
      {trainingAlerts.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-2">
          {trainingAlerts.slice(0, 6).map((alert, idx) => {
            const daysLeft = alert.expiry_date
              ? Math.ceil((new Date(alert.expiry_date).getTime() - Date.now()) / 86_400_000)
              : null;
            const urgent   = daysLeft !== null && daysLeft <= 14;
            const expired  = daysLeft !== null && daysLeft <= 0;
            return (
              <Link key={alert.credential_id ?? idx} href="/toolkit">
                <div
                  className="flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer hover:bg-[#F4EDE6]"
                  style={{ borderColor: BORDER }}
                >
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: "rgba(245,158,11,0.08)" }}>
                    <GraduationCap size={13} style={{ color: DS.STATUS.warning }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black" style={{ color: TEXT }}>{alert.full_name || "Team member"}</p>
                    <p className="truncate text-xs font-medium" style={{ color: MUTED }}>
                      {alert.credential_type || alert.title}
                    </p>
                    <p className="text-[10px] font-medium mt-0.5" style={{ color: MUTED }}>
                      {safeDate(alert.expiry_date)}
                    </p>
                  </div>
                  {daysLeft !== null && (
                    <span
                      className="shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full"
                      style={{
                        background: urgent ? "rgba(239,68,68,0.10)" : "rgba(245,158,11,0.10)",
                        color: urgent ? DS.STATUS.critical : DS.STATUS.warning,
                      }}
                    >
                      {expired ? "Expired" : `${daysLeft}d`}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// -- Main Action Hub -----------------------------------------------------------
type ActionTabId = "compliance" | "flagged" | "incidents" | "credentials" | "training";

function CoordinatorActionHub({ data }: { data: CoordinatorDashboard }) {
  const [activeTab, setActiveTab] = useState<ActionTabId>("compliance");

  const { data: flaggedSessions = [] } = useOrgQuery(["coordinator-flagged-sessions"], {
    queryFn: getCoordinatorFlaggedSessions,
    staleTime: 60_000,
  });

  const { data: credentialData } = useOrgQuery(["coordinator-credential-alerts"], {
    queryFn: getCoordinatorCredentialAlerts,
    staleTime: 5 * 60_000,
  });

  const flaggedCount    = flaggedSessions.length;
  const incidentCount   = (data.incident_alerts ?? []).length;
  const credentialCount = (credentialData?.alerts ?? (data.credential_alerts ?? [])).length;
  const trainingCount   = credentialData?.training_due_count ?? 0;

  const tabs: Array<{
    id: ActionTabId;
    label: string;
    icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
    count: number | null;
    level: "" | "warning" | "critical";
  }> = [
    { id: "compliance",  label: "Team Compliance",    icon: ShieldCheck,    count: null,           level: "" },
    { id: "flagged",     label: "Flagged Sessions",   icon: ClipboardCheck, count: flaggedCount,    level: flaggedCount > 0    ? "critical" : "" },
    { id: "incidents",   label: "Incidents",          icon: AlertTriangle,  count: incidentCount,   level: incidentCount > 0   ? "warning"  : "" },
    { id: "credentials", label: "Credentials",        icon: BadgeCheck,     count: credentialCount, level: credentialCount > 0 ? "critical" : "" },
    { id: "training",    label: "Training",           icon: GraduationCap,  count: trainingCount,   level: trainingCount > 0   ? "warning"  : "" },
  ];

  return (
    <section className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: BORDER }}>
      {/* Tab bar — scrollable on mobile */}
      <div className="flex border-b overflow-x-auto" style={{ borderColor: BORDER }}>
        {tabs.map(({ id, label, icon: Icon, count, level }) => {
          const active = activeTab === id;
          const alert  = level === "critical" || level === "warning";
          const fg     = level === "critical" ? DS.STATUS.critical : level === "warning" ? DS.STATUS.warning : active ? PLUM : MUTED;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className="flex items-center gap-1.5 px-4 py-3.5 text-[12px] font-black whitespace-nowrap border-b-2 transition-colors shrink-0"
              style={{
                borderBottomColor: active ? PLUM : "transparent",
                color: active ? PLUM : alert ? fg : MUTED,
                background: active ? "#F4EDE6" : "transparent",
              }}
            >
              <Icon size={13} strokeWidth={2.5} />
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{label.split(" ")[0]}</span>
              {count !== null && count > 0 && (
                <span
                  className="min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-black flex items-center justify-center text-white"
                  style={{
                    background: level === "critical" ? DS.STATUS.critical : level === "warning" ? DS.STATUS.warning : "var(--cc-text)",
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="px-4 py-3.5" key={activeTab}>
        {activeTab === "compliance"  && <ComplianceTabContent  data={data} />}
        {activeTab === "flagged"     && <FlaggedTabContent     sessions={flaggedSessions} />}
        {activeTab === "incidents"   && <IncidentsTabContent   incidents={data.incident_alerts ?? []} />}
        {activeTab === "credentials" && <CredentialsTabContent alerts={credentialData?.alerts ?? (data.credential_alerts as CredentialAlert[] | undefined) ?? []} />}
        {activeTab === "training"    && <TrainingTabContent    count={trainingCount} alerts={credentialData?.alerts ?? []} />}
      </div>
    </section>
  );
}

function CoordinatorSessionsCard({ sessions }: { sessions: DashboardSession[] }) {
  return (
    <section className="rounded-xl border bg-white overflow-hidden xl:self-start" style={{ borderColor: BORDER }}>
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b" style={{ borderColor: BORDER }}>
        <h2 className="text-[14px] font-black" style={{ color: TEXT }}>Today's sessions</h2>
        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-black" style={{ background: SOFT, color: PLUM }}>
          {sessions.length}
        </span>
      </div>
      <div className="max-h-72 overflow-y-auto overscroll-y-contain px-5 py-4 space-y-3">
        {sessions.length === 0 && (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full" style={{ background: SOFT }}>
              <CalendarDays size={20} style={{ color: MUTED }} />
            </div>
            <p className="text-sm font-black" style={{ color: TEXT }}>No sessions today</p>
            <p className="mt-1 max-w-[200px] text-xs font-medium" style={{ color: MUTED }}>
              Your team has a clear schedule. Plan ahead for the week.
            </p>
            <Link href="/coordinator/rostering">
              <span className="mt-3 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-black transition hover:opacity-80" style={{ background: "var(--cc-active-bg)", color: PLUM }}>
                Open schedule <ArrowRight size={10} />
              </span>
            </Link>
          </div>
        )}
        {sessions.slice(0, 8).map((session) => (
          <div key={session.id} className="flex items-center gap-3 border-t pt-3 first:border-t-0 first:pt-0" style={{ borderColor: BORDER }}>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-black text-white" style={{ background: "var(--cc-text)" }}>
              {initials(session.participant_name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black" style={{ color: TEXT }}>{session.participant_name || "Participant"}</p>
              <p className="truncate text-xs font-medium capitalize" style={{ color: MUTED }}>
                {(session.session_type || "session").replace("_", " ")} · {sessionTime(session.session_date)}
              </p>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black capitalize ${statusTone(session.compliance_status)}`}>
              {statusLabel(session)}
            </span>
          </div>
        ))}
      </div>
      {sessions.length > 0 && (
        <div className="border-t px-5 py-3 text-center" style={{ borderColor: BORDER }}>
          <Link href="/sessions">
            <span className="text-[12px] font-black transition hover:opacity-75" style={{ color: PLUM }}>
              View all sessions →
            </span>
          </Link>
        </div>
      )}
    </section>
  );
}

function CoordinatorCommonIssuesCard({ issues }: { issues: CoordinatorDashboard["common_issues"] }) {
  const max = Math.max(...issues.map((issue) => issue.count), 1);
  return (
    <section
      className="rounded-lg border bg-white p-5"
      style={{
        borderColor: BORDER,
        boxShadow: DS.SHADOWS.card,
      }}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-black" style={{ color: TEXT }}>Most common issues</h2>
        <Link href="/compliance" className="text-xs font-bold hover:opacity-75 transition-opacity" style={{ color: PLUM }}>View full report</Link>
      </div>
      <div className="max-h-72 overflow-y-auto overscroll-y-contain pr-1 space-y-3">
        {issues.length === 0 && (
          <div className="flex items-center gap-3 rounded-lg px-4 py-3" style={{ background: DS.BACKGROUND.section }}>
            <CheckCircle2 size={18} className="shrink-0" style={{ color: "var(--cc-status-success)" }} />
            <p className="text-sm font-medium" style={{ color: MUTED }}>
              No recurring compliance issues across your team. Keep it up.
            </p>
          </div>
        )}
        {issues.map((issue, index) => (
          <div key={issue.issue} className="grid grid-cols-[150px_1fr_32px] items-center gap-3 text-sm">
            <p className="truncate font-bold" style={{ color: TEXT }}>{issue.issue}</p>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: DS.STATUS_BG.info }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(8, Math.round((issue.count / max) * 100))}%`,
                  background: index === issues.length - 1 ? DS.STATUS.warning : "var(--cc-text)",
                }}
              />
            </div>
            <span className="text-right text-xs font-black" style={{ color: MUTED }}>{issue.count}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function WorkerStatCard({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: number | string;
  variant?: "default" | "warning" | "critical";
}) {
  const valueColor =
    variant === "warning"
      ? "var(--cc-status-warning)"
      : variant === "critical"
        ? "var(--cc-status-critical)"
        : "var(--cc-plum)";
  return (
    <div
      className="rounded-2xl border bg-cc-surface px-4 py-4 text-center shadow-sm transition-shadow hover:shadow-md"
      style={{ borderColor: "var(--cc-border)" }}
    >
      <p className="text-2xl font-black" style={{ color: valueColor }}>{value}</p>
      <p className="mt-1 text-xs font-semibold leading-tight" style={{ color: "var(--cc-muted)" }}>{label}</p>
    </div>
  );
}

function WorkerDashboardView({
  data,
  landing,
}: {
  data: WorkerDashboard;
  landing: WorkerLandingDashboard | null;
}) {
  const [trendDays, setTrendDays] = useState<7 | 30>(7);
  const { user } = useAuth();
  const { translate } = useAccessibility();
  const firstName = (user?.full_name || "there").split(" ")[0];
  const dateLabel = format(new Date(), "EEEE d MMMM");

  const complianceQuery = useOrgQuery(["worker", "compliance-detail", trendDays], {
    queryFn: () => getWorkerComplianceDetail(trendDays),
  });
  const todayClients = data.today_clients.length ? data.today_clients : data.assigned_clients.slice(0, 4);
  const complianceDetail = complianceQuery.data;

  return (
    <div className="space-y-5 pb-6">
      {/* Greeting header — consistent with My Shifts page */}
      <header className="flex items-start justify-between gap-3 pt-1">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: "var(--cc-coral)" }}>
            {translate("common.supportWorker")}
          </p>
          <h1 className="mt-1 text-xl font-black tracking-tight" style={{ color: TEXT }}>
            {translate("dashboard.title")}
          </h1>
          <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>
            {dateLabel}
          </p>
        </div>
        <div className="shrink-0 pt-1">
          <Link href="/my-clients">
            <button
              type="button"
              className="flex h-11 items-center rounded-full px-4 text-xs font-black text-white shadow-sm transition hover:opacity-90"
              style={{ background: PLUM }}
            >
              {translate("dashboard.myClients")}
            </button>
          </Link>
        </div>
      </header>

      {/* Key stats — 2-col on mobile, 4-col on sm+ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <WorkerStatCard label={translate("dashboard.sessionsToday")} value={data.sessions_today} />
        <WorkerStatCard
          label={translate("dashboard.notesDue")}
          value={data.notes_due}
          variant={data.notes_due > 0 ? "warning" : "default"}
        />
        <WorkerStatCard label={translate("dashboard.myClients")} value={data.assigned_clients.length} />
        <WorkerStatCard
          label={translate("dashboard.pendingFixes")}
          value={data.pending_compliance_fixes.length}
          variant={data.pending_compliance_fixes.length > 0 ? "critical" : "default"}
        />
      </div>

      {landing && (
        <>
          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <NextShiftCard shift={landing.next_shift} />
            <DayShiftTimeline shifts={landing.today_shifts} nextShiftId={landing.next_shift?.id} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            <DashboardShiftsWidget shifts={landing.today_shifts} />
            <DashboardActionItems items={landing.action_items} />
            <DashboardComplianceAlerts alerts={landing.compliance_alerts} />
          </div>
        </>
      )}

      {complianceQuery.isLoading ? (
        <div
          className="rounded-2xl border bg-white p-6 text-sm font-bold"
          style={{ borderColor: BORDER, color: MUTED }}
        >
          {translate("dashboard.loadingCompliance")}
        </div>
      ) : complianceDetail ? (
        <ComplianceDetailCard
          score={complianceDetail.score}
          status={complianceDetail.status}
          rules={complianceDetail.rules}
          failedRules={complianceDetail.failed_rules}
          title={translate("dashboard.complianceScore")}
          compact
        />
      ) : (
        <div
          className="rounded-2xl border bg-white p-6 text-sm font-bold"
          style={{ borderColor: BORDER, color: DS.STATUS.critical }}
        >
          {translate("dashboard.complianceLoadError")}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        {complianceDetail && (
          <ComplianceTrendChart
            data={complianceDetail.trend}
            days={trendDays}
            onDaysChange={setTrendDays}
          />
        )}
        <ClientListCard clients={todayClients} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SessionListCard title={translate("dashboard.incompleteSessions")} sessions={data.incomplete_sessions.slice(0, 5)} />
        <SessionListCard title={translate("dashboard.pendingCompliance")} sessions={data.pending_compliance_fixes.slice(0, 5)} />
      </div>
    </div>
  );
}


function CoordinatorDashboardView({ data }: { data: CoordinatorDashboard }) {
  const { user } = useAuth();
  const firstName = (user?.full_name || "there").split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const teamParticipants   = data.team_participants ?? data.participants ?? 0;
  const sessionsThisWeek   = data.sessions_this_week ?? data.todays_sessions.length;
  const incidentsThisMonth = data.incidents_this_month ?? (data.incident_alerts ?? []).length;
  const workersAtRisk      = data.workers_needing_support ?? data.workers_needing_attention.length;
  const score              = Math.max(0, Math.min(100, data.team_compliance_score || 0));

  const metrics: Array<{ label: string; value: string | number; sub: string; tone: StatTone; href: string; icon: React.ReactElement<{ size?: number }> }> = [
    { label: "Participants", value: teamParticipants,        sub: "Active caseload",  tone: "neutral",                                                    href: "/patients",   icon: <Users /> },
    { label: "Sessions",     value: sessionsThisWeek,        sub: "This week",        tone: "neutral",                                                    href: "/sessions",   icon: <CalendarDays /> },
    { label: "Compliance",   value: `${Math.round(score)}%`, sub: "Team average",     tone: score >= 85 ? "success" : score >= 60 ? "warning" : "danger", href: "/compliance", icon: <ShieldCheck /> },
    { label: "Incidents",    value: incidentsThisMonth,      sub: "This month",       tone: incidentsThisMonth > 0 ? "warning" : "success",               href: "/incidents",  icon: <AlertTriangle /> },
    { label: "Need support", value: workersAtRisk,           sub: "Workers flagged",  tone: workersAtRisk > 0 ? "danger" : "success",                     href: "/team",       icon: <HeartHandshake /> },
  ];

  return (
    <div className="space-y-5 pb-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
            {format(new Date(), "EEEE, d MMMM yyyy")}
          </p>
          <h1 className="mt-1 text-xl font-black tracking-tight" style={{ color: TEXT }}>
            {greeting}, {firstName}
          </h1>
          <p className="mt-0.5 text-sm font-medium" style={{ color: MUTED }}>
            {"Here's what needs your attention today"}
          </p>
        </div>
        <Link href="/team">
          <Button variant="navy" className="rounded-full shrink-0">
            <Users size={15} strokeWidth={2.5} />
            View Team
          </Button>
        </Link>
      </div>

      {/* KPI strip — each tile links to its source page */}
      <KpiGrid className="sm:grid-cols-2 lg:grid-cols-5">
        {metrics.map((m, i) => (
          <Link key={i} href={m.href}>
            <KpiCard label={m.label} value={m.value} sub={m.sub} tone={m.tone} icon={m.icon} className="cursor-pointer transition-shadow hover:shadow-md" />
          </Link>
        ))}
      </KpiGrid>

      {/* Plan meetings banner */}
      <PlanMeetingsPendingBanner />

      {/* Main layout: action feed + staff panel  |  today rail */}
      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          <ActionQueue data={data} />
          <StaffCompliancePanel data={data} />
        </div>
        <CoordinatorSessionsCard sessions={data.todays_sessions} />
      </div>

      {/* Common compliance issues */}
      <CoordinatorCommonIssuesCard issues={data.common_issues} />
    </div>
  );
}

function AlliedFallbackDashboard() {
  return (
    <div className="space-y-5 pb-8">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Overview</p>
        <h1 className="mt-1 text-xl font-black tracking-tight" style={{ color: TEXT }}>Dashboard</h1>
        <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>Quick access to your caseload, sessions and reports</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/patients"><DashboardStatCard label="Caseload" value="Open" caption="View allocated participants" icon={Users} /></Link>
        <Link href="/sessions"><DashboardStatCard label="Sessions" value="Open" caption="Clinical session records" icon={CalendarDays} /></Link>
        <Link href="/reports"><DashboardStatCard label="Reports" value="Open" caption="Clinical report builder" icon={ShieldCheck} /></Link>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const isWorker = user?.role === "support_worker";
  useDashboardRealtime(isWorker);

  const workerQuery = useOrgQuery(["dashboard", "worker"], {
    queryFn: getWorkerDashboard,
    enabled: isWorker,
  });
  const workerLandingQuery = useOrgQuery(["dashboard", "worker-landing"], {
    queryFn: getWorkerLandingDashboard,
    enabled: isWorker,
  });
  const coordinatorQuery = useOrgQuery(["dashboard", "coordinator"], {
    queryFn: getCoordinatorDashboard,
    enabled: user?.role === "support_coordinator",
  });

  if (isWorker) {
    if (workerQuery.isLoading) return <div className="p-6 text-sm font-bold" style={{ color: MUTED }}>Loading dashboard...</div>;
    if (workerQuery.error) return <div className="p-6 text-sm font-bold text-red-600">{(workerQuery.error as Error).message}</div>;
    return (
      <WorkerDashboardView
        data={workerQuery.data as WorkerDashboard}
        landing={workerLandingQuery.data ?? null}
      />
    );
  }

  if (user?.role === "support_coordinator") {
    if (coordinatorQuery.isLoading) return <div className="p-6 text-sm font-bold" style={{ color: MUTED }}>Loading dashboard...</div>;
    if (coordinatorQuery.error) return <div className="p-6 text-sm font-bold text-red-600">{(coordinatorQuery.error as Error).message}</div>;
    return <CoordinatorDashboardView data={coordinatorQuery.data as CoordinatorDashboard} />;
  }

  return <AlliedFallbackDashboard />;
}
