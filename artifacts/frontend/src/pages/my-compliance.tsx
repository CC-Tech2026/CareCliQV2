import { useState } from "react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { format, parseISO } from "date-fns";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { ComplianceDetailCard } from "@/components/compliance/ComplianceDetailCard";
import { ComplianceTrendChart } from "@/components/compliance/ComplianceTrendChart";
import { getMyCompliance, getWorkerComplianceDetail } from "@/services/workerService";
import { BORDER, CORAL, MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { AccessibleStatusBadge } from "@/components/accessibility/AccessibleStatusBadge";

function safeDate(value?: string) {
  if (!value) return "—";
  try {
    return format(parseISO(value), "MMM d, yyyy");
  } catch {
    return value;
  }
}

function statusTone(status?: string): "success" | "critical" | "warning" {
  if (status === "compliant") return "success";
  if (status === "non_compliant") return "critical";
  return "warning";
}

export default function MyCompliance() {
  const { translate } = useAccessibility();
  const [trendDays, setTrendDays] = useState<7 | 30>(7);
  const { data, isLoading, error } = useOrgQuery(["worker", "my-compliance"], { queryFn: getMyCompliance });
  const complianceDetailQuery = useOrgQuery(["worker", "compliance-detail", trendDays], {
    queryFn: () => getWorkerComplianceDetail(trendDays),
    staleTime: 30_000,
  });

  if (isLoading || complianceDetailQuery.isLoading) {
    return (
      <div className="p-6 text-sm font-bold text-safe" style={{ color: MUTED }} role="status">
        {translate("compliance.loading")}
      </div>
    );
  }
  if (error) return <div className="p-6 text-sm font-bold text-red-600">{(error as Error).message}</div>;

  const complianceDetail = complianceDetailQuery.data;
  const statusLabel =
    data?.status === "compliant"
      ? translate("compliance.status.compliant")
      : data?.status === "non_compliant"
        ? translate("compliance.status.nonCompliant")
        : translate("compliance.status.pending");

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10 text-safe">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
          {translate("common.supportWorker")}
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>
          {translate("compliance.title")}
        </h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <section className="rounded-lg border bg-[var(--cc-surface)] p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <ShieldCheck size={22} style={{ color: PLUM }} aria-hidden />
          <p className="mt-3 text-3xl font-black" style={{ color: TEXT }}>{data?.average_score ?? 0}%</p>
          <p className="text-sm font-bold" style={{ color: MUTED }}>{translate("compliance.averageScore")}</p>
        </section>
        <section className="rounded-lg border bg-[var(--cc-surface)] p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <CheckCircle2 size={22} className="text-emerald-600" aria-hidden />
          <p className="mt-3 text-3xl font-black" style={{ color: TEXT }}>{data?.reviewed_sessions ?? 0}</p>
          <p className="text-sm font-bold" style={{ color: MUTED }}>{translate("compliance.reviewedSessions")}</p>
        </section>
        <section className="rounded-lg border bg-[var(--cc-surface)] p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <AlertTriangle size={22} style={{ color: CORAL }} aria-hidden />
          <p className="mt-3 text-3xl font-black" style={{ color: TEXT }}>{data?.at_risk ?? 0}</p>
          <p className="text-sm font-bold" style={{ color: MUTED }}>{translate("shiftHistory.band.needsAttention")}</p>
        </section>
      </div>

      {complianceDetail && (
        <>
          <ComplianceDetailCard
            score={complianceDetail.score}
            status={complianceDetail.status}
            rules={complianceDetail.rules}
            failedRules={complianceDetail.failed_rules}
            title="Real-Time Compliance"
          />
          <ComplianceTrendChart
            data={complianceDetail.trend}
            days={trendDays}
            onDaysChange={setTrendDays}
          />
        </>
      )}

      <section className="rounded-lg border bg-[var(--cc-surface)] p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-black" style={{ color: TEXT }}>
            Worker-Owned Compliance Records
          </h2>
          <AccessibleStatusBadge
            label={statusLabel}
            icon={data?.status === "compliant" ? CheckCircle2 : AlertTriangle}
            tone={statusTone(data?.status)}
          />
        </div>
        <div className="space-y-3">
          {(data?.sessions || []).map((session) => (
            <div key={session.id} className="rounded-lg border p-4" style={{ borderColor: BORDER }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-black capitalize" style={{ color: TEXT }}>
                    {(session.session_type || "session").replace("_", " ")}
                  </p>
                  <p className="text-sm font-medium" style={{ color: MUTED }}>{safeDate(session.session_date)}</p>
                </div>
                <AccessibleStatusBadge
                  label={String(session.compliance_score ?? "Draft")}
                  icon={session.compliance_status === "compliant" ? CheckCircle2 : AlertTriangle}
                  tone={statusTone(session.compliance_status)}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
