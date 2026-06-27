import { useState, useCallback } from "react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  AlertTriangle, FileCheck2, ShieldCheck, Download,
  TrendingUp, TrendingDown, Minus, Users, Flag,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  getCoordinatorComplianceOverview,
  getCoordinatorRpFlags,
  getCoordinatorWorkerStats,
  getCoordinatorFlaggedSessions,
} from "@/services/coordinatorService";
import { Button } from "@/components/ui/button";

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

  const tabs: { key: ExportTab; label: string }[] = [
    { key: "summary",  label: "Summary" },
    { key: "workers",  label: "Worker Performance" },
    { key: "flagged",  label: "Flagged Sessions" },
  ];

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="hidden" style={{ color: CORAL }}>Support Coordinator</p>
          <h1 className="text-xl font-black tracking-tight" style={{ color: PLUM }}>Business Compliance Report</h1>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>NDIS audit pack — all session records for your organisation</p>
        </div>
        <Button
          onClick={handleExport}
          className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white"
          style={{ background: PLUM }}
        >
          <Download size={15} /> Export Audit Pack
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          {
            icon: ShieldCheck, label: "Team compliance",
            value: compliance.data ? `${compliance.data.average_score}%` : "—",
            colour: complianceColour(compliance.data?.average_score),
          },
          {
            icon: FileCheck2, label: "Session records",
            value: compliance.data?.total_sessions ?? "—",
            colour: PLUM,
          },
          {
            icon: AlertTriangle, label: "RP flags",
            value: flags.data?.length ?? "—",
            colour: CORAL,
          },
          {
            icon: Flag, label: "Needs review",
            value: flagged.data?.length ?? "—",
            colour: "#D97706",
          },
        ].map(({ icon: Icon, label, value, colour }) => (
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
            { label: "Compliant (≥85%)", count: compliance.data.compliant, bg: "#DCFCE7", colour: "#16A34A" },
            { label: "At Risk (60–84%)", count: compliance.data.at_risk, bg: "#FEF3C7", colour: "#D97706" },
            { label: "Non-Compliant (<60%)", count: compliance.data.non_compliant, bg: "#FEE2E2", colour: "#DC2626" },
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
          <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: TEXT }}>Restrictive Practice Flags</h2>
          {(compliance.error || flags.error) && <p className="text-sm text-red-600">Audit data could not be loaded.</p>}
          {(flags.data || []).length === 0 ? (
            <p className="text-sm font-medium" style={{ color: MUTED }}>No restrictive practice flags are currently recorded.</p>
          ) : (
            <div className="space-y-2">
              {(flags.data || []).map((flag, index) => (
                <div key={`${flag.session_id}-${index}`} className="rounded-xl border p-4 space-y-1" style={{ borderColor: "#EEEAFB" }}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-black" style={{ color: TEXT }}>{flag.participant_name || "Participant"}</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 capitalize">
                      {flag.severity || "review"}
                    </span>
                  </div>
                  <p className="text-xs font-medium capitalize" style={{ color: MUTED }}>{flag.category || "restrictive practice"}</p>
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
            <h2 className="text-sm font-black" style={{ color: TEXT }}>Worker Compliance Performance</h2>
          </div>
          {workers.isLoading ? (
            <p className="p-5 text-sm" style={{ color: MUTED }}>Loading…</p>
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
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">Inactive</span>
                      )}
                    </div>
                    <p className="text-xs" style={{ color: MUTED }}>{w.total_sessions} sessions · {w.draft_count} drafts · {w.flagged_count} flagged</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <TrendIcon score={w.avg_compliance} />
                    <span className="text-sm font-black" style={{ color: complianceColour(w.avg_compliance) }}>
                      {w.avg_compliance != null ? `${w.avg_compliance}%` : "—"}
                    </span>
                  </div>
                </div>
              ))}
              {!workers.isLoading && !workers.data?.length && (
                <p className="px-5 py-4 text-sm" style={{ color: MUTED }}>No worker data available.</p>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Flagged sessions tab ── */}
      {activeTab === "flagged" && (
        <section className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: BORDER }}>
            <h2 className="text-sm font-black" style={{ color: TEXT }}>Sessions Flagged for Review</h2>
          </div>
          {flagged.isLoading ? (
            <p className="p-5 text-sm" style={{ color: MUTED }}>Loading…</p>
          ) : !flagged.data?.length ? (
            <p className="p-5 text-sm" style={{ color: MUTED }}>No sessions are currently flagged for review.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: BORDER }}>
              {flagged.data.map((s) => (
                <div key={s.id} className="px-5 py-4 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold" style={{ color: TEXT }}>
                        {s.participant_name || "Participant"} — {s.session_type || "Session"}
                      </p>
                      <p className="text-xs" style={{ color: MUTED }}>
                        {s.session_date ? format(parseISO(s.session_date), "d MMM yyyy") : "Unknown date"}
                        {s.review_requested_at && ` · Flagged ${format(parseISO(s.review_requested_at), "d MMM")}`}
                      </p>
                    </div>
                    <a
                      href={`/sessions/${s.id}`}
                      className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full text-white"
                      style={{ background: PLUM }}
                    >
                      Review
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
