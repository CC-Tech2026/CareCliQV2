import { useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronRight, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RPFlag } from "@/lib/rp-detector";
import { RP_CATEGORY_LABELS } from "@/lib/rp-detector";

interface ComplianceRule {
  name?: string;
  label?: string;
  passed?: boolean;
  pass?: boolean;
  status?: "pass" | "warn" | "warning" | "fail";
  note?: string;
}

interface ComplianceResultPanelProps {
  score: number;
  status?: string;
  rules?: ComplianceRule[];
  rpFlags?: RPFlag[];
  className?: string;
}

function scoreColor(score: number) {
  if (score >= 85) return { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", circle: "bg-emerald-500" };
  if (score >= 60) return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", circle: "bg-amber-500" };
  return { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", circle: "bg-red-500" };
}

function statusLabel(score: number, status?: string): string {
  if (status) return status;
  if (score >= 85) return "Compliant";
  if (score >= 60) return "At Risk";
  return "Non-Compliant";
}

function statusBadgeClass(score: number, status?: string): string {
  const s = typeof status === "string" ? status.toLowerCase() : "";
  if (s === "compliant") return "bg-emerald-100 text-emerald-700 border-emerald-300";
  if (s === "at_risk" || s === "at risk") return "bg-amber-100 text-amber-700 border-amber-300";
  if (s === "draft") return "bg-slate-100 text-slate-600 border-slate-300";
  if (s === "non-compliant" || s === "non_compliant") return "bg-red-100 text-red-700 border-red-300";
  if (score >= 85) return "bg-emerald-100 text-emerald-700 border-emerald-300";
  if (score >= 60) return "bg-amber-100 text-amber-700 border-amber-300";
  return "bg-red-100 text-red-700 border-red-300";
}

function ruleStatus(rule: ComplianceRule): "pass" | "warn" | "fail" {
  if (rule.status) {
    if (rule.status === "warning") return "warn";
    return rule.status;
  }
  if (typeof rule.passed === "boolean") return rule.passed ? "pass" : "fail";
  if (typeof rule.pass === "boolean") return rule.pass ? "pass" : "fail";
  return "fail";
}

function ruleLabel(rule: ComplianceRule): string {
  return rule.label ?? rule.name ?? "Unknown rule";
}

export function ComplianceResultPanel({
  score,
  status,
  rules,
  rpFlags,
  className,
}: ComplianceResultPanelProps) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rpOpen, setRpOpen] = useState(true);

  const colors = scoreColor(score);
  const label = statusLabel(score, status);
  const hasRp = rpFlags && rpFlags.length > 0;
  const hasRules = rules && rules.length > 0;

  return (
    <div className={cn("rounded-xl border", colors.bg, colors.border, className)}>
      {/* Score + status row */}
      <div className="flex items-center gap-4 p-4">
        <div className={cn("flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-sm", colors.circle)}>
          {score}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Shield className={cn("h-4 w-4 shrink-0", colors.text)} />
            <span className={cn("font-bold text-base", colors.text)}>Compliance Score</span>
            <span
              className={cn(
                "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border",
                statusBadgeClass(score, status),
              )}
            >
              {label}
            </span>
          </div>
          <p className={cn("text-xs mt-0.5", colors.text)}>
            {score >= 85
              ? "This session meets NDIS documentation standards."
              : score >= 60
                ? "Some documentation gaps detected — review before claiming."
                : "Critical documentation issues — resolve before submitting a claim."}
          </p>
        </div>
      </div>

      {/* Rules breakdown — collapsible */}
      {hasRules && (
        <div className={cn("border-t", colors.border)}>
          <button
            type="button"
            className={cn(
              "w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors",
              colors.text,
            )}
            onClick={() => setRulesOpen((o) => !o)}
          >
            <span>Rule Breakdown ({rules!.filter((r) => ruleStatus(r) === "pass").length}/{rules!.length} passed)</span>
            {rulesOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {rulesOpen && (
            <div className="px-4 pb-3 space-y-1.5">
              {rules!.map((rule, i) => {
                const st = ruleStatus(rule);
                return (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    {st === "pass" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    ) : st === "warn" ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                    )}
                    <span className={cn(
                      st === "pass" ? "text-emerald-700" : st === "warn" ? "text-amber-700" : "text-red-700",
                    )}>
                      {ruleLabel(rule)}
                      {rule.note && (
                        <span className="text-slate-500 font-normal ml-1">({rule.note})</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* RP flags — expandable red section */}
      {hasRp && (
        <div className="border-t border-red-300">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-red-700 transition-colors"
            onClick={() => setRpOpen((o) => !o)}
          >
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              Restrictive Practice Flags ({rpFlags!.length})
            </span>
            {rpOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {rpOpen && (
            <div className="px-4 pb-3 space-y-2">
              {rpFlags!.map((flag, i) => (
                <div key={i} className="bg-red-100 border border-red-200 rounded-lg p-2.5 text-xs space-y-1">
                  <span className="font-semibold text-red-800 block">
                    {RP_CATEGORY_LABELS[flag.category] ?? flag.category}
                  </span>
                  <span className="text-red-700 italic block">"{flag.phrase}"</span>
                  {flag.suggested_rewrite && (
                    <div className="mt-1 pt-1 border-t border-red-200">
                      <span className="text-red-600 font-medium block mb-0.5">Suggested rewrite:</span>
                      <span className="text-red-700 italic">"{flag.suggested_rewrite}"</span>
                    </div>
                  )}
                </div>
              ))}
              <p className="text-xs text-red-600 mt-1">
                Restrictive practices must be documented in your NDIS behaviour support plan and require prior authorisation.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
