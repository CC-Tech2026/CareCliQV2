import { useState } from "react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { format, parseISO } from "date-fns";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { ComplianceDetailCard } from "@/components/compliance/ComplianceDetailCard";
import { ComplianceTrendChart } from "@/components/compliance/ComplianceTrendChart";
import { getMyCompliance, getWorkerComplianceDetail } from "@/services/workerService";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

function safeDate(value: string | undefined, translate: (key: string) => string) {
  if (!value) return translate("compliance.notRecorded");
  try {
    return format(parseISO(value), "MMM d, yyyy");
  } catch {
    return value;
  }
}

function badgeClass(status?: string) {
  if (status === "compliant") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "non_compliant") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export default function MyCompliance() {
  const [trendDays, setTrendDays] = useState<7 | 30>(7);
  const { translate } = useAccessibility();
  const { data, isLoading, error } = useOrgQuery(["worker", "my-compliance"], { queryFn: getMyCompliance });
  const complianceDetailQuery = useOrgQuery(["worker", "compliance-detail", trendDays], {
    queryFn: () => getWorkerComplianceDetail(trendDays),
    staleTime: 30_000,
  });

  if (isLoading || complianceDetailQuery.isLoading) {
    return <div className="p-6 text-sm font-bold" style={{ color: MUTED }}>{translate("compliance.loading")}</div>;
  }
  if (error) return <div className="p-6 text-sm font-bold text-red-600">{(error as Error).message}</div>;

  const complianceDetail = complianceDetailQuery.data;

  return (
    <div className="space-y-6 pb-10">
      <div>
        <p className="hidden" style={{ color: MUTED }}>Support Worker</p>
        <h1 className="text-xl font-black tracking-tight" style={{ color: PLUM }}>{translate("compliance.title")}</h1>
      </div>

      <div
        className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-white px-5 py-4"
        style={{ borderColor: BORDER }}
      >
        <div className="flex items-center gap-2">
          <ShieldCheck size={15} style={{ color: PLUM }} />
          <span className="text-sm font-black" style={{ color: TEXT }}>{data?.average_score ?? 0}%</span>
          <span className="text-sm font-medium" style={{ color: MUTED }}>{translate("compliance.avgScore")}</span>
        </div>
        <div className="h-4 w-px" style={{ background: BORDER }} />
        <div className="flex items-center gap-2">
          <CheckCircle2 size={15} className="text-emerald-500" />
          <span className="text-sm font-black text-emerald-700">{data?.reviewed_sessions ?? 0}</span>
          <span className="text-sm font-medium" style={{ color: MUTED }}>{translate("compliance.reviewed")}</span>
        </div>
        <div className="h-4 w-px" style={{ background: BORDER }} />
        <div className="flex items-center gap-2">
          <AlertTriangle size={15} style={{ color: CORAL }} />
          <span className="text-sm font-black" style={{ color: CORAL }}>{data?.at_risk ?? 0}</span>
          <span className="text-sm font-medium" style={{ color: MUTED }}>{translate("compliance.needsAttention")}</span>
        </div>
      </div>

      {complianceDetail && (
        <>
          <ComplianceDetailCard
            score={complianceDetail.score}
            status={complianceDetail.status}
            rules={complianceDetail.rules}
            failedRules={complianceDetail.failed_rules}
            title={translate("compliance.realTime")}
          />
          <ComplianceTrendChart
            data={complianceDetail.trend}
            days={trendDays}
            onDaysChange={setTrendDays}
          />
        </>
      )}

      <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-black" style={{ color: TEXT }}>{translate("compliance.records")}</h2>
          <span className={`rounded-full border px-3 py-1 text-xs font-bold capitalize ${badgeClass(data?.status)}`}>
            {data?.status.replace("_", " ")}
          </span>
        </div>
        <div className="space-y-3">
          {(data?.sessions || []).map((session) => (
            <div key={session.id} className="rounded-lg border p-4" style={{ borderColor: "#EEEAFB" }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-black capitalize" style={{ color: TEXT }}>{(session.session_type || "session").replace("_", " ")}</p>
                  <p className="text-sm font-medium" style={{ color: MUTED }}>{safeDate(session.session_date, translate)}</p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${badgeClass(session.compliance_status)}`}>
                  {session.compliance_score ?? translate("compliance.draft")}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
