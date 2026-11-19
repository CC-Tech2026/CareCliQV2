import { AlertTriangle, ArrowRight, CheckCircle2, Circle, ShieldCheck } from "lucide-react";
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

// Real traffic-light colours for compliance, never the brand's.
const STATUS_STYLE: Record<ComplianceCategoryStatus, { icon: typeof CheckCircle2; className: string; label: string }> = {
  good: { icon: CheckCircle2, className: "text-emerald-700 dark:text-emerald-400", label: "In order" },
  attention: { icon: AlertTriangle, className: "text-amber-700 dark:text-amber-400", label: "Needs attention" },
  critical: { icon: AlertTriangle, className: "text-red-700 dark:text-red-400", label: "Needs action" },
  none: { icon: Circle, className: "text-cc-muted", label: "Nothing to check yet" },
};

function ComplianceBreakdownSection({ breakdown, isLoading }: { breakdown: ComplianceBreakdown | null; isLoading: boolean }) {
  const { translate } = useAccessibility();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-xl" />)}
      </div>
    );
  }
  if (!breakdown) return null;

  return (
    <section aria-labelledby="compliance-summary-heading" className="space-y-2">
      <h3 id="compliance-summary-heading" className="text-base font-semibold text-cc-text">Where things stand</h3>
      <ul className="divide-y divide-cc-border border-y border-cc-border">
        {breakdown.categories.map((cat) => {
          const style = STATUS_STYLE[cat.status];
          const Icon = style.icon;
          return (
            <li key={cat.key} className="flex items-start gap-3 py-3">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.className}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-cc-text">
                  {translate(`patients.compliance.category.${cat.key}`)}
                  <span className="sr-only">: {style.label}</span>
                </p>
                <p className="text-sm text-cc-muted">{cat.detail}</p>
              </div>
              {cat.score != null && (
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${complianceTone(cat.score)}`}>
                  {cat.score}%
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Compliance for one participant: where each area stands, then every
 * progress note that has had a detailed check. */
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
    <div className="space-y-8">
      <ComplianceBreakdownSection breakdown={breakdown} isLoading={breakdownLoading} />

      <section aria-labelledby="note-checks-heading" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="note-checks-heading" className="text-base font-semibold text-cc-text">{translate("patients.section.complianceHistory")}</h3>
          {complianceHistory.length > 0 && averageCompliance != null && (
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${complianceTone(averageCompliance)}`}>
              {translateParams("patients.compliance.avg", { score: String(averageCompliance) })}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
          </div>
        ) : complianceHistory.length === 0 ? (
          <div className="py-6 text-center">
            <ShieldCheck className="mx-auto mb-2 h-7 w-7 text-cc-muted" aria-hidden />
            <p className="text-sm font-semibold text-cc-text">{translate("patients.compliance.empty")}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-cc-muted">{translate("patients.compliance.emptyHint")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-cc-border border-y border-cc-border">
            {complianceHistory.map((item) => {
              const score = item.latest_audit?.score ?? item.latest_audit?.compliance_score;
              const auditDate = item.latest_audit?.checked_at ?? item.latest_audit?.created_at;
              return (
                <li key={item.session_id}>
                  <button
                    type="button"
                    onClick={() => onSelectSession(item.session_id)}
                    className="flex w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium capitalize text-cc-text">
                        {(item.session_type || "shift").replace(/_/g, " ")}
                      </span>
                      <span className="block text-xs text-cc-muted">
                        {translateParams("patients.compliance.sessionDate", { date: safeFormat(item.session_date) })}
                        {auditDate ? `, ${translateParams("patients.compliance.audited", { date: safeFormat(auditDate, "d MMM") })}` : ""}
                        {item.latest_audit?.status ? ` · ${item.latest_audit.status.replace(/_/g, " ")}` : ""}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${complianceTone(score)}`}>
                      {score == null ? "Not scored" : `${score}%`}
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-cc-muted" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
