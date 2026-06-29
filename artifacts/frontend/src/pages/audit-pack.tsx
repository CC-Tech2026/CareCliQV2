import { useState, useCallback, useMemo } from "react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  AlertTriangle, FileCheck2, ShieldCheck, Download,
  TrendingUp, TrendingDown, Minus, Flag,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  getCoordinatorComplianceOverview,
  getCoordinatorRpFlags,
  getCoordinatorWorkerStats,
  getCoordinatorFlaggedSessions,
} from "@/services/coordinatorService";
import { Button } from "@/components/ui/button";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const PLUM  = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const TEXT  = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT  = "#F8F8FE";

function complianceColour(score?: number | null) {
  if (score == null) return MUTED;
  if (score >= 85) return "#16A34A";
  if (score >= 60) return "#D97706";
  return "#DC2626";
}

function TrendIcon({ score }: { score?: number | null }) {
  if (score == null) return <Minus size={14} color={MUTED} />;
  if (score >= 85) return <TrendingUp size={14} color="#16A34A" />;
  if (score >= 60) return <Minus size={14} color="#D97706" />;
  return <TrendingDown size={14} color="#DC2626" />;
}

type ExportTab = "summary" | "workers" | "flagged";

export default function AuditPack() {
  const { translate, translateParams } = useAccessibility();
  const [activeTab, setActiveTab] = useState<ExportTab>("summary");

  const compliance = useOrgQuery(["coordinator", "compliance-overview"], { queryFn: getCoordinatorComplianceOverview });
  const flags      = useOrgQuery(["coordinator", "rp-flags"],             { queryFn: getCoordinatorRpFlags });
  const workers    = useOrgQuery(["coordinator", "worker-stats"],          { queryFn: getCoordinatorWorkerStats });
  const flagged    = useOrgQuery(["coordinator", "flagged-sessions"],      { queryFn: getCoordinatorFlaggedSessions });

  const handleExport = useCallback(() => {
    const report = {
      generated_at: new Date().toISOString(),
      generated_for: "NDIS Audit Pack",
      summary: compliance.data
        ? {
            average_score: compliance.data.average_score,
            total_sessions: compliance.data.total_sessions,
            compliant: compliance.data.compliant,
            at_risk: compliance.data.at_risk,
            non_compliant: compliance.data.non_compliant,
          }
        : null,
      worker_performance: (workers.data || []).map((w) => ({
        name: w.full_name,
        role: w.role,
        total_sessions: w.total_sessions,
        avg_compliance: w.avg_compliance,
        draft_notes: w.draft_count,
        flagged_sessions: w.flagged_count,
        is_active: w.is_active,
      })),
      restrictive_practice_flags: flags.data || [],
      sessions_flagged_for_review: flagged.data || [],
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `carescribe-audit-pack-${format(new Date(), "yyyy-MM-dd")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [compliance.data, workers.data, flags.data, flagged.data]);

  const tabs: { key: ExportTab; label: string }[] = useMemo(() => [
    { key: "summary",  label: translate("auditPack.tab.summary") },
    { key: "workers",  label: translate("auditPack.tab.workers") },
    { key: "flagged",  label: translate("auditPack.tab.flagged") },
  ], [translate]);

  const statCards = useMemo(() => [
    {
      icon: ShieldCheck,
      label: translate("auditPack.stat.teamCompliance"),
      value: compliance.data ? `${compliance.data.average_score}%` : translate("common.emDash"),
      colour: complianceColour(compliance.data?.average_score),
    },
    {
      icon: FileCheck2,
      label: translate("auditPack.stat.sessionRecords"),
      value: compliance.data?.total_sessions ?? translate("common.emDash"),
      colour: PLUM,
    },
    {
      icon: AlertTriangle,
      label: translate("auditPack.stat.rpFlags"),
      value: flags.data?.length ?? translate("common.emDash"),
      colour: CORAL,
    },
    {
      icon: Flag,
      label: translate("auditPack.stat.needsReview"),
      value: flagged.data?.length ?? translate("common.emDash"),
      colour: "#D97706",
    },
  ], [translate, compliance.data, flags.data, flagged.data]);

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="hidden" style={{ color: CORAL }}>{translate("common.coordinator")}</p>
          <h1 className="text-xl font-black tracking-tight" style={{ color: PLUM }}>{translate("auditPack.title")}</h1>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>{translate("auditPack.subtitle")}</p>
        </div>
        <Button
          onClick={handleExport}
          className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white"
          style={{ background: PLUM }}
        >
          <Download size={15} /> {translate("auditPack.export")}
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        {statCards.map(({ icon: Icon, label, value, colour }) => (
          <section key={label} className="rounded-2xl bg-white p-5" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
            <Icon size={20} style={{ color: colour }} />
            <p className="mt-3 text-3xl font-black" style={{ color: TEXT }}>{value}</p>
            <p className="text-sm font-bold" style={{ color: MUTED }}>{label}</p>
          </section>
        ))}
      </div>

      {/* Compliance status strip */}
      {compliance.data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: translate("auditPack.compliant"), count: compliance.data.compliant, bg: "#DCFCE7", colour: "#16A34A" },
            { label: translate("auditPack.atRisk"), count: compliance.data.at_risk, bg: "#FEF3C7", colour: "#D97706" },
            { label: translate("auditPack.nonCompliant"), count: compliance.data.non_compliant, bg: "#FEE2E2", colour: "#DC2626" },
          ].map(({ label, count, bg, colour }) => (
            <div key={label} className="rounded-xl p-4 text-center" style={{ background: bg }}>
              <p className="text-2xl font-black" style={{ color: colour }}>{count}</p>
              <p className="text-xs font-bold mt-0.5" style={{ color: colour }}>{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Detail tabs */}
      <div className="flex gap-1 rounded-xl p-1" style={{ background: SOFT }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className="flex-1 rounded-lg py-2 text-xs font-bold transition-colors"
            style={{
              background: activeTab === t.key ? "var(--cc-bg)" : "transparent",
              color: activeTab === t.key ? PLUM : MUTED,
              boxShadow: activeTab === t.key ? "0 1px 3px rgba(55,48,163,0.12)" : "none",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Summary tab ── */}
      {activeTab === "summary" && (
        <section className="rounded-2xl bg-white p-5 space-y-3" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
          <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: TEXT }}>{translate("auditPack.rpFlagsTitle")}</h2>
          {(compliance.error || flags.error) && <p className="text-sm text-red-600">{translate("auditPack.loadError")}</p>}
          {(flags.data || []).length === 0 ? (
            <p className="text-sm font-medium" style={{ color: MUTED }}>{translate("auditPack.noRpFlags")}</p>
          ) : (
            <div className="space-y-2">
              {(flags.data || []).map((flag, index) => (
                <div key={`${flag.session_id}-${index}`} className="rounded-xl border p-4 space-y-1" style={{ borderColor: "#EEEAFB" }}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-black" style={{ color: TEXT }}>{flag.participant_name || translate("common.participant")}</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 capitalize">
                      {flag.severity || "review"}
                    </span>
                  </div>
                  <p className="text-xs font-medium capitalize" style={{ color: MUTED }}>{flag.category || translate("auditPack.restrictivePractice")}</p>
                  {flag.phrase && <p className="text-xs italic text-slate-500">"{flag.phrase}"</p>}
                  {flag.suggestion && <p className="text-xs leading-5" style={{ color: MUTED }}>{flag.suggestion}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Worker performance tab ── */}
      {activeTab === "workers" && (
        <section className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: BORDER }}>
            <h2 className="text-sm font-black" style={{ color: TEXT }}>{translate("auditPack.workerPerformanceTitle")}</h2>
          </div>
          {workers.isLoading ? (
            <p className="p-5 text-sm" style={{ color: MUTED }}>{translate("common.loading")}</p>
          ) : (
            <div className="divide-y" style={{ borderColor: BORDER }}>
              {(workers.data || []).map((w) => (
                <div key={w.id} className="px-5 py-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold truncate" style={{ color: TEXT }}>{w.full_name}</p>
                      <span className="text-[10px] font-bold capitalize px-1.5 py-0.5 rounded-full" style={{ background: SOFT, color: MUTED }}>
                        {(w.role || "").replace(/_/g, " ")}
                      </span>
                      {w.is_active === false && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">{translate("auditPack.inactive")}</span>
                      )}
                    </div>
                    <p className="text-xs" style={{ color: MUTED }}>
                      {translateParams("auditPack.workerStats", {
                        sessions: String(w.total_sessions),
                        drafts: String(w.draft_count),
                        flagged: String(w.flagged_count),
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <TrendIcon score={w.avg_compliance} />
                    <span className="text-sm font-black" style={{ color: complianceColour(w.avg_compliance) }}>
                      {w.avg_compliance != null ? `${w.avg_compliance}%` : translate("common.emDash")}
                    </span>
                  </div>
                </div>
              ))}
              {!workers.isLoading && !workers.data?.length && (
                <p className="px-5 py-4 text-sm" style={{ color: MUTED }}>{translate("auditPack.noWorkerData")}</p>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Flagged sessions tab ── */}
      {activeTab === "flagged" && (
        <section className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: BORDER }}>
            <h2 className="text-sm font-black" style={{ color: TEXT }}>{translate("auditPack.flaggedSessionsTitle")}</h2>
          </div>
          {flagged.isLoading ? (
            <p className="p-5 text-sm" style={{ color: MUTED }}>{translate("common.loading")}</p>
          ) : !flagged.data?.length ? (
            <p className="p-5 text-sm" style={{ color: MUTED }}>{translate("auditPack.noFlaggedSessions")}</p>
          ) : (
            <div className="divide-y" style={{ borderColor: BORDER }}>
              {flagged.data.map((s) => (
                <div key={s.id} className="px-5 py-4 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold" style={{ color: TEXT }}>
                        {translateParams("auditPack.sessionLabel", {
                          participant: s.participant_name || translate("common.participant"),
                          sessionType: s.session_type || translate("auditPack.defaultSessionType"),
                        })}
                      </p>
                      <p className="text-xs" style={{ color: MUTED }}>
                        {s.session_date ? format(parseISO(s.session_date), "d MMM yyyy") : translate("auditPack.unknownDate")}
                        {s.review_requested_at && translateParams("auditPack.flaggedOn", { date: format(parseISO(s.review_requested_at), "d MMM") })}
                      </p>
                    </div>
                    <a
                      href={`/sessions/${s.id}`}
                      className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full text-white"
                      style={{ background: PLUM }}
                    >
                      {translate("auditPack.review")}
                    </a>
                  </div>
                  {s.review_note && (
                    <p className="text-xs italic bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5 text-amber-800">
                      "{s.review_note}"
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
