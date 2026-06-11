import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { format, parseISO } from "date-fns";
import { useState, type ComponentType } from "react";
import { ComplianceDetailCard } from "@/components/compliance/ComplianceDetailCard";
import { ComplianceTrendChart } from "@/components/compliance/ComplianceTrendChart";
import { getWorkerComplianceDetail } from "@/services/workerService";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileText,
  ShieldCheck,
  UserPlus,
  Users,
  BadgeCheck,
  GraduationCap,
} from "lucide-react";
import { InviteModal } from "@/components/InviteModal";
import { useAuth } from "@/contexts/AuthContext";
import {
  getCoordinatorDashboard,
  getWorkerDashboard,
  type CoordinatorDashboard,
  type DashboardClient,
  type DashboardSession,
  type WorkerDashboard,
} from "@/services/dashboardService";
import { getCoordinatorFlaggedSessions, getCoordinatorCredentialAlerts } from "@/services/coordinatorService";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT = "#F5F3FC";

function safeDate(value?: string | null, fallback = "Not recorded") {
  if (!value) return fallback;
  try {
    return format(parseISO(value), "MMM d");
  } catch {
    return value;
  }
}

function statusTone(status?: string) {
  if (status === "compliant") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "non_compliant") return "bg-red-50 text-red-700 border-red-200";
  if (status === "draft") return "bg-slate-50 text-slate-600 border-slate-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
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
    <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>
            {label}
          </p>
          <p className="mt-2 text-3xl font-black tracking-tight" style={{ color: valueColor }}>
            {value}
          </p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ background: SOFT, color: PLUM }}>
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
  return (
    <section className="rounded-lg border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-black" style={{ color: TEXT }}>Today's Clients</h2>
        <Link href="/my-clients" className="text-sm font-bold" style={{ color: CORAL }}>My Clients</Link>
      </div>
      <div className="space-y-3">
        {clients.length === 0 && (
          <p className="rounded-lg bg-[#F5F3FC] px-4 py-3 text-sm font-medium" style={{ color: MUTED }}>
            No assigned sessions are scheduled for today.
          </p>
        )}
        {clients.map((client) => (
          <Link key={client.id} href={`/my-clients/${client.id}`}>
            <div className="flex items-center gap-3 rounded-lg border border-transparent p-3 transition hover:border-[#D8D0F0] hover:bg-[#F8F6FE]">
              <div className="grid h-10 w-10 place-items-center rounded-full text-sm font-black text-white" style={{ background: PLUM }}>
                {client.full_name?.split(" ").map((p) => p[0]).join("").slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black" style={{ color: TEXT }}>{client.full_name}</p>
                <p className="truncate text-xs font-medium" style={{ color: MUTED }}>
                  {client.plan_management_type} · Last seen {safeDate(client.last_seen)}
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
    <section className="rounded-lg border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
      <h2 className="mb-4 text-lg font-black" style={{ color: TEXT }}>{title}</h2>
      <div className="space-y-3">
        {sessions.length === 0 && <p className="text-sm font-medium" style={{ color: MUTED }}>No records need attention.</p>}
        {sessions.map((session) => (
          <div key={session.id} className="rounded-lg border p-3" style={{ borderColor: "#EEEAFB" }}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold" style={{ color: TEXT }}>
                  {session.participant_name || "Participant"}
                </p>
                <p className="text-xs font-medium capitalize" style={{ color: MUTED }}>
                  {safeDate(session.session_date)} · {(session.session_type || "session").replace("_", " ")}
                </p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusTone(session.compliance_status)}`}>
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

function CoordinatorTeamComplianceCard({ data }: { data: CoordinatorDashboard }) {
  const breakdown = data.team_compliance_breakdown ?? { compliant: 0, at_risk: 0, non_compliant: 0 };
  const score = Math.max(0, Math.min(100, data.team_compliance_score || 0));
  const status =
    score >= 85 ? "Compliant" : score >= 60 ? "At Risk" : "Non-Compliant";

  return (
    <section className="rounded-lg border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-black" style={{ color: TEXT }}>Team Compliance</h2>
          <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>Calculated from completed legal records.</p>
        </div>
        <span className="rounded-full px-3 py-1 text-xs font-black" style={{ background: "#FFE8EE", color: CORAL }}>
          {score}/100
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-[140px_1fr]">
        <div
          className="relative mx-auto grid h-28 w-28 place-items-center rounded-full"
          style={{ background: `conic-gradient(${PLUM} ${score * 3.6}deg, #EEEAFB 0deg)` }}
        >
          <div className="grid h-20 w-20 place-items-center rounded-full bg-white">
            <div className="text-center">
              <span className="block text-2xl font-black" style={{ color: PLUM }}>{score}</span>
              <span className="block text-[10px] font-bold uppercase" style={{ color: MUTED }}>score</span>
            </div>
          </div>
        </div>

        <div className="space-y-2 text-sm font-bold">
          <div className="flex items-center justify-between gap-3">
            <span style={{ color: MUTED }}>{status}</span>
            <span className="text-emerald-600">{breakdown.compliant}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span style={{ color: MUTED }}>At Risk</span>
            <span className="text-amber-600">{breakdown.at_risk}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span style={{ color: MUTED }}>Non-Compliant</span>
            <span className="text-red-600">{breakdown.non_compliant}</span>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>
          Workers Needing Attention
        </p>
        <div className="space-y-3">
          {data.workers_needing_attention.length === 0 && (
            <p className="rounded-lg bg-[#F8F6FE] px-4 py-3 text-sm font-medium" style={{ color: MUTED }}>
              No worker compliance issues are currently open.
            </p>
          )}
          {data.workers_needing_attention.slice(0, 4).map((worker) => (
            <div key={worker.id} className="flex items-center gap-3 border-t pt-3 first:border-t-0 first:pt-0" style={{ borderColor: "#EEEAFB" }}>
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-black text-white" style={{ background: PLUM }}>
                {initials(worker.full_name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black" style={{ color: TEXT }}>{worker.full_name}</p>
                <p className="truncate text-xs font-medium" style={{ color: MUTED }}>{worker.reason || "Compliance review required"}</p>
              </div>
              <span className="rounded-full px-3 py-1 text-[11px] font-black" style={{ background: "#FFE8EE", color: CORAL }}>
                Review
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CoordinatorSessionsCard({ sessions }: { sessions: DashboardSession[] }) {
  return (
    <section className="rounded-lg border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-lg font-black" style={{ color: TEXT }}>Today's Sessions</h2>
        <span className="rounded-full px-3 py-1 text-xs font-black" style={{ background: SOFT, color: PLUM }}>
          {sessions.length} total
        </span>
      </div>
      <div className="space-y-3">
        {sessions.length === 0 && (
          <p className="rounded-lg bg-[#F8F6FE] px-4 py-3 text-sm font-medium" style={{ color: MUTED }}>
            No sessions are scheduled for today.
          </p>
        )}
        {sessions.slice(0, 8).map((session) => (
          <div key={session.id} className="flex items-center gap-3 border-t pt-3 first:border-t-0 first:pt-0" style={{ borderColor: "#EEEAFB" }}>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-black text-white" style={{ background: PLUM }}>
              {initials(session.participant_name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black" style={{ color: TEXT }}>{session.participant_name || "Participant"}</p>
              <p className="truncate text-xs font-medium capitalize" style={{ color: MUTED }}>
                {(session.session_type || "session").replace("_", " ")} - {sessionTime(session.session_date)}
              </p>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black capitalize ${statusTone(session.compliance_status)}`}>
              {statusLabel(session)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CoordinatorCommonIssuesCard({ issues }: { issues: CoordinatorDashboard["common_issues"] }) {
  const max = Math.max(...issues.map((issue) => issue.count), 1);
  return (
    <section className="rounded-lg border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-lg font-black" style={{ color: TEXT }}>Most Common Issues - Team</h2>
        <Link href="/compliance" className="text-sm font-bold" style={{ color: PLUM }}>View full report</Link>
      </div>
      <div className="space-y-3">
        {issues.length === 0 && (
          <p className="rounded-lg bg-[#F8F6FE] px-4 py-3 text-sm font-medium" style={{ color: MUTED }}>
            No recurring failed compliance rules have been recorded.
          </p>
        )}
        {issues.map((issue, index) => (
          <div key={issue.issue} className="grid grid-cols-[150px_1fr_32px] items-center gap-3 text-sm">
            <p className="truncate font-bold" style={{ color: TEXT }}>{issue.issue}</p>
            <div className="h-2 overflow-hidden rounded-full bg-[#EEEAFB]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(8, Math.round((issue.count / max) * 100))}%`,
                  background: index === issues.length - 1 ? "#F8A51B" : PLUM,
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

function WorkerDashboardView({ data }: { data: WorkerDashboard }) {
  const [trendDays, setTrendDays] = useState<7 | 30>(7);
  const complianceQuery = useOrgQuery(["worker", "compliance-detail", trendDays], {
    queryFn: () => getWorkerComplianceDetail(trendDays),
    staleTime: 30_000,
  });
  const todayClients = data.today_clients.length ? data.today_clients : data.assigned_clients.slice(0, 4);
  const complianceDetail = complianceQuery.data;
  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Support Worker</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>Dashboard</h1>
        </div>
        <Link href="/my-clients">
          <button className="rounded-full px-5 py-3 text-sm font-black text-white shadow-sm" style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}>
            Open My Clients
          </button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardStatCard label="My Sessions Today" value={data.sessions_today} caption="Worker-owned sessions only" icon={CalendarDays} />
        <DashboardStatCard label="Notes Due" value={data.notes_due} caption="Draft or compliance-risk notes" icon={FileText} />
        <DashboardStatCard label="My Clients" value={data.assigned_clients.length} caption="Assigned participants only" icon={Users} />
        <DashboardStatCard label="Pending Fixes" value={data.pending_compliance_fixes.length} caption="Items needing review" icon={AlertTriangle} />
      </div>

      {complianceQuery.isLoading ? (
        <div className="rounded-lg border bg-white p-6 text-sm font-bold shadow-sm" style={{ borderColor: BORDER, color: MUTED }}>
          Loading compliance details...
        </div>
      ) : complianceDetail ? (
        <ComplianceDetailCard
          score={complianceDetail.score}
          status={complianceDetail.status}
          rules={complianceDetail.rules}
          failedRules={complianceDetail.failed_rules}
          title="My Compliance Score"
          compact
        />
      ) : (
        <div className="rounded-lg border bg-white p-6 text-sm font-bold text-red-600 shadow-sm" style={{ borderColor: BORDER }}>
          Could not load compliance details.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {complianceDetail && (
          <ComplianceTrendChart
            data={complianceDetail.trend}
            days={trendDays}
            onDaysChange={setTrendDays}
          />
        )}
        <ClientListCard clients={todayClients} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SessionListCard title="Incomplete Sessions" sessions={data.incomplete_sessions.slice(0, 6)} />
        <SessionListCard title="Pending Compliance Fixes" sessions={data.pending_compliance_fixes.slice(0, 6)} />
      </div>
    </div>
  );
}

function CoordinatorQuickActionCards({ data }: { data: CoordinatorDashboard }) {
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

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Link href="/session-review">
        <div className="group cursor-pointer rounded-xl border bg-white p-5 shadow-sm transition hover:border-[#5533CC]/40 hover:shadow-md" style={{ borderColor: BORDER }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>Flagged Sessions</p>
              <p className="mt-2 text-3xl font-black tracking-tight" style={{ color: flaggedCount > 0 ? CORAL : "#059669" }}>{flaggedCount}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg transition group-hover:scale-105" style={{ background: flaggedCount > 0 ? "#FFF0F3" : "#F0FDF4", color: flaggedCount > 0 ? CORAL : "#059669" }}>
              <ClipboardCheck size={20} strokeWidth={2.5} />
            </div>
          </div>
          <p className="mt-3 text-sm font-bold transition" style={{ color: PLUM }}>Review queue →</p>
        </div>
      </Link>

      <Link href="/incidents">
        <div className="group cursor-pointer rounded-xl border bg-white p-5 shadow-sm transition hover:border-[#5533CC]/40 hover:shadow-md" style={{ borderColor: BORDER }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>Pending Incidents</p>
              <p className="mt-2 text-3xl font-black tracking-tight" style={{ color: incidentCount > 0 ? "#D97706" : TEXT }}>{incidentCount}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg transition group-hover:scale-105" style={{ background: incidentCount > 0 ? "#FFFBEB" : "#F5F3FC", color: incidentCount > 0 ? "#D97706" : MUTED }}>
              <AlertTriangle size={20} strokeWidth={2.5} />
            </div>
          </div>
          <p className="mt-3 text-sm font-bold transition" style={{ color: PLUM }}>View incidents →</p>
        </div>
      </Link>

      <Link href="/credentials">
        <div className="group cursor-pointer rounded-xl border bg-white p-5 shadow-sm transition hover:border-[#5533CC]/40 hover:shadow-md" style={{ borderColor: BORDER }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>Expiring Credentials</p>
              <p className="mt-2 text-3xl font-black tracking-tight" style={{ color: credentialCount > 0 ? "#DC2626" : TEXT }}>{credentialCount}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg transition group-hover:scale-105" style={{ background: credentialCount > 0 ? "#FEF2F2" : "#F5F3FC", color: credentialCount > 0 ? "#DC2626" : MUTED }}>
              <BadgeCheck size={20} strokeWidth={2.5} />
            </div>
          </div>
          <p className="mt-3 text-sm font-bold transition" style={{ color: PLUM }}>Check credentials →</p>
        </div>
      </Link>

      <Link href="/toolkit">
        <div className="group cursor-pointer rounded-xl border bg-white p-5 shadow-sm transition hover:border-[#5533CC]/40 hover:shadow-md" style={{ borderColor: BORDER }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>Training Due</p>
              <p className="mt-2 text-3xl font-black tracking-tight" style={{ color: trainingCount > 0 ? "#D97706" : TEXT }}>{trainingCount}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg transition group-hover:scale-105" style={{ background: trainingCount > 0 ? "#FFFBEB" : "#F5F3FC", color: trainingCount > 0 ? "#D97706" : MUTED }}>
              <GraduationCap size={20} strokeWidth={2.5} />
            </div>
          </div>
          <p className="mt-3 text-sm font-bold transition" style={{ color: PLUM }}>View toolkit →</p>
        </div>
      </Link>
    </div>
  );
}

function CoordinatorDashboardView({ data }: { data: CoordinatorDashboard }) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";

  return (
    <>
      <div className="mx-auto max-w-7xl space-y-6 pb-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Support Coordinator</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>Dashboard</h1>
          </div>
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white shadow-sm transition hover:opacity-95 active:scale-[0.99]"
            style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
          >
            <UserPlus size={16} strokeWidth={2.5} />
            Invite Worker
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <DashboardStatCard label="Active Workers" value={data.active_workers} caption="Current active child accounts" icon={Users} valueColor={PLUM} />
          <DashboardStatCard label="Compliant Today" value={data.compliant_today} caption="Sessions passing today" icon={CheckCircle2} valueColor="#059669" />
          <DashboardStatCard label="Notes At Risk" value={data.notes_at_risk} caption="Notes needing review" icon={ClipboardList} valueColor="#D97706" />
          <DashboardStatCard label="RP Flags" value={data.rp_flags} caption="Restrictive practice flags" icon={AlertTriangle} valueColor={CORAL} />
        </div>

        <CoordinatorQuickActionCards data={data} />

        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <CoordinatorTeamComplianceCard data={data} />
          <CoordinatorSessionsCard sessions={data.todays_sessions} />
        </div>

        <CoordinatorCommonIssuesCard issues={data.common_issues} />
      </div>

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInviteSent={() => {
          queryClient.invalidateQueries({ queryKey: [orgId, "dashboard", "coordinator"] });
          queryClient.invalidateQueries({ queryKey: [orgId, "coordinator", "team"] });
        }}
      />
    </>
  );
}

function AlliedFallbackDashboard() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Allied Health Professional</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>Dashboard</h1>
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
  const workerQuery = useOrgQuery(["dashboard", "worker"], {
    queryFn: getWorkerDashboard,
    enabled: user?.role === "support_worker",
  });
  const coordinatorQuery = useOrgQuery(["dashboard", "coordinator"], {
    queryFn: getCoordinatorDashboard,
    enabled: user?.role === "support_coordinator",
  });

  if (user?.role === "support_worker") {
    if (workerQuery.isLoading) return <div className="p-6 text-sm font-bold" style={{ color: MUTED }}>Loading dashboard...</div>;
    if (workerQuery.error) return <div className="p-6 text-sm font-bold text-red-600">{(workerQuery.error as Error).message}</div>;
    return <WorkerDashboardView data={workerQuery.data as WorkerDashboard} />;
  }

  if (user?.role === "support_coordinator") {
    if (coordinatorQuery.isLoading) return <div className="p-6 text-sm font-bold" style={{ color: MUTED }}>Loading dashboard...</div>;
    if (coordinatorQuery.error) return <div className="p-6 text-sm font-bold text-red-600">{(coordinatorQuery.error as Error).message}</div>;
    return <CoordinatorDashboardView data={coordinatorQuery.data as CoordinatorDashboard} />;
  }

  return <AlliedFallbackDashboard />;
}
