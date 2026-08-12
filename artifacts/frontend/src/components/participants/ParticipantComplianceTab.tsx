import { AlertTriangle, CheckCircle2, Circle, ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { safeFormat, complianceTone } from "@/lib/participant-format";
import type { ComplianceBreakdown, ComplianceCategoryStatus, ComplianceHistoryItem } from "@/pages/patients";

interface ParticipantComplianceTabProps {
  complianceHistory: ComplianceHistoryItem[];
  averageCompliance: number | null;
  isLoading: boolean;
  onSelectSession: (sessionId: string) => void;
  breakdown?: ComplianceBreakdown | null;
  breakdownLoading?: boolean;
}

const STATUS_STYLE: Record<ComplianceCategoryStatus, { icon: typeof CheckCircle2; color: string }> = {
  good: { icon: CheckCircle2, color: "#166534" },
  attention: { icon: AlertTriangle, color: "#92400E" },
  critical: { icon: AlertTriangle, color: "#B91C1C" },
  none: { icon: Circle, color: "#6A6A77" },
};

function ComplianceBreakdownSection({ breakdown, isLoading }: { breakdown: ComplianceBreakdown | null; isLoading: boolean }) {
  const { translate } = useAccessibility();

  if (isLoading) {
    return (
      <div className="mb-4 space-y-2">
        {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-xl" />)}
      </div>
    );
  }
  if (!breakdown) return null;

  return (
    <div className="mb-4 rounded-xl bg-white border border-purple-100/60 divide-y divide-purple-100/60 overflow-hidden">
      {breakdown.categories.map((cat) => {
        const style = STATUS_STYLE[cat.status];
        const Icon = style.icon;
        return (
          <div key={cat.key} className="flex items-center gap-3 px-3 py-2.5">
            <Icon className="h-4 w-4 shrink-0" style={{ color: style.color }} />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-bold text-[#1A1A2E]">{translate(`patients.compliance.category.${cat.key}`)}</p>
              <p className="text-[11px] text-[#6A6A77] truncate">{cat.detail}</p>
            </div>
            {cat.score != null && (
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black ${complianceTone(cat.score)}`}>
                {cat.score}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** "Compliance" facet of the participant Detail archetype. */
export function ParticipantComplianceTab({
  complianceHistory,
  averageCompliance,
  isLoading,
  onSelectSession,
  breakdown = null,
  breakdownLoading = false,
}: ParticipantComplianceTabProps) {
  const { translate, translateParams } = useAccessibility();

  return (
    <section className="rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-[#E8457A]" />
          <h4 className="text-[13px] font-black text-[#1A1A2E]">{translate("patients.section.complianceHistory")}</h4>
        </div>
        {complianceHistory.length > 0 && averageCompliance != null && (
          <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black ${complianceTone(averageCompliance)}`}>
            {translateParams("patients.compliance.avg", { score: String(averageCompliance) })}
          </span>
        )}
      </div>

      <ComplianceBreakdownSection breakdown={breakdown} isLoading={breakdownLoading} />

      {isLoading ? (
        <div className="space-y-2">
          {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
        </div>
      ) : complianceHistory.length === 0 ? (
        <div className="rounded-xl bg-white border border-purple-100/60 p-6 text-center">
          <ShieldCheck className="h-8 w-8 text-[#6A6A77] opacity-30 mx-auto mb-2" />
          <p className="text-[13px] font-semibold text-[#1A1A2E]">{translate("patients.compliance.empty")}</p>
          <p className="text-[11px] text-[#6A6A77] mt-1">{translate("patients.compliance.emptyHint")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {complianceHistory.map((item) => {
            const score = item.latest_audit?.score ?? item.latest_audit?.compliance_score;
            const auditDate = item.latest_audit?.checked_at ?? item.latest_audit?.created_at;
            return (
              <div
                key={item.session_id}
                onClick={() => onSelectSession(item.session_id)}
                className="cursor-pointer"
              >
                <div className="rounded-xl bg-white border border-purple-100/60 px-3 py-3 hover:border-[#E8457A]/30 hover:bg-[#F4EDE6] transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-bold text-[#1A1A2E] capitalize truncate">
                        {(item.session_type || "session").replace(/_/g, " ")}
                      </p>
                      <p className="text-[11px] text-[#6A6A77] mt-0.5">
                        {translateParams("patients.compliance.sessionDate", { date: safeFormat(item.session_date) })}
                        {auditDate ? ` · ${translateParams("patients.compliance.audited", { date: safeFormat(auditDate, "MMM d") })}` : ""}
                      </p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-black shrink-0 ${complianceTone(score)}`}>
                      {score == null ? "N/A" : `${score}%`}
                    </span>
                  </div>
                  {item.latest_audit?.status && (
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-wider capitalize text-[#6A6A77]">
                      {item.latest_audit.status.replace(/_/g, " ")}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
