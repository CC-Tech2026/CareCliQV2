import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch, Link } from "wouter";
import {
  getComplianceCentreOverview,
  getComplianceCentreStaff,
  getComplianceCentreParticipants,
  getComplianceCentreIncidents,
  sendBulkReminders,
  type ComplianceStaffRow,
  type ComplianceParticipantRow,
} from "@/services/coordinatorService";
import { useToast } from "@/hooks/use-toast";
import { downloadBlob } from "@/lib/download-file";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { AuditPackPanel } from "@/pages/audit-pack";
import { Card } from "@/components/ui/card";
import { KpiCard, KpiGrid, type StatTone } from "@/components/ui/stat-card";
import {
  Download, AlertTriangle, ShieldAlert, ShieldCheck, Users, HeartHandshake,
  ListChecks, FileX, Search, BarChart3, Flag,
  FileCheck2, Info, ArrowRight, Eye, FilePlus, FileText, List,
  ArrowDownCircle, CircleCheck, LayoutDashboard, Loader2, Inbox,
} from "lucide-react";

// ── Design tokens ─────────────────────────────────────────────────────────────
const PLUM     = "var(--cc-plum)";
const CORAL    = "var(--cc-coral)";
const TEXT     = "var(--cc-text)";
const MUTED    = "var(--cc-muted)";
const BORDER   = "var(--cc-border)";
const SOFT     = "var(--cc-soft)";
const SUCCESS  = "var(--cc-status-success)";
const WARNING  = "var(--cc-status-warning)";
// Real red — deliberately not var(--cc-coral)/var(--cc-status-critical): those are the
// brand's destructive-action colour, while this signals NDIS compliance/safety severity,
// which stays a literal traffic-light red regardless of brand palette (see ComplianceCentre widget).
const CRITICAL = "#DC2626";

function scoreColor(score: number) {
  return score >= 85 ? SUCCESS : score >= 60 ? WARNING : CRITICAL;
}

/** Same thresholds as scoreColor, expressed as a KpiCard tone. */
function scoreTone(score: number): StatTone {
  return score >= 85 ? "success" : score >= 60 ? "warning" : "danger";
}

function initialsOf(name: string) {
  return name.split(" ").map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
}

function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-black"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), background: "var(--cc-active-bg)", color: PLUM }}
    >
      {initialsOf(name)}
    </span>
  );
}

function credentialTypeLabels(translate: (key: string) => string): Record<string, string> {
  return {
    ndis_screening: translate("compliance.centre.credType.ndisScreening"),
    wwcc: translate("compliance.centre.credType.wwcc"),
    code_of_conduct: translate("compliance.centre.credType.codeOfConduct"),
    first_aid: translate("compliance.centre.credType.firstAid"),
    cpr: translate("compliance.centre.credType.cpr"),
    manual_handling: translate("compliance.centre.credType.manualHandling"),
    infection_control: translate("compliance.centre.credType.infectionControl"),
    medication_admin: translate("compliance.centre.credType.medicationAdmin"),
  };
}

// ── Filter chip row ───────────────────────────────────────────────────────────
function FilterChip({ label, active, icon, onClick }: { label: string; active: boolean; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold transition-colors whitespace-nowrap"
      style={active
        ? { background: "var(--cc-plum-soft)", border: `1px solid ${PLUM}`, color: PLUM }
        : { background: "#fff", border: `1px solid ${BORDER}`, color: MUTED, boxShadow: "0 1px 2px rgba(16,24,40,0.04)" }}
    >
      {icon} {label}
    </button>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="py-20 flex flex-col items-center justify-center gap-2">
      <Loader2 size={22} className="animate-spin" style={{ color: PLUM }} />
      <p className="text-[12px] font-medium" style={{ color: MUTED }}>{label}</p>
    </div>
  );
}

function EmptyState({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="py-14 flex flex-col items-center justify-center gap-2 text-center">
      <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "var(--cc-plum-soft)" }}>
        <Inbox size={19} style={{ color: PLUM }} />
      </div>
      <p className="text-[13px] font-bold" style={{ color: TEXT }}>{label}</p>
      {sub && <p className="text-[11px] max-w-xs" style={{ color: MUTED }}>{sub}</p>}
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "gn" | "am" | "rd" | "pu" | "gy" }) {
  const map: Record<string, { bg: string; color: string }> = {
    gn: { bg: "var(--cc-status-success-bg)", color: SUCCESS },
    am: { bg: "var(--cc-status-warning-bg)", color: WARNING },
    rd: { bg: "rgba(220,38,38,0.1)", color: CRITICAL },
    pu: { bg: "var(--cc-plum-soft)", color: PLUM },
    gy: { bg: SOFT, color: MUTED },
  };
  const c = map[tone];
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: c.bg, color: c.color }}>
      {label}
    </span>
  );
}

// ── Sub-tabs ──────────────────────────────────────────────────────────────────
type SubTab = "overview" | "staff" | "participants" | "incidents" | "audit_pack";
const SUB_TABS: SubTab[] = ["overview", "staff", "participants", "incidents", "audit_pack"];
const TAB_ICONS: Record<SubTab, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  staff: Users,
  participants: HeartHandshake,
  incidents: ShieldAlert,
  audit_pack: FileCheck2,
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Compliance() {
  const { translate, translateParams } = useAccessibility();
  const search = useSearch();
  const [, navigate] = useLocation();
  const initialTab = (new URLSearchParams(search).get("tab") as SubTab | null) ?? "overview";
  const [activeTab, setActiveTabState] = useState<SubTab>(
    SUB_TABS.includes(initialTab) ? initialTab : "overview",
  );
  // Shared cache with OverviewPanel (same queryKey) — just for the header's live score badge.
  const { data: headerOverview } = useQuery({ queryKey: ["compliance-centre", "overview"], queryFn: getComplianceCentreOverview });

  function setActiveTab(tab: SubTab) {
    setActiveTabState(tab);
    navigate(`/compliance?tab=${tab}`, { replace: true });
  }

  const tabLabels: Record<SubTab, string> = {
    overview: translate("compliance.centre.tab.overview"),
    staff: translate("compliance.centre.tab.staff"),
    participants: translate("compliance.centre.tab.participants"),
    incidents: translate("compliance.centre.tab.incidents"),
    audit_pack: translate("compliance.centre.tab.auditPack"),
  };

  const overallScore = headerOverview?.kpis.overall_score;
  const scoreArcColor = overallScore != null ? scoreColor(overallScore) : PLUM;
  const scoreCirc = 2 * Math.PI * 20;

  const urgentCount = headerOverview?.urgent_actions.length ?? 0;

  return (
    <div className="flex flex-col gap-5 pb-10">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
            {translate("compliance.page.eyebrow")}
          </p>
          <h1 className="mt-1 text-[26px] font-black tracking-tight" style={{ color: TEXT }}>{translate("compliance.page.title")}</h1>
          <p className="mt-1 text-[13px] font-medium" style={{ color: MUTED }}>{translate("compliance.centre.subtitle")}</p>
        </div>
        {(overallScore != null || urgentCount > 0) && (
          <Card className="hidden sm:flex items-center gap-5 shrink-0 rounded-2xl border-0 shadow-sm px-5 py-3">
            {urgentCount > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "rgba(220,38,38,0.1)" }}>
                  <ShieldAlert size={15} style={{ color: CRITICAL }} />
                </span>
                <span className="text-[12px] font-bold" style={{ color: CRITICAL }}>
                  {translateParams(
                    urgentCount !== 1 ? "compliance.centre.overview.urgentActionPlural" : "compliance.centre.overview.urgentAction",
                    { count: String(urgentCount) },
                  )}
                </span>
              </div>
            )}
            {overallScore != null && (
              <div className="flex items-center gap-2.5">
                <div className="relative w-10 h-10 shrink-0">
                  <svg width="40" height="40" viewBox="0 0 48 48" className="-rotate-90">
                    <circle cx="24" cy="24" r="20" fill="none" stroke={SOFT} strokeWidth="5" />
                    <circle
                      cx="24" cy="24" r="20" fill="none" stroke={scoreArcColor} strokeWidth="5"
                      strokeDasharray={scoreCirc} strokeDashoffset={scoreCirc * (1 - overallScore / 100)} strokeLinecap="round"
                      className="transition-all duration-700"
                    />
                  </svg>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-wider leading-none" style={{ color: MUTED }}>
                    {translate("compliance.centre.overview.statOverallScore")}
                  </span>
                  <span className="text-lg font-black leading-tight mt-0.5" style={{ color: scoreArcColor }}>{Math.round(overallScore)}</span>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      <div className="inline-flex w-fit max-w-full gap-1 rounded-2xl p-1.5 overflow-x-auto scrollbar-none" style={{ background: SOFT }}>
        {SUB_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab];
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="flex shrink-0 items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-bold transition-all whitespace-nowrap"
              style={active ? { background: "var(--cc-cta)", color: "#fff", boxShadow: "0 2px 6px rgba(124,58,237,0.25)" } : { background: "transparent", color: MUTED }}
            >
              <Icon size={14} />
              {tabLabels[tab]}
            </button>
          );
        })}
      </div>

      {activeTab === "overview" && <OverviewPanel onNavigateTab={setActiveTab} />}
      {activeTab === "staff" && <StaffPanel />}
      {activeTab === "participants" && <ParticipantsPanel />}
      {activeTab === "incidents" && <IncidentsPanel />}
      {activeTab === "audit_pack" && <AuditPackPanel embedded />}
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────
function OverviewPanel({ onNavigateTab }: { onNavigateTab: (tab: SubTab) => void }) {
  const { translate, translateParams } = useAccessibility();
  const { data, isLoading } = useQuery({ queryKey: ["compliance-centre", "overview"], queryFn: getComplianceCentreOverview });

  const bands = data?.bands ?? { compliant: 0, at_risk: 0, non_compliant: 0 };
  const avg = data?.kpis.overall_score ?? 0;
  const arcColor = scoreColor(avg);
  const circ = 2 * Math.PI * 42;

  if (isLoading) return <LoadingBlock label={translate("common.loading")} />;

  return (
    <div className="space-y-5">
      <KpiGrid>
        <KpiCard label={translate("compliance.centre.overview.statOverallScore")} value={Math.round(avg)} sub={translate("compliance.centre.overview.statOverallScoreSub")} tone={scoreTone(avg)} icon={<BarChart3 />} />
        <KpiCard label={translate("compliance.centre.overview.statCompliantSessions")} value={bands.compliant} sub={translate("compliance.centre.overview.statCompliantSub")} tone="success" icon={<CircleCheck />} />
        <KpiCard label={translate("compliance.centre.overview.statAtRiskSessions")} value={bands.at_risk} sub={translate("compliance.centre.overview.statAtRiskSub")} tone="warning" icon={<AlertTriangle />} />
        <KpiCard label={translate("compliance.centre.overview.statOpenIncidents")} value={data?.kpis.open_incidents ?? 0} sub={translate("compliance.centre.overview.statOpenIncidentsSub")} tone="danger" icon={<ShieldAlert />} />
      </KpiGrid>

      {(data?.urgent_actions.length ?? 0) > 0 && (
        <Card className="rounded-2xl border-0 shadow-sm p-4 flex items-start gap-3" style={{ background: "rgba(220,38,38,0.05)" }}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(220,38,38,0.12)" }}>
            <AlertTriangle size={17} style={{ color: CRITICAL }} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-bold mb-2" style={{ color: CRITICAL }}>
              {translateParams(
                data!.urgent_actions.length !== 1 ? "compliance.centre.overview.urgentActionPlural" : "compliance.centre.overview.urgentAction",
                { count: String(data!.urgent_actions.length) },
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {data!.urgent_actions.map((a, i) => (
                <Link key={i} href={a.link}>
                  <span
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full cursor-pointer hover:opacity-80 bg-white"
                    style={{ color: a.severity === "critical" ? CRITICAL : WARNING }}
                  >
                    {a.type === "incident" ? <ShieldAlert size={11} /> : a.type === "credential" ? <FileText size={11} /> : <FileX size={11} />}
                    {a.label}{a.detail ? ` · ${a.detail}` : ""}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-2xl border-0 shadow-sm p-5">
          <p className="text-[13px] font-bold" style={{ color: TEXT }}>{translate("compliance.centre.overview.bandsTitle")}</p>
          <p className="text-[11px] mb-4" style={{ color: MUTED }}>{translate("compliance.centre.overview.bandsSubtitle")}</p>
          <div className="flex items-center gap-5">
            <div className="relative w-24 h-24 shrink-0">
              <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90">
                <circle cx="48" cy="48" r="42" fill="none" stroke={SOFT} strokeWidth="9" />
                <circle
                  cx="48" cy="48" r="42" fill="none" stroke={arcColor} strokeWidth="9"
                  strokeDasharray={circ} strokeDashoffset={circ * (1 - avg / 100)} strokeLinecap="round"
                  className="transition-all duration-700"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-black" style={{ color: TEXT, fontFamily: "var(--app-font-stat)" }}>{Math.round(avg)}</span>
              </div>
            </div>
            <div className="flex-1 space-y-2.5">
              {[
                { label: translate("compliance.centre.overview.bandCompliant"), count: bands.compliant, color: SUCCESS },
                { label: translate("compliance.centre.overview.bandAtRisk"), count: bands.at_risk, color: WARNING },
                { label: translate("compliance.centre.overview.bandNonCompliant"), count: bands.non_compliant, color: CRITICAL },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between text-[12px] rounded-xl px-3 py-2" style={{ background: SOFT }}>
                  <span className="flex items-center gap-2" style={{ color: TEXT }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: row.color }} /> {row.label}
                  </span>
                  <span className="font-black" style={{ color: row.color }}>{row.count}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="rounded-2xl border-0 shadow-sm p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: SOFT }}>
              <ListChecks size={14} style={{ color: MUTED }} />
            </span>
            <p className="text-[13px] font-bold" style={{ color: TEXT }}>{translate("compliance.centre.overview.issuesTitle")}</p>
          </div>
          <p className="text-[11px] mb-3 mt-1" style={{ color: MUTED }}>{translate("compliance.centre.overview.issuesSubtitle")}</p>
          {(data?.common_issues.length ?? 0) === 0 ? (
            <div className="flex items-center gap-2 rounded-xl px-3.5 py-3" style={{ background: "var(--cc-status-success-bg)", color: SUCCESS }}>
              <CircleCheck size={16} /> <span className="text-[12px] font-bold">{translate("compliance.centre.overview.noIssues")}</span>
            </div>
          ) : (
            <div className="space-y-3">
              {data!.common_issues.map((issue) => (
                <div key={issue.rule_code} className="space-y-1">
                  <div className="flex justify-between text-[12px]">
                    <span className="font-semibold truncate max-w-[70%]" style={{ color: TEXT }}>{issue.label}</span>
                    <span className="font-bold" style={{ color: issue.pct >= 50 ? CRITICAL : WARNING }}>
                      {translateParams(issue.count !== 1 ? "compliance.centre.overview.issueSessionCountPlural" : "compliance.centre.overview.issueSessionCount", { count: String(issue.count) })}
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: SOFT }}>
                    <div className="h-full rounded-full" style={{ width: `${issue.pct}%`, background: issue.pct >= 50 ? CRITICAL : WARNING }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-2xl border-0 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: SOFT }}>
              <Users size={14} style={{ color: MUTED }} />
            </span>
            <p className="text-[13px] font-bold" style={{ color: TEXT }}>{translate("compliance.centre.overview.staffSnapshotTitle")}</p>
          </div>
          <div className="space-y-1">
            {(data?.staff_snapshot.length ?? 0) === 0 && <p className="text-[12px] py-2" style={{ color: MUTED }}>{translate("compliance.centre.overview.noStaffData")}</p>}
            {data?.staff_snapshot.map((w) => (
              <div key={w.user_id} className="flex items-center justify-between gap-2 py-2 px-2.5 rounded-xl text-[12px] hover:bg-[var(--cc-soft)] transition-colors">
                <span className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={w.full_name} size={28} />
                  <span className="font-semibold truncate" style={{ color: TEXT }}>{w.full_name}</span>
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {w.avg_score != null && <span className="font-black" style={{ color: scoreColor(w.avg_score) }}>{w.avg_score}</span>}
                  {w.rp_flag
                    ? <StatusBadge label={translate("compliance.centre.status.rpFlag")} tone="rd" />
                    : w.expiry_date
                      ? <StatusBadge label={translate("compliance.centre.status.review")} tone="am" />
                      : <StatusBadge label={translate("compliance.centre.status.compliant")} tone="gn" />}
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => onNavigateTab("staff")} className="mt-2 flex items-center gap-1 text-[12px] font-bold hover:opacity-70" style={{ color: PLUM }}>
            <ArrowRight size={13} /> {translate("compliance.centre.overview.viewAllStaff")}
          </button>
        </Card>

        <Card className="rounded-2xl border-0 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: SOFT }}>
              <HeartHandshake size={14} style={{ color: MUTED }} />
            </span>
            <p className="text-[13px] font-bold" style={{ color: TEXT }}>{translate("compliance.centre.overview.participantSnapshotTitle")}</p>
          </div>
          <div className="space-y-1">
            {(data?.participant_snapshot.length ?? 0) === 0 && <p className="text-[12px] py-2" style={{ color: MUTED }}>{translate("compliance.centre.overview.noParticipantData")}</p>}
            {data?.participant_snapshot.map((p) => (
              <div key={p.participant_id} className="flex items-center justify-between gap-2 py-2 px-2.5 rounded-xl text-[12px] hover:bg-[var(--cc-soft)] transition-colors">
                <span className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={p.full_name} size={28} />
                  <span className="font-semibold truncate" style={{ color: TEXT }}>{p.full_name}</span>
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {p.note_quality != null && <span className="font-black" style={{ color: scoreColor(p.note_quality) }}>{p.note_quality}</span>}
                  {p.agreement_unsigned
                    ? <StatusBadge label={translate("compliance.centre.status.unsigned")} tone="rd" />
                    : p.has_flag
                      ? <StatusBadge label={translate("compliance.centre.status.flagged")} tone="am" />
                      : <StatusBadge label={translate("compliance.centre.status.compliant")} tone="gn" />}
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => onNavigateTab("participants")} className="mt-2 flex items-center gap-1 text-[12px] font-bold hover:opacity-70" style={{ color: PLUM }}>
            <ArrowRight size={13} /> {translate("compliance.centre.overview.viewAllParticipants")}
          </button>
        </Card>
      </div>
    </div>
  );
}

// ── Staff compliance ──────────────────────────────────────────────────────────
function StaffPanel() {
  const { translate, translateParams } = useAccessibility();
  const { data, isLoading } = useQuery({ queryKey: ["compliance-centre", "staff"], queryFn: getComplianceCentreStaff });
  const { toast } = useToast();
  const [filter, setFilter] = useState<"all" | "expiring" | "action" | "compliant">("all");
  const [search, setSearch] = useState("");
  const [sendingId, setSendingId] = useState<string | null>(null);
  const credLabels = credentialTypeLabels(translate);

  const workers = data?.workers ?? [];
  const filtered = useMemo(() => {
    return workers.filter((w) => {
      if (filter !== "all" && !w.groups.includes(filter)) return false;
      if (search.trim() && !w.full_name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [workers, filter, search]);

  const expiringSoon = workers.find((w) =>
    Object.values(w.credentials).some((c) => {
      if (!c.expiry_date) return false;
      const days = (new Date(c.expiry_date).getTime() - Date.now()) / 86400000;
      return days <= 14;
    }),
  );

  async function handleSendReminder(worker: ComplianceStaffRow) {
    setSendingId(worker.user_id);
    try {
      await sendBulkReminders([worker.user_id], "Your credential is expiring soon. Please update it to remain compliant.");
      toast({ title: translate("compliance.centre.staff.reminderSentTitle"), description: translateParams("compliance.centre.staff.reminderSentDesc", { name: worker.full_name }) });
    } catch (err: any) {
      toast({ variant: "destructive", title: translate("compliance.centre.staff.reminderFailedTitle"), description: err?.message ?? "" });
    } finally {
      setSendingId(null);
    }
  }

  function exportCsv() {
    const header = [translate("compliance.centre.staff.colWorker"), ...Object.values(credLabels), translate("compliance.centre.staff.colAvgScore"), "RP flag"];
    const rows = filtered.map((w) => [
      w.full_name,
      ...Object.keys(credLabels).map((k) => w.credentials[k]?.status ?? "not tracked"),
      String(w.avg_score ?? ""),
      w.rp_flag ? "yes" : "no",
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv" }), "staff-compliance.csv");
  }

  if (isLoading) return <LoadingBlock label={translate("common.loading")} />;

  return (
    <div className="space-y-5">
      <KpiGrid>
        <KpiCard label={translate("compliance.centre.staff.statTotalWorkers")} value={data?.kpis.total_workers ?? 0} icon={<Users />} />
        <KpiCard label={translate("compliance.centre.staff.statFullyCompliant")} value={data?.kpis.fully_compliant ?? 0} tone="success" icon={<CircleCheck />} />
        <KpiCard label={translate("compliance.centre.staff.statExpiringCredentials")} value={data?.kpis.expiring_credentials ?? 0} tone="warning" icon={<AlertTriangle />} />
        <KpiCard label={translate("compliance.centre.staff.statActionRequired")} value={data?.kpis.action_required ?? 0} tone="danger" icon={<ShieldAlert />} />
      </KpiGrid>

      <div className="flex items-center gap-2 flex-wrap">
        <FilterChip label={translate("compliance.centre.staff.filterAll")} icon={<List size={12} />} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterChip label={translate("compliance.centre.staff.filterExpiring")} icon={<AlertTriangle size={12} />} active={filter === "expiring"} onClick={() => setFilter("expiring")} />
        <FilterChip label={translate("compliance.centre.staff.filterAction")} icon={<ShieldAlert size={12} />} active={filter === "action"} onClick={() => setFilter("action")} />
        <FilterChip label={translate("compliance.centre.staff.filterCompliant")} icon={<CircleCheck size={12} />} active={filter === "compliant"} onClick={() => setFilter("compliant")} />
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full border px-3.5 py-2 bg-white" style={{ borderColor: BORDER }}>
            <Search size={13} style={{ color: MUTED }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={translate("compliance.centre.staff.searchPlaceholder")}
              className="text-[12px] outline-none w-32"
              style={{ color: TEXT }}
            />
          </div>
          <button type="button" onClick={exportCsv} className="flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-[12px] font-semibold bg-white" style={{ borderColor: BORDER, color: MUTED }}>
            <Download size={13} /> {translate("compliance.centre.staff.export")}
          </button>
        </div>
      </div>

      <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-fixed border-collapse text-[13px]" style={{ minWidth: `${192 + Object.keys(credLabels).length * 84 + 76 + 96}px` }}>
            <thead>
              <tr style={{ background: SOFT }}>
                <th className="w-48 px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: MUTED }}>{translate("compliance.centre.staff.colWorker")}</th>
                {Object.entries(credLabels).map(([key, label]) => (
                  <th key={key} className="w-[84px] px-1.5 py-3 text-center text-[9px] font-bold uppercase tracking-wide leading-tight" style={{ color: MUTED }}>{label}</th>
                ))}
                <th className="w-[76px] px-2 py-3 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: MUTED }}>{translate("compliance.centre.staff.colAvgScore")}</th>
                <th className="w-24 px-2 py-3 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: MUTED }}>{translate("compliance.centre.staff.colStatus")}</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: BORDER }}>
              {filtered.map((w) => (
                <tr key={w.user_id} className="hover:bg-[var(--cc-soft)] transition-colors">
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Avatar name={w.full_name} size={26} />
                      <span className="font-semibold truncate" style={{ color: TEXT }}>{w.full_name}</span>
                    </span>
                  </td>
                  {Object.keys(credLabels).map((key) => {
                    const c = w.credentials[key];
                    if (!c) return <td key={key} className="px-1.5 py-3 text-center text-[11px]" style={{ color: MUTED }}>N/A</td>;
                    const icon = c.status === "valid"
                      ? <ShieldCheck size={13} className="shrink-0" style={{ color: SUCCESS }} />
                      : c.status === "expiring"
                        ? <AlertTriangle size={13} className="shrink-0" style={{ color: WARNING }} />
                        : <ShieldAlert size={13} className="shrink-0" style={{ color: CRITICAL }} />;
                    const expiry = c.expiry_date ? String(c.expiry_date).slice(0, 10) : "";
                    const [y, m, d] = expiry ? expiry.split("-") : [];
                    return (
                      <td key={key} className="px-1.5 py-3">
                        <div className="flex items-center justify-center gap-1">
                          {icon}
                          {expiry && <span className="text-[9px] whitespace-nowrap" style={{ color: MUTED }}>{d}/{m}/{y.slice(2)}</span>}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-2 py-3">
                    {w.avg_score != null ? <span className="font-black" style={{ color: scoreColor(w.avg_score) }}>{w.avg_score}</span> : <span style={{ color: MUTED }}>N/A</span>}
                  </td>
                  <td className="px-2 py-3">
                    {w.rp_flag
                      ? <StatusBadge label={translate("compliance.centre.status.rpFlagOpen")} tone="rd" />
                      : w.groups.includes("expiring")
                        ? <StatusBadge label={translate("compliance.centre.status.screeningDue")} tone="am" />
                        : <StatusBadge label={translate("compliance.centre.status.compliant")} tone="gn" />}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10}><EmptyState label={translate("compliance.centre.staff.noMatches")} /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {expiringSoon && (
        <Card className="rounded-2xl border-0 shadow-sm p-4 flex items-start gap-3" style={{ background: "rgba(217,119,6,0.06)" }}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(217,119,6,0.12)" }}>
            <Info size={16} style={{ color: WARNING }} />
          </span>
          <div>
            <p className="text-[13px] font-bold mb-0.5" style={{ color: "#92400E" }}>{translate("compliance.centre.staff.reminderTitle")}</p>
            <p className="text-[12px] mb-2" style={{ color: "#854D0B" }}>
              {translateParams("compliance.centre.staff.reminderBody", { name: expiringSoon.full_name })}
            </p>
            <button
              type="button"
              disabled={sendingId === expiringSoon.user_id}
              onClick={() => handleSendReminder(expiringSoon)}
              className="h-8 px-4 rounded-full text-[12px] font-bold text-white disabled:opacity-50"
              style={{ background: WARNING }}
            >
              {sendingId === expiringSoon.user_id ? translate("compliance.centre.staff.sending") : translate("compliance.centre.staff.sendReminder")}
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Participant compliance ────────────────────────────────────────────────────
function ParticipantsPanel() {
  const { translate, translateParams } = useAccessibility();
  const [dateRange, setDateRange] = useState<"30" | "90" | "180">("30");
  const dateFrom = useMemo(() => {
    const days = { "30": 30, "90": 90, "180": 180 }[dateRange];
    return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  }, [dateRange]);

  const { data, isLoading } = useQuery({
    queryKey: ["compliance-centre", "participants", dateFrom],
    queryFn: () => getComplianceCentreParticipants(dateFrom),
  });
  const [filter, setFilter] = useState<"all" | "flags" | "agreement" | "lowscore">("all");

  const participants = data?.participants ?? [];
  const filtered = useMemo(
    () => participants.filter((p) => filter === "all" || p.groups.includes(filter)),
    [participants, filter],
  );
  const unsignedExample = participants.find((p) => p.agreement_status === "unsigned");

  function exportCsv() {
    const header = ["Participant", "NDIS number", "Plan status", "Agreement", "Sessions", "Avg note quality", "Flags", "Worker"];
    const rows = filtered.map((p: ComplianceParticipantRow) => [
      p.full_name, p.ndis_number ?? "", p.plan_status, p.agreement_status,
      String(p.sessions_count), String(p.avg_note_quality ?? ""), p.flags.join("; "), p.worker_name,
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv" }), "participant-compliance.csv");
  }

  if (isLoading) return <LoadingBlock label={translate("common.loading")} />;

  return (
    <div className="space-y-5">
      <KpiGrid>
        <KpiCard label={translate("compliance.centre.participants.statParticipants")} value={data?.kpis.total_participants ?? 0} icon={<HeartHandshake />} />
        <KpiCard label={translate("compliance.centre.participants.statAgreementsSigned")} value={data?.kpis.agreements_signed ?? 0} tone="success" icon={<FileCheck2 />} />
        <KpiCard label={translate("compliance.centre.participants.statAvgNoteQuality")} value={data?.kpis.avg_note_quality ?? 0} tone={scoreTone(data?.kpis.avg_note_quality ?? 0)} icon={<BarChart3 />} />
        <KpiCard label={translate("compliance.centre.participants.statOpenFlags")} value={data?.kpis.open_flags ?? 0} tone="danger" icon={<Flag />} />
      </KpiGrid>

      <div className="flex items-center gap-2 flex-wrap">
        <FilterChip label={translate("compliance.centre.participants.filterAll")} icon={<List size={12} />} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterChip label={translate("compliance.centre.participants.filterFlags")} icon={<Flag size={12} />} active={filter === "flags"} onClick={() => setFilter("flags")} />
        <FilterChip label={translate("compliance.centre.participants.filterAgreement")} icon={<FileX size={12} />} active={filter === "agreement"} onClick={() => setFilter("agreement")} />
        <FilterChip label={translate("compliance.centre.participants.filterLowScore")} icon={<ArrowDownCircle size={12} />} active={filter === "lowscore"} onClick={() => setFilter("lowscore")} />
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as "30" | "90" | "180")}
          title="Date range"
          className="ml-auto text-[12px] rounded-full border px-3.5 py-2 bg-white"
          style={{ borderColor: BORDER, color: TEXT }}
        >
          <option value="30">{translate("compliance.centre.participants.range30")}</option>
          <option value="90">{translate("compliance.centre.participants.range90")}</option>
          <option value="180">{translate("compliance.centre.participants.range180")}</option>
        </select>
        <button type="button" onClick={exportCsv} className="flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-[12px] font-semibold bg-white" style={{ borderColor: BORDER, color: MUTED }}>
          <Download size={13} /> {translate("compliance.centre.participants.export")}
        </button>
      </div>

      <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr style={{ background: SOFT }}>
                {[
                  translate("compliance.centre.participants.colParticipant"),
                  translate("compliance.centre.participants.colPlanStatus"),
                  translate("compliance.centre.participants.colAgreement"),
                  translate("compliance.centre.participants.colSessions"),
                  translate("compliance.centre.participants.colNoteQuality"),
                  translate("compliance.centre.participants.colFlags"),
                  translate("compliance.centre.participants.colWorker"),
                  translate("compliance.centre.participants.colStatus"),
                ].map((h) => (
                  <th key={h} className="px-3 py-3 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: MUTED }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: BORDER }}>
              {filtered.map((p) => (
                <tr key={p.participant_id} className="hover:bg-[var(--cc-soft)] transition-colors">
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="flex items-center gap-2.5">
                      <Avatar name={p.full_name} size={26} />
                      <span className="min-w-0">
                        <p className="font-semibold" style={{ color: TEXT }}>{p.full_name}</p>
                        <p className="text-[10px]" style={{ color: MUTED }}>{translate("compliance.centre.participants.ndisNumberPrefix")} · {p.ndis_number ?? "N/A"}</p>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3"><StatusBadge label={p.plan_status} tone="pu" /></td>
                  <td className="px-3 py-3">
                    {p.agreement_status === "signed"
                      ? <StatusBadge label={translate("compliance.centre.status.signed")} tone="gn" />
                      : p.agreement_status === "expired"
                        ? <StatusBadge label={translate("compliance.centre.status.expired")} tone="am" />
                        : <StatusBadge label={translate("compliance.centre.status.unsigned")} tone="rd" />}
                  </td>
                  <td className="px-3 py-3 font-semibold" style={{ color: TEXT }}>{p.sessions_count}</td>
                  <td className="px-3 py-3">
                    {p.avg_note_quality != null ? <span className="font-black" style={{ color: scoreColor(p.avg_note_quality) }}>{p.avg_note_quality}</span> : <span style={{ color: MUTED }}>N/A</span>}
                  </td>
                  <td className="px-3 py-3">
                    {p.flags.length === 0
                      ? <span className="text-[12px]" style={{ color: MUTED }}>{translate("compliance.centre.participants.flagsNone")}</span>
                      : (
                        <div className="flex gap-1 flex-wrap">
                          {p.flags.map((f) => (
                            <span key={f} className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: f === "rp" ? "rgba(220,38,38,0.1)" : "rgba(217,119,6,0.1)", color: f === "rp" ? CRITICAL : WARNING }}>
                              {f === "rp" ? translate("compliance.centre.participants.flagRp") : f === "agreement" ? translate("compliance.centre.participants.flagAgreement") : translate("compliance.centre.participants.flagGoal")}
                            </span>
                          ))}
                        </div>
                      )}
                  </td>
                  <td className="px-3 py-3 text-[12px] whitespace-nowrap" style={{ color: TEXT }}>{p.worker_name}</td>
                  <td className="px-3 py-3">
                    {p.flags.length > 0
                      ? <StatusBadge label={translate("compliance.centre.status.actionRequired")} tone="rd" />
                      : <StatusBadge label={translate("compliance.centre.status.compliant")} tone="gn" />}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8}><EmptyState label={translate("compliance.centre.participants.noMatches")} /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {unsignedExample && (
        <Card className="rounded-2xl border-0 shadow-sm p-4 flex items-start gap-3" style={{ background: "rgba(220,38,38,0.05)" }}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(220,38,38,0.12)" }}>
            <ShieldAlert size={16} style={{ color: CRITICAL }} />
          </span>
          <div>
            <p className="text-[13px] font-bold mb-0.5" style={{ color: CRITICAL }}>{translateParams("compliance.centre.participants.agreementBannerTitle", { name: unsignedExample.full_name })}</p>
            <p className="text-[12px] mb-2" style={{ color: TEXT }}>
              {translate("compliance.centre.participants.agreementBannerBody")}
            </p>
            <Link href={`/patients/${unsignedExample.participant_id}`}>
              <span className="inline-flex h-8 px-4 items-center rounded-full text-[12px] font-bold text-white cursor-pointer" style={{ background: "var(--cc-cta)" }}>
                {translate("compliance.centre.participants.viewParticipant")}
              </span>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Incidents ─────────────────────────────────────────────────────────────────
function IncidentsPanel() {
  const { translate } = useAccessibility();
  const { data, isLoading } = useQuery({ queryKey: ["compliance-centre", "incidents"], queryFn: getComplianceCentreIncidents });

  if (isLoading) return <LoadingBlock label={translate("common.loading")} />;

  function actionFor(incident: NonNullable<typeof data>["incidents"][number]) {
    if (incident.status !== "closed" && incident.incident_type === "restrictive_practice") {
      return (
        <Link href={`/incident-new?participant_id=${incident.id}&type=restrictive_practice`}>
          <span className="inline-flex items-center gap-1 text-[12px] font-bold cursor-pointer px-2.5 py-1 rounded-full" style={{ color: CRITICAL, background: "rgba(220,38,38,0.08)" }}>
            <FilePlus size={13} /> {translate("compliance.centre.incidents.fileReport")}
          </span>
        </Link>
      );
    }
    if (incident.status === "closed") {
      return (
        <Link href={`/incident/${incident.id}`}>
          <span className="inline-flex items-center gap-1 text-[12px] font-bold cursor-pointer px-2.5 py-1 rounded-full" style={{ color: PLUM, background: "var(--cc-plum-soft)" }}>
            <FileText size={13} /> {translate("compliance.centre.incidents.viewReport")}
          </span>
        </Link>
      );
    }
    return (
      <Link href={`/incident/${incident.id}`}>
        <span className="inline-flex items-center gap-1 text-[12px] font-bold cursor-pointer px-2.5 py-1 rounded-full" style={{ color: PLUM, background: "var(--cc-plum-soft)" }}>
          <Eye size={13} /> {translate("compliance.centre.incidents.review")}
        </span>
      </Link>
    );
  }

  return (
    <div className="space-y-5">
      <KpiGrid>
        <KpiCard label={translate("compliance.centre.incidents.statOpen")} value={data?.kpis.open_incidents ?? 0} tone="danger" icon={<Flag />} />
        <KpiCard label={translate("compliance.centre.incidents.statRpFlags")} value={data?.kpis.rp_flags ?? 0} tone="danger" icon={<ShieldAlert />} />
        <KpiCard label={translate("compliance.centre.incidents.statResolvedThisMonth")} value={data?.kpis.resolved_this_month ?? 0} tone="success" icon={<CircleCheck />} />
      </KpiGrid>

      <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr style={{ background: SOFT }}>
                {[
                  translate("compliance.centre.incidents.colDate"),
                  translate("compliance.centre.incidents.colWorker"),
                  translate("compliance.centre.incidents.colParticipant"),
                  translate("compliance.centre.incidents.colType"),
                  translate("compliance.centre.incidents.colDescription"),
                  translate("compliance.centre.incidents.colStatus"),
                  translate("compliance.centre.incidents.colAction"),
                ].map((h) => (
                  <th key={h} className="px-3 py-3 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: MUTED }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: BORDER }}>
              {(data?.incidents ?? []).map((inc) => (
                <tr key={inc.id} className="hover:bg-[var(--cc-soft)] transition-colors">
                  <td className="px-3 py-3 text-[12px] whitespace-nowrap" style={{ color: TEXT }}>{String(inc.incident_date).slice(0, 10)}</td>
                  <td className="px-3 py-3 text-[12px] whitespace-nowrap" style={{ color: TEXT }}>{inc.worker_name}</td>
                  <td className="px-3 py-3 text-[12px] whitespace-nowrap" style={{ color: TEXT }}>{inc.participant_name}</td>
                  <td className="px-3 py-3">
                    <StatusBadge
                      label={inc.incident_type === "restrictive_practice" ? translate("compliance.centre.incidents.restrictivePractice") : inc.incident_type.replace(/_/g, " ")}
                      tone={inc.ndis_reportable ? "rd" : "am"}
                    />
                  </td>
                  <td className="px-3 py-3 text-[12px] max-w-[220px] truncate" style={{ color: MUTED }} title={inc.description}>{inc.description}</td>
                  <td className="px-3 py-3">
                    <StatusBadge label={inc.status.replace(/_/g, " ")} tone={inc.status === "closed" ? "gn" : inc.status === "under_investigation" ? "am" : "rd"} />
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{actionFor(inc)}</td>
                </tr>
              ))}
              {(data?.incidents.length ?? 0) === 0 && (
                <tr><td colSpan={7}><EmptyState label={translate("compliance.centre.incidents.noIncidents")} /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
