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
import {
  Download, AlertTriangle, ShieldAlert, ShieldCheck, Users, HeartHandshake,
  ListChecks, FileX, Search, BarChart3, Flag,
  FileCheck2, Info, ArrowRight, Eye, FilePlus, FileText, List,
  ArrowDownCircle, CircleCheck,
} from "lucide-react";

// ── Design tokens ─────────────────────────────────────────────────────────────
const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

function scoreColor(score: number) {
  return score >= 85 ? "#16A34A" : score >= 60 ? "#D97706" : "#DC2626";
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

// ── Stat strip (single flat container, not a repeated card grid) ────────────
type Stat = { label: string; value: string | number; sub?: string; color?: string; icon: React.ReactNode };
function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 rounded-xl border bg-white px-5 py-3" style={{ borderColor: BORDER }}>
      {stats.map((s, i) => (
        <div key={s.label} className="flex items-center gap-6">
          {i > 0 && <div className="h-7 w-px hidden sm:block" style={{ background: BORDER }} />}
          <div className="flex items-center gap-2">
            <span className="shrink-0" style={{ color: MUTED }}>{s.icon}</span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider leading-none" style={{ color: MUTED }}>{s.label}</p>
              <p className="text-lg font-black leading-tight mt-0.5" style={{ color: s.color ?? TEXT }}>
                {s.value}{s.sub && <span className="ml-1.5 text-[10px] font-medium" style={{ color: MUTED }}>{s.sub}</span>}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Filter chip row ───────────────────────────────────────────────────────────
function FilterChip({ label, active, icon, onClick }: { label: string; active: boolean; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors whitespace-nowrap"
      style={active
        ? { background: "rgba(55,48,163,0.08)", border: `1px solid ${PLUM}`, color: PLUM }
        : { background: "#fff", border: `1px solid ${BORDER}`, color: MUTED }}
    >
      {icon} {label}
    </button>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "gn" | "am" | "rd" | "pu" | "gy" }) {
  const map: Record<string, { bg: string; color: string }> = {
    gn: { bg: "rgba(22,163,74,0.1)", color: "#16A34A" },
    am: { bg: "rgba(217,119,6,0.1)", color: "#D97706" },
    rd: { bg: "rgba(220,38,38,0.1)", color: "#DC2626" },
    pu: { bg: "rgba(55,48,163,0.08)", color: PLUM },
    gy: { bg: SOFT, color: MUTED },
  };
  const c = map[tone];
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full" style={{ background: c.bg, color: c.color }}>
      {label}
    </span>
  );
}

// ── Sub-tabs ──────────────────────────────────────────────────────────────────
type SubTab = "overview" | "staff" | "participants" | "incidents" | "audit_pack";
const SUB_TABS: SubTab[] = ["overview", "staff", "participants", "incidents", "audit_pack"];

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Compliance() {
  const { translate } = useAccessibility();
  const search = useSearch();
  const [, navigate] = useLocation();
  const initialTab = (new URLSearchParams(search).get("tab") as SubTab | null) ?? "overview";
  const [activeTab, setActiveTabState] = useState<SubTab>(
    SUB_TABS.includes(initialTab) ? initialTab : "overview",
  );

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

  return (
    <div className="flex flex-col gap-3 pb-8">
      <div className="flex items-center justify-between gap-3 border-b pb-3" style={{ borderColor: BORDER }}>
        <h1 className="text-xl font-black tracking-tight" style={{ color: PLUM }}>{translate("compliance.page.title")}</h1>
      </div>

      <div className="flex gap-1 border-b pb-0 flex-wrap" style={{ borderColor: BORDER }}>
        {SUB_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className="px-3.5 py-2 text-[13px] font-bold border-b-2 -mb-px transition-colors"
            style={{
              color: activeTab === tab ? PLUM : MUTED,
              borderColor: activeTab === tab ? PLUM : "transparent",
            }}
          >
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      {activeTab === "overview" && <OverviewPanel onNavigateTab={setActiveTab} />}
      {activeTab === "staff" && <StaffPanel />}
      {activeTab === "participants" && <ParticipantsPanel />}
      {activeTab === "incidents" && <IncidentsPanel />}
      {activeTab === "audit_pack" && <AuditPackPanel />}
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
  const circ = 2 * Math.PI * 34;

  if (isLoading) return <div className="py-16 text-center text-[13px]" style={{ color: MUTED }}>{translate("common.loading")}</div>;

  return (
    <div className="space-y-3">
      <StatStrip stats={[
        { label: translate("compliance.centre.overview.statOverallScore"), value: Math.round(avg), sub: translate("compliance.centre.overview.statOverallScoreSub"), color: arcColor, icon: <BarChart3 size={13} /> },
        { label: translate("compliance.centre.overview.statCompliantSessions"), value: bands.compliant, sub: translate("compliance.centre.overview.statCompliantSub"), color: "#16A34A", icon: <CircleCheck size={13} /> },
        { label: translate("compliance.centre.overview.statAtRiskSessions"), value: bands.at_risk, sub: translate("compliance.centre.overview.statAtRiskSub"), color: "#D97706", icon: <AlertTriangle size={13} /> },
        { label: translate("compliance.centre.overview.statOpenIncidents"), value: data?.kpis.open_incidents ?? 0, sub: translate("compliance.centre.overview.statOpenIncidentsSub"), color: "#DC2626", icon: <ShieldAlert size={13} /> },
      ]} />

      {(data?.urgent_actions.length ?? 0) > 0 && (
        <div className="rounded-xl p-3.5 flex items-start gap-3" style={{ background: "rgba(190,24,93,0.06)", border: "1px solid rgba(190,24,93,0.25)" }}>
          <AlertTriangle size={18} className="shrink-0 mt-0.5" style={{ color: CORAL }} />
          <div className="min-w-0">
            <p className="text-[13px] font-bold mb-1.5" style={{ color: CORAL }}>
              {translateParams(
                data!.urgent_actions.length !== 1 ? "compliance.centre.overview.urgentActionPlural" : "compliance.centre.overview.urgentAction",
                { count: String(data!.urgent_actions.length) },
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {data!.urgent_actions.map((a, i) => (
                <Link key={i} href={a.link}>
                  <span
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full cursor-pointer hover:opacity-80"
                    style={{ background: a.severity === "critical" ? "rgba(220,38,38,0.1)" : "rgba(217,119,6,0.1)", color: a.severity === "critical" ? "#DC2626" : "#D97706" }}
                  >
                    {a.type === "incident" ? <ShieldAlert size={11} /> : a.type === "credential" ? <FileText size={11} /> : <FileX size={11} />}
                    {a.label}{a.detail ? ` · ${a.detail}` : ""}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border bg-white p-3.5" style={{ borderColor: BORDER }}>
          <p className="text-[13px] font-bold" style={{ color: TEXT }}>{translate("compliance.centre.overview.bandsTitle")}</p>
          <p className="text-[11px] mb-2" style={{ color: MUTED }}>{translate("compliance.centre.overview.bandsSubtitle")}</p>
          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16 shrink-0">
              <svg width="64" height="64" viewBox="0 0 80 80" className="-rotate-90">
                <circle cx="40" cy="40" r="34" fill="none" stroke={SOFT} strokeWidth="8" />
                <circle
                  cx="40" cy="40" r="34" fill="none" stroke={arcColor} strokeWidth="8"
                  strokeDasharray={circ} strokeDashoffset={circ * (1 - avg / 100)} strokeLinecap="round"
                  className="transition-all duration-700"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-base font-black" style={{ color: TEXT }}>{Math.round(avg)}</span>
              </div>
            </div>
            <div className="flex-1 space-y-1">
              {[
                { label: translate("compliance.centre.overview.bandCompliant"), count: bands.compliant, color: "#16A34A" },
                { label: translate("compliance.centre.overview.bandAtRisk"), count: bands.at_risk, color: "#D97706" },
                { label: translate("compliance.centre.overview.bandNonCompliant"), count: bands.non_compliant, color: "#DC2626" },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between text-[12px] py-0.5">
                  <span className="flex items-center gap-1.5" style={{ color: TEXT }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: row.color }} /> {row.label}
                  </span>
                  <span className="font-black" style={{ color: row.color }}>{row.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-3.5" style={{ borderColor: BORDER }}>
          <div className="flex items-center gap-1.5">
            <ListChecks size={14} style={{ color: MUTED }} />
            <p className="text-[13px] font-bold" style={{ color: TEXT }}>{translate("compliance.centre.overview.issuesTitle")}</p>
          </div>
          <p className="text-[11px] mb-2" style={{ color: MUTED }}>{translate("compliance.centre.overview.issuesSubtitle")}</p>
          {(data?.common_issues.length ?? 0) === 0 ? (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-green-50/50 border border-green-100 text-[#16A34A]">
              <CircleCheck size={14} /> <span className="text-[12px] font-bold">{translate("compliance.centre.overview.noIssues")}</span>
            </div>
          ) : (
            <div className="space-y-2">
              {data!.common_issues.map((issue) => (
                <div key={issue.rule_code} className="space-y-0.5">
                  <div className="flex justify-between text-[12px]">
                    <span className="font-semibold truncate max-w-[70%]" style={{ color: TEXT }}>{issue.label}</span>
                    <span className="font-bold" style={{ color: issue.pct >= 50 ? "#DC2626" : "#D97706" }}>
                      {translateParams(issue.count !== 1 ? "compliance.centre.overview.issueSessionCountPlural" : "compliance.centre.overview.issueSessionCount", { count: String(issue.count) })}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: SOFT }}>
                    <div className="h-full rounded-full" style={{ width: `${issue.pct}%`, background: issue.pct >= 50 ? "#DC2626" : "#D97706" }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border bg-white p-3.5" style={{ borderColor: BORDER }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Users size={14} style={{ color: MUTED }} />
            <p className="text-[13px] font-bold" style={{ color: TEXT }}>{translate("compliance.centre.overview.staffSnapshotTitle")}</p>
          </div>
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {(data?.staff_snapshot.length ?? 0) === 0 && <p className="text-[12px] py-2" style={{ color: MUTED }}>{translate("compliance.centre.overview.noStaffData")}</p>}
            {data?.staff_snapshot.map((w) => (
              <div key={w.user_id} className="flex items-center justify-between py-2 text-[12px]">
                <span className="font-semibold" style={{ color: TEXT }}>{w.full_name}</span>
                <div className="flex items-center gap-2">
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
          <button type="button" onClick={() => onNavigateTab("staff")} className="mt-1.5 flex items-center gap-1 text-[12px] font-bold hover:opacity-70" style={{ color: PLUM }}>
            <ArrowRight size={13} /> {translate("compliance.centre.overview.viewAllStaff")}
          </button>
        </div>

        <div className="rounded-xl border bg-white p-3.5" style={{ borderColor: BORDER }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <HeartHandshake size={14} style={{ color: MUTED }} />
            <p className="text-[13px] font-bold" style={{ color: TEXT }}>{translate("compliance.centre.overview.participantSnapshotTitle")}</p>
          </div>
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {(data?.participant_snapshot.length ?? 0) === 0 && <p className="text-[12px] py-2" style={{ color: MUTED }}>{translate("compliance.centre.overview.noParticipantData")}</p>}
            {data?.participant_snapshot.map((p) => (
              <div key={p.participant_id} className="flex items-center justify-between py-2 text-[12px]">
                <span className="font-semibold" style={{ color: TEXT }}>{p.full_name}</span>
                <div className="flex items-center gap-2">
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
          <button type="button" onClick={() => onNavigateTab("participants")} className="mt-1.5 flex items-center gap-1 text-[12px] font-bold hover:opacity-70" style={{ color: PLUM }}>
            <ArrowRight size={13} /> {translate("compliance.centre.overview.viewAllParticipants")}
          </button>
        </div>
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

  if (isLoading) return <div className="py-16 text-center text-[13px]" style={{ color: MUTED }}>{translate("common.loading")}</div>;

  return (
    <div className="space-y-3">
      <StatStrip stats={[
        { label: translate("compliance.centre.staff.statTotalWorkers"), value: data?.kpis.total_workers ?? 0, icon: <Users size={13} /> },
        { label: translate("compliance.centre.staff.statFullyCompliant"), value: data?.kpis.fully_compliant ?? 0, color: "#16A34A", icon: <CircleCheck size={13} /> },
        { label: translate("compliance.centre.staff.statExpiringCredentials"), value: data?.kpis.expiring_credentials ?? 0, color: "#D97706", icon: <AlertTriangle size={13} /> },
        { label: translate("compliance.centre.staff.statActionRequired"), value: data?.kpis.action_required ?? 0, color: "#DC2626", icon: <ShieldAlert size={13} /> },
      ]} />

      <div className="flex items-center gap-2 flex-wrap">
        <FilterChip label={translate("compliance.centre.staff.filterAll")} icon={<List size={12} />} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterChip label={translate("compliance.centre.staff.filterExpiring")} icon={<AlertTriangle size={12} />} active={filter === "expiring"} onClick={() => setFilter("expiring")} />
        <FilterChip label={translate("compliance.centre.staff.filterAction")} icon={<ShieldAlert size={12} />} active={filter === "action"} onClick={() => setFilter("action")} />
        <FilterChip label={translate("compliance.centre.staff.filterCompliant")} icon={<CircleCheck size={12} />} active={filter === "compliant"} onClick={() => setFilter("compliant")} />
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5" style={{ borderColor: BORDER }}>
            <Search size={13} style={{ color: MUTED }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={translate("compliance.centre.staff.searchPlaceholder")}
              className="text-[12px] outline-none w-32"
              style={{ color: TEXT }}
            />
          </div>
          <button type="button" onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-semibold" style={{ borderColor: BORDER, color: MUTED }}>
            <Download size={13} /> {translate("compliance.centre.staff.export")}
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: BORDER }}>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="border-b" style={{ borderColor: BORDER, background: SOFT }}>
                <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: MUTED }}>{translate("compliance.centre.staff.colWorker")}</th>
                {Object.entries(credLabels).map(([key, label]) => (
                  <th key={key} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: MUTED }}>{label}</th>
                ))}
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: MUTED }}>{translate("compliance.centre.staff.colAvgScore")}</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: MUTED }}>{translate("compliance.centre.staff.colStatus")}</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: BORDER }}>
              {filtered.map((w) => (
                <tr key={w.user_id}>
                  <td className="px-4 py-2.5 font-semibold whitespace-nowrap" style={{ color: TEXT }}>{w.full_name}</td>
                  {Object.keys(credLabels).map((key) => {
                    const c = w.credentials[key];
                    if (!c) return <td key={key} className="px-3 py-2.5 text-[11px]" style={{ color: MUTED }}>—</td>;
                    const icon = c.status === "valid"
                      ? <ShieldCheck size={14} style={{ color: "#16A34A" }} />
                      : c.status === "expiring"
                        ? <AlertTriangle size={14} style={{ color: "#D97706" }} />
                        : <ShieldAlert size={14} style={{ color: "#DC2626" }} />;
                    return (
                      <td key={key} className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {icon}
                          <span className="text-[10px]" style={{ color: MUTED }}>{c.expiry_date ? String(c.expiry_date).slice(0, 10) : ""}</span>
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2.5">
                    {w.avg_score != null ? <span className="font-black" style={{ color: scoreColor(w.avg_score) }}>{w.avg_score}</span> : <span style={{ color: MUTED }}>—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {w.rp_flag
                      ? <StatusBadge label={translate("compliance.centre.status.rpFlagOpen")} tone="rd" />
                      : w.groups.includes("expiring")
                        ? <StatusBadge label={translate("compliance.centre.status.screeningDue")} tone="am" />
                        : <StatusBadge label={translate("compliance.centre.status.compliant")} tone="gn" />}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-6 text-center text-[12px]" style={{ color: MUTED }}>{translate("compliance.centre.staff.noMatches")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {expiringSoon && (
        <div className="rounded-xl p-3.5 flex items-start gap-3" style={{ background: "rgba(217,119,6,0.06)", border: "1px solid rgba(217,119,6,0.25)" }}>
          <Info size={16} className="shrink-0 mt-0.5" style={{ color: "#D97706" }} />
          <div>
            <p className="text-[13px] font-bold mb-0.5" style={{ color: "#92400E" }}>{translate("compliance.centre.staff.reminderTitle")}</p>
            <p className="text-[12px] mb-1.5" style={{ color: "#854D0B" }}>
              {translateParams("compliance.centre.staff.reminderBody", { name: expiringSoon.full_name })}
            </p>
            <button
              type="button"
              disabled={sendingId === expiringSoon.user_id}
              onClick={() => handleSendReminder(expiringSoon)}
              className="h-8 px-3 rounded-lg text-[12px] font-bold text-white disabled:opacity-50"
              style={{ background: "#D97706" }}
            >
              {sendingId === expiringSoon.user_id ? translate("compliance.centre.staff.sending") : translate("compliance.centre.staff.sendReminder")}
            </button>
          </div>
        </div>
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

  if (isLoading) return <div className="py-16 text-center text-[13px]" style={{ color: MUTED }}>{translate("common.loading")}</div>;

  return (
    <div className="space-y-3">
      <StatStrip stats={[
        { label: translate("compliance.centre.participants.statParticipants"), value: data?.kpis.total_participants ?? 0, icon: <HeartHandshake size={13} /> },
        { label: translate("compliance.centre.participants.statAgreementsSigned"), value: data?.kpis.agreements_signed ?? 0, color: "#16A34A", icon: <FileCheck2 size={13} /> },
        { label: translate("compliance.centre.participants.statAvgNoteQuality"), value: data?.kpis.avg_note_quality ?? 0, color: scoreColor(data?.kpis.avg_note_quality ?? 0), icon: <BarChart3 size={13} /> },
        { label: translate("compliance.centre.participants.statOpenFlags"), value: data?.kpis.open_flags ?? 0, color: "#DC2626", icon: <Flag size={13} /> },
      ]} />

      <div className="flex items-center gap-2 flex-wrap">
        <FilterChip label={translate("compliance.centre.participants.filterAll")} icon={<List size={12} />} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterChip label={translate("compliance.centre.participants.filterFlags")} icon={<Flag size={12} />} active={filter === "flags"} onClick={() => setFilter("flags")} />
        <FilterChip label={translate("compliance.centre.participants.filterAgreement")} icon={<FileX size={12} />} active={filter === "agreement"} onClick={() => setFilter("agreement")} />
        <FilterChip label={translate("compliance.centre.participants.filterLowScore")} icon={<ArrowDownCircle size={12} />} active={filter === "lowscore"} onClick={() => setFilter("lowscore")} />
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as "30" | "90" | "180")}
          title="Date range"
          className="ml-auto text-[12px] rounded-lg border px-3 py-1.5"
          style={{ borderColor: BORDER, color: TEXT }}
        >
          <option value="30">{translate("compliance.centre.participants.range30")}</option>
          <option value="90">{translate("compliance.centre.participants.range90")}</option>
          <option value="180">{translate("compliance.centre.participants.range180")}</option>
        </select>
        <button type="button" onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-semibold" style={{ borderColor: BORDER, color: MUTED }}>
          <Download size={13} /> {translate("compliance.centre.participants.export")}
        </button>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: BORDER }}>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="border-b" style={{ borderColor: BORDER, background: SOFT }}>
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
                  <th key={h} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: MUTED }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: BORDER }}>
              {filtered.map((p) => (
                <tr key={p.participant_id}>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <p className="font-semibold" style={{ color: TEXT }}>{p.full_name}</p>
                    <p className="text-[10px]" style={{ color: MUTED }}>{translate("compliance.centre.participants.ndisNumberPrefix")} · {p.ndis_number ?? "—"}</p>
                  </td>
                  <td className="px-3 py-2.5"><StatusBadge label={p.plan_status} tone="pu" /></td>
                  <td className="px-3 py-2.5">
                    {p.agreement_status === "signed"
                      ? <StatusBadge label={translate("compliance.centre.status.signed")} tone="gn" />
                      : p.agreement_status === "expired"
                        ? <StatusBadge label={translate("compliance.centre.status.expired")} tone="am" />
                        : <StatusBadge label={translate("compliance.centre.status.unsigned")} tone="rd" />}
                  </td>
                  <td className="px-3 py-2.5 font-semibold" style={{ color: TEXT }}>{p.sessions_count}</td>
                  <td className="px-3 py-2.5">
                    {p.avg_note_quality != null ? <span className="font-black" style={{ color: scoreColor(p.avg_note_quality) }}>{p.avg_note_quality}</span> : <span style={{ color: MUTED }}>—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {p.flags.length === 0
                      ? <span className="text-[12px]" style={{ color: MUTED }}>{translate("compliance.centre.participants.flagsNone")}</span>
                      : (
                        <div className="flex gap-1 flex-wrap">
                          {p.flags.map((f) => (
                            <span key={f} className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: f === "rp" ? "rgba(220,38,38,0.1)" : "rgba(217,119,6,0.1)", color: f === "rp" ? "#DC2626" : "#D97706" }}>
                              {f === "rp" ? translate("compliance.centre.participants.flagRp") : f === "agreement" ? translate("compliance.centre.participants.flagAgreement") : translate("compliance.centre.participants.flagGoal")}
                            </span>
                          ))}
                        </div>
                      )}
                  </td>
                  <td className="px-3 py-2.5 text-[12px] whitespace-nowrap" style={{ color: TEXT }}>{p.worker_name}</td>
                  <td className="px-3 py-2.5">
                    {p.flags.length > 0
                      ? <StatusBadge label={translate("compliance.centre.status.actionRequired")} tone="rd" />
                      : <StatusBadge label={translate("compliance.centre.status.compliant")} tone="gn" />}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-[12px]" style={{ color: MUTED }}>{translate("compliance.centre.participants.noMatches")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {unsignedExample && (
        <div className="rounded-xl p-3.5 flex items-start gap-3" style={{ background: "rgba(190,24,93,0.06)", border: "1px solid rgba(190,24,93,0.25)" }}>
          <ShieldAlert size={16} className="shrink-0 mt-0.5" style={{ color: CORAL }} />
          <div>
            <p className="text-[13px] font-bold mb-0.5" style={{ color: CORAL }}>{translateParams("compliance.centre.participants.agreementBannerTitle", { name: unsignedExample.full_name })}</p>
            <p className="text-[12px] mb-1.5" style={{ color: TEXT }}>
              {translate("compliance.centre.participants.agreementBannerBody")}
            </p>
            <Link href={`/patients/${unsignedExample.participant_id}`}>
              <span className="inline-flex h-8 px-3 items-center rounded-lg text-[12px] font-bold text-white cursor-pointer" style={{ background: CORAL }}>
                {translate("compliance.centre.participants.viewParticipant")}
              </span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Incidents ─────────────────────────────────────────────────────────────────
function IncidentsPanel() {
  const { translate } = useAccessibility();
  const { data, isLoading } = useQuery({ queryKey: ["compliance-centre", "incidents"], queryFn: getComplianceCentreIncidents });

  if (isLoading) return <div className="py-16 text-center text-[13px]" style={{ color: MUTED }}>{translate("common.loading")}</div>;

  function actionFor(incident: NonNullable<typeof data>["incidents"][number]) {
    if (incident.status !== "closed" && incident.incident_type === "restrictive_practice") {
      return (
        <Link href={`/incident-new?participant_id=${incident.id}&type=restrictive_practice`}>
          <span className="inline-flex items-center gap-1 text-[12px] font-bold cursor-pointer" style={{ color: "#DC2626" }}>
            <FilePlus size={13} /> {translate("compliance.centre.incidents.fileReport")}
          </span>
        </Link>
      );
    }
    if (incident.status === "closed") {
      return (
        <Link href={`/incident/${incident.id}`}>
          <span className="inline-flex items-center gap-1 text-[12px] font-bold cursor-pointer" style={{ color: PLUM }}>
            <FileText size={13} /> {translate("compliance.centre.incidents.viewReport")}
          </span>
        </Link>
      );
    }
    return (
      <Link href={`/incident/${incident.id}`}>
        <span className="inline-flex items-center gap-1 text-[12px] font-bold cursor-pointer" style={{ color: PLUM }}>
          <Eye size={13} /> {translate("compliance.centre.incidents.review")}
        </span>
      </Link>
    );
  }

  return (
    <div className="space-y-3">
      <StatStrip stats={[
        { label: translate("compliance.centre.incidents.statOpen"), value: data?.kpis.open_incidents ?? 0, color: "#DC2626", icon: <Flag size={13} /> },
        { label: translate("compliance.centre.incidents.statRpFlags"), value: data?.kpis.rp_flags ?? 0, color: "#DC2626", icon: <ShieldAlert size={13} /> },
        { label: translate("compliance.centre.incidents.statResolvedThisMonth"), value: data?.kpis.resolved_this_month ?? 0, color: "#16A34A", icon: <CircleCheck size={13} /> },
      ]} />

      <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: BORDER }}>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="border-b" style={{ borderColor: BORDER, background: SOFT }}>
                {[
                  translate("compliance.centre.incidents.colDate"),
                  translate("compliance.centre.incidents.colWorker"),
                  translate("compliance.centre.incidents.colParticipant"),
                  translate("compliance.centre.incidents.colType"),
                  translate("compliance.centre.incidents.colDescription"),
                  translate("compliance.centre.incidents.colStatus"),
                  translate("compliance.centre.incidents.colAction"),
                ].map((h) => (
                  <th key={h} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: MUTED }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: BORDER }}>
              {(data?.incidents ?? []).map((inc) => (
                <tr key={inc.id}>
                  <td className="px-3 py-2.5 text-[12px] whitespace-nowrap" style={{ color: TEXT }}>{String(inc.incident_date).slice(0, 10)}</td>
                  <td className="px-3 py-2.5 text-[12px] whitespace-nowrap" style={{ color: TEXT }}>{inc.worker_name}</td>
                  <td className="px-3 py-2.5 text-[12px] whitespace-nowrap" style={{ color: TEXT }}>{inc.participant_name}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge
                      label={inc.incident_type === "restrictive_practice" ? translate("compliance.centre.incidents.restrictivePractice") : inc.incident_type.replace(/_/g, " ")}
                      tone={inc.ndis_reportable ? "rd" : "am"}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-[12px] max-w-[220px] truncate" style={{ color: MUTED }} title={inc.description}>{inc.description}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge label={inc.status.replace(/_/g, " ")} tone={inc.status === "closed" ? "gn" : inc.status === "under_investigation" ? "am" : "rd"} />
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{actionFor(inc)}</td>
                </tr>
              ))}
              {(data?.incidents.length ?? 0) === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-[12px]" style={{ color: MUTED }}>{translate("compliance.centre.incidents.noIncidents")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
