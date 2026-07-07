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
import { getAuditEngagementPack } from "@/services/longShiftService";
import { Button } from "@/components/ui/button";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const PLUM  = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const TEXT  = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT  = "#F4EDE6";

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

type ExportTab = "summary" | "workers" | "flagged" | "engagement";

/** Rendered both at the standalone /audit-pack route and as a Compliance
 * Centre sub-tab — kept as one component so the two never drift apart. */
export function AuditPackPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const { translate, translateParams } = useAccessibility();
  const [activeTab, setActiveTab] = useState<ExportTab>("summary");

  const compliance = useOrgQuery(["coordinator", "compliance-overview"], { queryFn: getCoordinatorComplianceOverview });
  const flags      = useOrgQuery(["coordinator", "rp-flags"],             { queryFn: getCoordinatorRpFlags });
  const workers    = useOrgQuery(["coordinator", "worker-stats"],          { queryFn: getCoordinatorWorkerStats });
  const flagged    = useOrgQuery(["coordinator", "flagged-sessions"],      { queryFn: getCoordinatorFlaggedSessions });
  const engagement = useOrgQuery(["coordinator", "audit-engagement"],      { queryFn: () => getAuditEngagementPack() });

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
      engagement_compliance_kpi: engagement.data?.engagement_compliance_kpi ?? null,
      long_shift_engagement_log: engagement.data?.long_shift_engagement_log ?? [],
      check16_compliance_row: engagement.data?.check16_compliance_row ?? null,
      billable_reconciliation: engagement.data?.billable_reconciliation ?? [],
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
    a.download = `carecliq-audit-pack-${format(new Date(), "yyyy-MM-dd")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [compliance.data, workers.data, flags.data, flagged.data, engagement.data]);

  const tabs: { key: ExportTab; label: string }[] = useMemo(() => [
    { key: "summary",  label: translate("auditPack.tab.summary") },
    { key: "engagement", label: "Long shift (Check 16)" },
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
    <div className="space-y-3 pb-8">
      {/* Header — skipped when embedded as a Compliance Centre sub-tab, which already has its own title */}
      <div className={embedded ? "flex justify-end" : "flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"}>
        {!embedded && (
          <div>
            <h1 className="text-xl font-black tracking-tight" style={{ color: TEXT }}>{translate("auditPack.title")}</h1>
            <p className="mt-0.5 text-sm" style={{ color: MUTED }}>{translate("auditPack.subtitle")}</p>
          </div>
        )}
        <Button
          onClick={handleExport}
          className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-black text-white"
          style={{ background: "var(--cc-cta)" }}
        >
          <Download size={15} /> {translate("auditPack.export")}
        </Button>
      </div>

      {/* Stat strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 rounded-xl border bg-white px-5 py-3" style={{ borderColor: BORDER }}>
        {statCards.map(({ icon: Icon, label, value, colour }, i) => (
          <div key={label} className="flex items-center gap-6">
            {i > 0 && <div className="h-7 w-px hidden sm:block" style={{ background: BORDER }} />}
            <div className="flex items-center gap-2">
              <Icon size={16} style={{ color: colour }} className="shrink-0" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider leading-none" style={{ color: MUTED }}>{label}</p>
                <p className="text-lg font-black leading-tight mt-0.5" style={{ color: TEXT }}>{value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Compliance status strip */}
      {compliance.data && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: translate("auditPack.compliant"), count: compliance.data.compliant, bg: "#DCFCE7", colour: "#16A34A" },
            { label: translate("auditPack.atRisk"), count: compliance.data.at_risk, bg: "#FEF3C7", colour: "#D97706" },
            { label: translate("auditPack.nonCompliant"), count: compliance.data.non_compliant, bg: "#FEE2E2", colour: "#DC2626" },
          ].map(({ label, count, bg, colour }) => (
            <div key={label} className="rounded-xl p-3 text-center" style={{ background: bg }}>
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

      {/* -- Summary tab -- */}
      {activeTab === "summary" && (
        <section className="rounded-2xl bg-white p-5 space-y-3" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
          <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: TEXT }}>{translate("auditPack.rpFlagsTitle")}</h2>
          {(compliance.error || flags.error) && <p className="text-sm text-red-600">{translate("auditPack.loadError")}</p>}
          {(flags.data || []).length === 0 ? (
            <p className="text-sm font-medium" style={{ color: MUTED }}>{translate("auditPack.noRpFlags")}</p>
          ) : (
            <div className="space-y-2">
              {(flags.data || []).map((flag, index) => (
                <div key={`${flag.session_id}-${index}`} className="rounded-xl border p-4 space-y-1" style={{ borderColor: "#EDE3FC" }}>
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

      {activeTab === "engagement" && (
        <div className="space-y-4">
          {engagement.isLoading ? (
            <p className="text-sm" style={{ color: MUTED }}>{translate("common.loading")}</p>
          ) : engagement.data ? (
            <>
              <section className="rounded-2xl bg-white p-5" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
                <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: TEXT }}>
                  Engagement compliance (Check 16)
                </h2>
                <p className="mt-1 text-xs" style={{ color: MUTED }}>
                  {engagement.data.engagement_compliance_kpi.description}
                </p>
                <p className="mt-3 text-3xl font-black" style={{ color: PLUM }}>
                  {engagement.data.engagement_compliance_kpi.pass_rate_pct}%
                </p>
                <p className="text-xs font-bold" style={{ color: MUTED }}>
                  {engagement.data.engagement_compliance_kpi.passed_check16} of{" "}
                  {engagement.data.engagement_compliance_kpi.total_long_shifts} long shifts passed
                </p>
                <div className="mt-3 rounded-xl border p-3 text-xs" style={{ borderColor: BORDER }}>
                  <p className="font-bold" style={{ color: TEXT }}>
                    {engagement.data.check16_compliance_row.name} ({engagement.data.check16_compliance_row.rule})
                  </p>
                  <p style={{ color: MUTED }}>
                    Period result: {engagement.data.check16_compliance_row.period_result} ·{" "}
                    {engagement.data.check16_compliance_row.sessions_flagged} sessions flagged
                  </p>
                </div>
              </section>

              <section className="rounded-2xl bg-white p-5" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
                <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: TEXT }}>
                  Section 3a: Long shift engagement log
                </h2>
                <div className="mt-3 space-y-2">
                  {engagement.data.long_shift_engagement_log.map((row) => (
                    <div key={row.session_id} className="rounded-xl border p-3 text-xs" style={{ borderColor: BORDER }}>
                      <p className="font-bold" style={{ color: TEXT }}>
                        {row.participant_name || "Participant"} · {row.worker_name || "Worker"}
                      </p>
                      <p style={{ color: MUTED }}>
                        {row.shift_duration_hours}h · Check-ins {row.checkins_completed}/{row.checkins_required} ·
                        Max gap {row.max_activity_gap_mins}m · Break {row.break_duration_mins}m · Score {row.engagement_score}
                      </p>
                    </div>
                  ))}
                  {!engagement.data.long_shift_engagement_log.length && (
                    <p style={{ color: MUTED }}>No long shifts in this period.</p>
                  )}
                </div>
              </section>

              <section className="rounded-2xl bg-white p-5" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
                <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: TEXT }}>
                  Billable vs billed hours
                </h2>
                <div className="mt-3 space-y-2">
                  {engagement.data.billable_reconciliation.map((row) => (
                    <div
                      key={row.session_id}
                      className={`rounded-xl border p-3 text-xs ${row.flagged ? "border-amber-300 bg-amber-50" : ""}`}
                      style={{ borderColor: row.flagged ? undefined : BORDER }}
                    >
                      <p className="font-bold" style={{ color: TEXT }}>{row.participant_name || "Participant"}</p>
                      <p style={{ color: MUTED }}>
                        Billed {row.billed_hours ?? "N/A"}h · Billable {row.billable_hours ?? "N/A"}h · Break {row.break_hours ?? 0}h
                        {row.flagged ? " · discrepancy flagged" : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <p className="text-sm text-red-600">{translate("auditPack.loadError")}</p>
          )}
        </div>
      )}

      {/* -- Worker performance tab -- */}
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

      {/* -- Flagged sessions tab -- */}
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
                      style={{ background: "var(--cc-cta)" }}
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

export default function AuditPack() {
  return <AuditPackPanel />;
}
